const express = require('express');
const supabase = require('../db/database');

const router = express.Router();

// Public repair shop profile — company name, registered status, location,
// aggregate rating (once ratings exist), and their recent logged repairs.
router.get('/:id/profile', async (req, res) => {
  const { id } = req.params;

  const { data: company } = await supabase
    .from('repair_companies')
    .select('id, company_name, registered_shop, city, created_at')
    .eq('id', id)
    .maybeSingle();

  if (!company) {
    return res.status(404).json({ error: 'No repair shop found with that ID.' });
  }

  const { data: repairs, count: repairCount } = await supabase
    .from('repair_logs')
    .select('id, serial_number, description, repair_date, verification_status', { count: 'exact' })
    .eq('repair_company_id', id)
    .order('repair_date', { ascending: false })
    .limit(20);

  const repairIds = (repairs || []).map((r) => r.id);
  let avgRating = null;
  let ratingCount = 0;
  if (repairIds.length > 0) {
    const { data: ratings } = await supabase
      .from('repair_ratings')
      .select('stars')
      .in('repair_log_id', repairIds);
    if (ratings && ratings.length > 0) {
      ratingCount = ratings.length;
      avgRating = Math.round((ratings.reduce((a, b) => a + b.stars, 0) / ratings.length) * 10) / 10;
    }
  }

  res.json({
    company: {
      id: company.id,
      name: company.company_name,
      registeredShop: !!company.registered_shop,
      city: company.city || null,
    },
    repairCount: repairCount || 0,
    rating: avgRating ? { average: avgRating, count: ratingCount } : null,
    recentRepairs: (repairs || []).map((r) => ({
      id: r.id,
      serialNumber: r.serial_number,
      description: r.description,
      repairDate: r.repair_date,
      verificationStatus: r.verification_status,
    })),
  });
});

module.exports = router;
