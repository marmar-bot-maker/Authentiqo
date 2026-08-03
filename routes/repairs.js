const express = require('express');
const supabase = require('../db/database');
const { requireRole } = require('../middleware/auth');

const router = express.Router();

// Log a repair entry. Requires repairman (company) authentication.
// Entries are immutable: there is intentionally no PUT/PATCH/DELETE route for repair_logs.
router.post('/', requireRole('repairman'), async (req, res) => {
  const { serialNumber, description, location, repairDate, verificationStatus, parts, warranty } = req.body;

  if (!serialNumber || !description || !location || !repairDate) {
    return res.status(400).json({ error: 'Serial number, description, location, and repair date are all required.' });
  }
  if (!['verified', 'self_reported'].includes(verificationStatus)) {
    return res.status(400).json({ error: 'Verification status must be "verified" or "self_reported".' });
  }
  const cleanParts = Array.isArray(parts)
    ? parts
        .map((p) => ({ partName: (p.partName || '').trim(), authenticityStatus: p.authenticityStatus }))
        .filter((p) => p.partName && ['genuine', 'aftermarket', 'unknown'].includes(p.authenticityStatus))
    : [];
  const hasWarranty = warranty && warranty.coverageDescription && warranty.endDate;

  const { data: device } = await supabase
    .from('devices')
    .select('serial_number')
    .eq('serial_number', serialNumber)
    .maybeSingle();

  if (!device) {
    // A device does not need to be pre-registered by a seller for a repairman to log against it —
    // manufacturing/repair history can exist before a seller ever registers the device for resale.
    await supabase.from('devices').insert({ serial_number: serialNumber });
  }

  const { data: entry, error } = await supabase
    .from('repair_logs')
    .insert({
      serial_number: serialNumber,
      repair_company_id: req.user.id,
      description,
      location,
      repair_date: repairDate,
      verification_status: verificationStatus,
    })
    .select()
    .single();

  if (error) {
    console.error(error);
    return res.status(500).json({ error: 'Could not save the repair entry.' });
  }

  // Parts authenticity and warranty are optional add-ons to a repair entry, logged by
  // the same repair shop at the same time. Neither failing should undo the repair log
  // itself — it's already saved and immutable — so these are best-effort writes.
  if (cleanParts.length > 0) {
    await supabase.from('device_parts').insert(
      cleanParts.map((p) => ({
        serial_number: serialNumber,
        part_name: p.partName,
        authenticity_status: p.authenticityStatus,
        logged_by_repair_company_id: req.user.id,
      }))
    );
  }

  if (hasWarranty) {
    await supabase.from('warranties').insert({
      serial_number: serialNumber,
      warranty_type: 'repair_shop',
      status: 'active',
      coverage_description: warranty.coverageDescription,
      start_date: repairDate,
      end_date: warranty.endDate,
      issued_by_repair_company_id: req.user.id,
    });
  }

  const { data: company } = await supabase
    .from('repair_companies')
    .select('company_name')
    .eq('id', req.user.id)
    .maybeSingle();

  res.status(201).json({ entry: { ...entry, company_name: company ? company.company_name : null } });
});

// List repair entries logged by the authenticated repair company (their own dashboard history)
router.get('/mine', requireRole('repairman'), async (req, res) => {
  const { data: entries, error } = await supabase
    .from('repair_logs')
    .select('*')
    .eq('repair_company_id', req.user.id)
    .order('created_at', { ascending: false });

  if (error) {
    console.error(error);
    return res.status(500).json({ error: 'Could not load repair entries.' });
  }

  res.json({ entries: entries || [] });
});

module.exports = router;
