const express = require('express');
const supabase = require('../db/database');

const router = express.Router();

let cache = null;
let cachedAt = 0;
const TTL_MS = 60 * 1000; // homepage stats don't need to be real-time

router.get('/summary', async (req, res) => {
  if (cache && Date.now() - cachedAt < TTL_MS) {
    return res.json(cache);
  }

  const [{ count: devicesTracked }, { count: repairShops }, { count: repairsLogged }, { count: verifiedRepairs }] = await Promise.all([
    supabase.from('devices').select('*', { count: 'exact', head: true }),
    supabase.from('repair_companies').select('*', { count: 'exact', head: true }),
    supabase.from('repair_logs').select('*', { count: 'exact', head: true }),
    supabase.from('repair_logs').select('*', { count: 'exact', head: true }).eq('verification_status', 'verified'),
  ]);

  const verifiedPercentage = repairsLogged > 0 ? Math.round((verifiedRepairs / repairsLogged) * 100) : 0;

  cache = {
    devicesTracked: devicesTracked || 0,
    repairShops: repairShops || 0,
    repairsLogged: repairsLogged || 0,
    verifiedPercentage,
  };
  cachedAt = Date.now();

  res.json(cache);
});

module.exports = router;
