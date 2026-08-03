// Optional: populates the database with one demo device so you have
// something to search for on the buyer page right after setup.
// Run with: npm run seed

require('dotenv').config();
const bcrypt = require('bcryptjs');
const supabase = require('./database');

const companyEmail = 'repairs@demoshop.test';
const sellerEmail = 'seller@demoshop.test';
const serial = 'SN-DEMO-0001';

async function upsertCompany() {
  const { data: existing } = await supabase
    .from('repair_companies')
    .select('*')
    .eq('company_email', companyEmail)
    .maybeSingle();
  if (existing) return existing;

  const hash = bcrypt.hashSync('password123', 10);
  const { data, error } = await supabase
    .from('repair_companies')
    .insert({
      company_email: companyEmail,
      username: 'demo_tech',
      password_hash: hash,
      company_name: 'Demo Repair Shop',
      registered_shop: true,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function upsertSeller() {
  const { data: existing } = await supabase
    .from('sellers')
    .select('*')
    .eq('email', sellerEmail)
    .maybeSingle();
  if (existing) return existing;

  const hash = bcrypt.hashSync('password123', 10);
  const { data, error } = await supabase
    .from('sellers')
    .insert({ email: sellerEmail, password_hash: hash, display_name: 'Demo Seller' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function seed() {
  const company = await upsertCompany();
  const seller = await upsertSeller();

  const { data: existingDevice } = await supabase
    .from('devices')
    .select('*')
    .eq('serial_number', serial)
    .maybeSingle();

  if (!existingDevice) {
    await supabase.from('devices').insert({
      serial_number: serial,
      device_type: 'Laptop',
      brand: 'Aster',
      model: 'Slate 14',
      manufactured_date: '2023-02-10',
      registered_by_seller_id: seller.id,
      ownership_transfer_count: 1,
    });
    await supabase.from('ownership_events').insert({ serial_number: serial, new_owner_number: 1 });

    await supabase.from('repair_logs').insert({
      serial_number: serial,
      repair_company_id: company.id,
      description: 'Replaced battery',
      location: 'Austin, TX',
      repair_date: '2024-05-14',
      verification_status: 'verified',
    });

    await supabase.from('repair_logs').insert({
      serial_number: serial,
      repair_company_id: company.id,
      description: 'Screen replacement after minor crack',
      location: 'Austin, TX',
      repair_date: '2025-01-22',
      verification_status: 'verified',
    });

    console.log('Seeded demo device:', serial);
  } else {
    console.log('Demo device already exists:', serial);
  }

  console.log('\nDemo logins:');
  console.log(`  Repairman -> email: ${companyEmail}  password: password123`);
  console.log(`  Seller    -> email: ${sellerEmail}  password: password123`);
  console.log(`\nBuyer lookup -> serial: ${serial}`);
}

seed().catch((err) => {
  console.error('Seeding failed:', err.message);
  process.exit(1);
});
