import { createClient } from '@supabase/supabase-js';

function normalizeSupabaseUrl(url: string) {
  return url
    .trim()
    .replace(/\/rest\/v1\/?$/, '')
    .replace(/\/$/, '');
}

function assertServerSide() {
  if (typeof window !== 'undefined') {
    throw new Error('Supabase secret client cannot be used in browser code.');
  }
}

export function createSupabaseServerClient() {
  assertServerSide();

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl || !supabaseSecretKey) {
    throw new Error('Supabase server environment variables are not configured.');
  }

  return createClient(normalizeSupabaseUrl(supabaseUrl), supabaseSecretKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
