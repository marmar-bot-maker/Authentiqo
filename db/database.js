// Connects to your Supabase Postgres database.
// Every buyer, seller, and repair shop hitting your deployed API — from any
// device — reads and writes the same shared data through this one client.
//
// SUPABASE_URL and SUPABASE_SERVICE_KEY come from your Supabase project's
// Settings -> API page. The "service_role" key is used (not the public
// "anon" key) because this is a trusted backend server, not a browser.
// NEVER put the service_role key in any frontend/browser code.

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error(
    'Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in your .env file. ' +
    'Copy .env.example to .env and fill both in before starting the server.'
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

module.exports = supabase;
