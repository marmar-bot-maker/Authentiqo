const express = require('express');
const supabase = require('../db/database');
const { calculateTrustScore, calculateConfidence } = require('../utils/trustScore');
const { detectRisks } = require('../utils/riskDetector');

const router = express.Router();

// Public, read-only device lookup. No authentication — this is what a QR scan or
// manual serial-number search resolves to.
router.get('/:serialNumber', async (req, res) => {
  const { serialNumber } = req.params;
  console.log(`[device-lookup] request received for serial: "${serialNumber}"`);

  const { data: device } = await supabase
    .from('devices')
    .select('*')
    .eq('serial_number', serialNumber)
    .maybeSingle();

  if (!device) {
    console.log(`[device-lookup] no device row found for serial: "${serialNumber}"`);
    return res.status(404).json({ error: 'No device found for that serial number. Double-check the number and try again.' });
  }

  // Aggregate engagement metric only — no per-visitor identity is stored, just a count.
  const { error: viewCountError } = await supabase.from('devices').update({ passport_view_count: (device.passport_view_count || 0) + 1 }).eq('serial_number', serialNumber);
  if (viewCountError) console.error('[device-lookup] Could not increment passport_view_count (likely a missing migration):', viewCountError.message);

  const { data: repairLogsRaw, error: repairLogsError } = await supabase
    .from('repair_logs')
    .select('id, description, location, repair_date, verification_status, self_reported_by_seller_id, repair_companies(id, company_name)')
    .eq('serial_number', serialNumber)
    .order('repair_date', { ascending: true });

  if (repairLogsError) {
    console.error('[device-lookup] Could not load repair_logs (check that the latest schema.sql migration has been run):', repairLogsError.message);
  } else {
    console.log(`[device-lookup] repair_logs query for "${serialNumber}" returned ${(repairLogsRaw || []).length} row(s)`);
  }

  const repairLogs = (repairLogsRaw || []).map((r) => ({
    id: r.id,
    description: r.description,
    location: r.location,
    repair_date: r.repair_date,
    verification_status: r.verification_status,
    company_name: r.repair_companies ? r.repair_companies.company_name : null,
    repair_company_id: r.repair_companies ? r.repair_companies.id : null,
    self_reported_by_seller: !!r.self_reported_by_seller_id,
  }));

  const { data: ownershipEvents } = await supabase
    .from('ownership_events')
    .select('id, new_owner_number, transferred_at, source')
    .eq('serial_number', serialNumber)
    .order('transferred_at', { ascending: true });

  const { data: parts } = await supabase
    .from('device_parts')
    .select('part_name, authenticity_status, logged_at')
    .eq('serial_number', serialNumber)
    .order('logged_at', { ascending: false });

  const { data: warranties } = await supabase
    .from('warranties')
    .select('warranty_type, status, coverage_description, start_date, end_date')
    .eq('serial_number', serialNumber)
    .order('created_at', { ascending: false });

  const trust = calculateTrustScore({
    repairLogs,
    ownershipCount: device.ownership_transfer_count,
    ownershipEvents: ownershipEvents || [],
  });

  const confidence = calculateConfidence({
    repairLogs,
    ownershipEvents: ownershipEvents || [],
    partsCount: (parts || []).length,
    warrantyCount: (warranties || []).length,
  });

  const { repairRisks, ownershipRisks } = detectRisks({
    repairLogs,
    ownershipEvents: ownershipEvents || [],
    deviceCreatedAt: device.created_at,
  });

  // Attach ratings (average stars + count) per repair log, if any exist yet
  const repairLogIds = repairLogs.map((r) => r.id);
  let ratingsByLogId = {};
  if (repairLogIds.length > 0) {
    const { data: ratings } = await supabase
      .from('repair_ratings')
      .select('repair_log_id, stars')
      .in('repair_log_id', repairLogIds);
    (ratings || []).forEach((r) => {
      if (!ratingsByLogId[r.repair_log_id]) ratingsByLogId[r.repair_log_id] = [];
      ratingsByLogId[r.repair_log_id].push(r.stars);
    });
  }

  const repairHistory = repairLogs.map((r) => {
    const starsArr = ratingsByLogId[r.id] || [];
    const avgRating = starsArr.length ? starsArr.reduce((a, b) => a + b, 0) / starsArr.length : null;
    return {
      ...r,
      riskAlert: repairRisks[r.id] || null,
      rating: avgRating ? { average: Math.round(avgRating * 10) / 10, count: starsArr.length } : null,
    };
  });

  const ownershipHistory = (ownershipEvents || []).map((e, i) => ({
    ...e,
    riskAlert: ownershipRisks[i] || null,
  }));

  res.json({
    device: {
      serialNumber: device.serial_number,
      deviceType: device.device_type,
      brand: device.brand,
      model: device.model,
      manufacturedDate: device.manufactured_date,
      ownershipTransferCount: device.ownership_transfer_count,
      createdAt: device.created_at,
    },
    repairHistory,
    ownershipHistory,
    trustScore: trust,
    confidence,
    parts: parts || [],
    warranties: warranties || [],
  });
});

// Device Comparison — this device vs. the average for its device_type.
// Computed on the fly across other devices of the same category. Fine at
// small/medium scale; if the device catalog grows very large, this should
// move to a cached/precomputed value instead of a live per-request scan.
router.get('/:serialNumber/comparison', async (req, res) => {
  const { serialNumber } = req.params;

  const { data: device } = await supabase
    .from('devices')
    .select('*')
    .eq('serial_number', serialNumber)
    .maybeSingle();

  if (!device) {
    return res.status(404).json({ error: 'No device found for that serial number.' });
  }

  const { data: peers } = await supabase
    .from('devices')
    .select('serial_number, ownership_transfer_count')
    .neq('serial_number', serialNumber)
    .limit(200);
  const peerList = peers || [];

  const { data: allRepairLogs } = await supabase
    .from('repair_logs')
    .select('serial_number, verification_status');

  const repairCountBySerial = {};
  (allRepairLogs || []).forEach((r) => {
    repairCountBySerial[r.serial_number] = (repairCountBySerial[r.serial_number] || 0) + 1;
  });

  const { data: thisDeviceRepairs } = await supabase
    .from('repair_logs')
    .select('id, description, repair_date, verification_status')
    .eq('serial_number', serialNumber);

  const { data: thisDeviceOwnership } = await supabase
    .from('ownership_events')
    .select('transferred_at')
    .eq('serial_number', serialNumber);

  const thisTrust = calculateTrustScore({
    repairLogs: thisDeviceRepairs || [],
    ownershipCount: device.ownership_transfer_count,
    ownershipEvents: thisDeviceOwnership || [],
  });

  const peerSerials = peerList.map((p) => p.serial_number);

  const { data: peerRepairLogs } = peerSerials.length
    ? await supabase.from('repair_logs').select('serial_number, id, description, repair_date, verification_status').in('serial_number', peerSerials)
    : { data: [] };
  const { data: peerOwnershipEvents } = peerSerials.length
    ? await supabase.from('ownership_events').select('serial_number, transferred_at').in('serial_number', peerSerials)
    : { data: [] };

  const peerRepairsBySerial = {};
  (peerRepairLogs || []).forEach((r) => {
    if (!peerRepairsBySerial[r.serial_number]) peerRepairsBySerial[r.serial_number] = [];
    peerRepairsBySerial[r.serial_number].push(r);
  });
  const peerOwnershipBySerial = {};
  (peerOwnershipEvents || []).forEach((e) => {
    if (!peerOwnershipBySerial[e.serial_number]) peerOwnershipBySerial[e.serial_number] = [];
    peerOwnershipBySerial[e.serial_number].push(e);
  });

  const peerTrustScores = peerList.map((p) =>
    calculateTrustScore({
      repairLogs: peerRepairsBySerial[p.serial_number] || [],
      ownershipCount: p.ownership_transfer_count || 1,
      ownershipEvents: peerOwnershipBySerial[p.serial_number] || [],
    }).score
  );
  const avgTrustScore = peerTrustScores.length
    ? Math.round(peerTrustScores.reduce((a, b) => a + b, 0) / peerTrustScores.length)
    : thisTrust.score;

  const avgOwnership = peerList.length
    ? peerList.reduce((sum, p) => sum + (p.ownership_transfer_count || 1), 0) / peerList.length
    : device.ownership_transfer_count;

  const avgRepairs = peerList.length
    ? peerList.reduce((sum, p) => sum + (repairCountBySerial[p.serial_number] || 0), 0) / peerList.length
    : (thisDeviceRepairs || []).length;

  res.json({
    deviceType: device.device_type || 'this category',
    sampleSize: peerList.length,
    metrics: [
      { label: 'Trust Score', thisDevice: thisTrust.score, marketAverage: avgTrustScore },
      { label: 'Ownership count', thisDevice: device.ownership_transfer_count, marketAverage: Math.round(avgOwnership * 10) / 10 },
      { label: 'Repairs logged', thisDevice: (thisDeviceRepairs || []).length, marketAverage: Math.round(avgRepairs * 10) / 10 },
    ],
  });
});

module.exports = router;
