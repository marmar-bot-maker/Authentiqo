const express = require('express');
const bcrypt = require('bcryptjs');
const supabase = require('../db/database');
const { signToken } = require('../middleware/auth');

const router = express.Router();

function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ---------- Repairman (company) auth ----------

router.post('/repairman/signup', async (req, res) => {
  const { companyEmail, username, password, companyName, registeredShop } = req.body;

  if (!isValidEmail(companyEmail) || !username || !password || !companyName) {
    return res.status(400).json({ error: 'Company email, username, password, and company name are all required.' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }

  const { data: existing } = await supabase
    .from('repair_companies')
    .select('id')
    .eq('company_email', companyEmail)
    .maybeSingle();

  if (existing) {
    return res.status(409).json({ error: 'An account with that company email already exists.' });
  }

  const passwordHash = bcrypt.hashSync(password, 10);
  const { data: company, error } = await supabase
    .from('repair_companies')
    .insert({
      company_email: companyEmail,
      username,
      password_hash: passwordHash,
      company_name: companyName,
      registered_shop: !!registeredShop,
    })
    .select()
    .single();

  if (error) {
    console.error(error);
    return res.status(500).json({ error: 'Could not create account. Please try again.' });
  }

  const token = signToken({ role: 'repairman', id: company.id, companyName });
  res.status(201).json({ token, companyName, registeredShop: !!registeredShop });
});

router.post('/repairman/login', async (req, res) => {
  const { companyEmail, password } = req.body;
  if (!isValidEmail(companyEmail) || !password) {
    return res.status(400).json({ error: 'Company email and password are required.' });
  }

  const { data: company } = await supabase
    .from('repair_companies')
    .select('*')
    .eq('company_email', companyEmail)
    .maybeSingle();

  if (!company || !bcrypt.compareSync(password, company.password_hash)) {
    return res.status(401).json({ error: 'Incorrect email or password.' });
  }

  const token = signToken({ role: 'repairman', id: company.id, companyName: company.company_name });
  res.json({ token, companyName: company.company_name, registeredShop: !!company.registered_shop });
});

// ---------- Seller auth ----------

router.post('/seller/signup', async (req, res) => {
  const { email, password, displayName } = req.body;

  if (!isValidEmail(email) || !password || !displayName) {
    return res.status(400).json({ error: 'Email, password, and display name are all required.' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }

  const { data: existing } = await supabase
    .from('sellers')
    .select('id')
    .eq('email', email)
    .maybeSingle();

  if (existing) {
    return res.status(409).json({ error: 'An account with that email already exists.' });
  }

  const passwordHash = bcrypt.hashSync(password, 10);
  const { data: seller, error } = await supabase
    .from('sellers')
    .insert({ email, password_hash: passwordHash, display_name: displayName })
    .select()
    .single();

  if (error) {
    console.error(error);
    return res.status(500).json({ error: 'Could not create account. Please try again.' });
  }

  const token = signToken({ role: 'seller', id: seller.id, displayName });
  res.status(201).json({ token, displayName });
});

router.post('/seller/login', async (req, res) => {
  const { email, password } = req.body;
  if (!isValidEmail(email) || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const { data: seller } = await supabase
    .from('sellers')
    .select('*')
    .eq('email', email)
    .maybeSingle();

  if (!seller || !bcrypt.compareSync(password, seller.password_hash)) {
    return res.status(401).json({ error: 'Incorrect email or password.' });
  }

  const token = signToken({ role: 'seller', id: seller.id, displayName: seller.display_name });
  res.json({ token, displayName: seller.display_name });
});

module.exports = router;
