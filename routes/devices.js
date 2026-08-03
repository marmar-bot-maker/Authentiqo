const express = require('express');
const supabase = require('../db/database');
const { requireRole } = require('../middleware/auth');
const { generateDeviceQrCode } = require('../utils/qrGenerator');

const router = express.Router();
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || 'http://localhost:3000';

// Register (or claim) a device for resale. Auto-pulls any existing repair history
// by serial number. Seller input is limited to identity/metadata — never repair details.
router.post('/register', requireRole('seller'), async (req, res) => {
  const { serialNumber, deviceType, brand, model, manufacturedDate } = req.body;

  if (!serialNumber) {
    return res.status(400).json({ error: 'Serial number is required.' });
  }

  let wasTransfer = false;
  let previousOwnerCount = 0;

  const { data: existing } = await supabase
    .from('devices')
    .select('*')
    .eq('serial_number', serialNumber)
    .maybeSingle();

  if (!existing) {
    const { error: insertError } = await supabase.from('devices').insert({
      serial_number: serialNumber,
      device_type: deviceType || null,
      brand: brand || null,
      model: model || null,
      manufactured_date: manufacturedDate || null,
      registered_by_seller_id: req.user.id,
      ownership_transfer_count: 1,
      has_been_claimed: true,
    });
    if (insertError) {
      console.error(insertError);
      return res.status(500).json({ error: 'Could not register device.' });
    }

    await supabase.from('ownership_events').insert({ serial_number: serialNumber, new_owner_number: 1 });
  } else {
    // Device already existed (e.g. a repairman logged a repair before anyone claimed it,
    // or a previous owner released it — see /release below). Only count it as an
    // ownership transfer if someone is claiming a device that was genuinely owned by
    // someone before (has_been_claimed) — editing your own listing is never a transfer.
    const wasUnclaimed = existing.registered_by_seller_id === null;
    const isReclaimAfterRelease = wasUnclaimed && existing.has_been_claimed;
    const isNewOwner = (!wasUnclaimed && existing.registered_by_seller_id !== req.user.id) || isReclaimAfterRelease;
    const newCount = isNewOwner ? existing.ownership_transfer_count + 1 : existing.ownership_transfer_count;

    const { error: updateError } = await supabase
      .from('devices')
      .update({
        device_type: deviceType || existing.device_type,
        brand: brand || existing.brand,
        model: model || existing.model,
        manufactured_date: manufacturedDate || existing.manufactured_date,
        registered_by_seller_id: req.user.id,
        ownership_transfer_count: newCount,
        has_been_claimed: true,
      })
      .eq('serial_number', serialNumber);

    if (updateError) {
      console.error(updateError);
      return res.status(500).json({ error: 'Could not update device.' });
    }

    if (isNewOwner) {
      wasTransfer = true;
      previousOwnerCount = existing.ownership_transfer_count;
      await supabase.from('ownership_events').insert({ serial_number: serialNumber, new_owner_number: newCount });
    } else if (wasUnclaimed) {
      // First time this device (created earlier via a repair log, never actually claimed) is claimed
      const { data: hasEvent } = await supabase
        .from('ownership_events')
        .select('id')
        .eq('serial_number', serialNumber)
        .limit(1)
        .maybeSingle();
      if (!hasEvent) {
        await supabase.from('ownership_events').insert({ serial_number: serialNumber, new_owner_number: 1 });
      }
    }
  }

  const { data: device } = await supabase
    .from('devices')
    .select('*')
    .eq('serial_number', serialNumber)
    .maybeSingle();

  res.status(201).json({ device, wasTransfer, previousOwnerCount });
});

// Give up ownership of a device — for a buyer who has no intention of ever
// reselling it. Authentiqo doesn't collect buyer names or contact details, so
// there's no separate "buyer" account type; this just detaches the device from
// your account. Nothing about the device's repair or ownership history is
// deleted or changed — the count and every past entry stay exactly as they
// are. The device simply becomes unclaimed until someone (you again, or
// whoever it's sold or given to next) registers that serial number.
router.post('/:serialNumber/release', requireRole('seller'), async (req, res) => {
  const { serialNumber } = req.params;

  const { data: device } = await supabase
    .from('devices')
    .select('serial_number, registered_by_seller_id')
    .eq('serial_number', serialNumber)
    .maybeSingle();

  if (!device || device.registered_by_seller_id !== req.user.id) {
    return res.status(404).json({ error: 'Device not found in your account.' });
  }

  const { error } = await supabase
    .from('devices')
    .update({ registered_by_seller_id: null })
    .eq('serial_number', serialNumber);

  if (error) {
    console.error(error);
    return res.status(500).json({ error: 'Could not release this device.' });
  }

  res.json({ released: true });
});

// Add previous owners who never used Authentiqo — e.g. a device changed hands
// privately before ever being registered on the platform. This is strictly
// additive: it can only increase the recorded owner count, never remove or
// edit anything already on file. Marked as 'seller_declared' (not
// 'platform_transfer') so the Trust Score and Risk Alerts treat a batch of
// disclosed history differently from an actual rapid resale pattern.
router.post('/:serialNumber/add-owners', requireRole('seller'), async (req, res) => {
  const { serialNumber } = req.params;
  const count = parseInt(req.body.count, 10);

  if (!Number.isInteger(count) || count < 1 || count > 20) {
    return res.status(400).json({ error: 'Enter a whole number of owners between 1 and 20.' });
  }

  const { data: device } = await supabase
    .from('devices')
    .select('*')
    .eq('serial_number', serialNumber)
    .maybeSingle();

  if (!device) {
    return res.status(404).json({ error: 'Device not found.' });
  }
  if (device.registered_by_seller_id !== req.user.id) {
    return res.status(403).json({ error: 'You can only add owners to a device registered under your own account.' });
  }

  const startingCount = device.ownership_transfer_count;
  const newCount = startingCount + count;

  const { error: updateError } = await supabase
    .from('devices')
    .update({ ownership_transfer_count: newCount })
    .eq('serial_number', serialNumber);

  if (updateError) {
    console.error(updateError);
    return res.status(500).json({ error: 'Could not add owners.' });
  }

  const newRows = [];
  for (let i = 1; i <= count; i++) {
    newRows.push({
      serial_number: serialNumber,
      new_owner_number: startingCount + i,
      source: 'seller_declared',
    });
  }
  await supabase.from('ownership_events').insert(newRows);

  res.json({ ownershipTransferCount: newCount, added: count });
});

// List devices registered by the authenticated seller, with a repair-entry count per device
router.get('/mine', requireRole('seller'), async (req, res) => {
  const { data: devices, error } = await supabase
    .from('devices')
    .select('*')
    .eq('registered_by_seller_id', req.user.id)
    .order('created_at', { ascending: false });

  if (error) {
    console.error(error);
    return res.status(500).json({ error: 'Could not load devices.' });
  }

  const devicesWithCounts = await Promise.all((devices || []).map(async (device) => {
    const { count } = await supabase
      .from('repair_logs')
      .select('*', { count: 'exact', head: true })
      .eq('serial_number', device.serial_number);
    return { ...device, repair_count: count || 0 };
  }));

  res.json({ devices: devicesWithCounts });
});

// Generate (or re-generate) the QR code for one of the seller's devices
router.get('/:serialNumber/qrcode', requireRole('seller'), async (req, res) => {
  const { serialNumber } = req.params;
  const { data: device } = await supabase
    .from('devices')
    .select('*')
    .eq('serial_number', serialNumber)
    .eq('registered_by_seller_id', req.user.id)
    .maybeSingle();

  if (!device) {
    return res.status(404).json({ error: 'Device not found in your account.' });
  }

  const { count: repairCount } = await supabase
    .from('repair_logs')
    .select('*', { count: 'exact', head: true })
    .eq('serial_number', serialNumber);

  const qr = await generateDeviceQrCode({
    baseUrl: PUBLIC_BASE_URL,
    serialNumber,
    repairCount: repairCount || 0,
    ownershipCount: device.ownership_transfer_count,
  });

  res.json({ qr });
});

module.exports = router;
