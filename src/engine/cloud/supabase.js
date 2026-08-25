const { createClient } = require('@supabase/supabase-js');

function createSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase URL or service role key not set');
  return createClient(url, key, { auth: { persistSession: false } });
}

module.exports = { createSupabaseAdmin };
