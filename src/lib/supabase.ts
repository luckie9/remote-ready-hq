import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;

const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

function requireEnv(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value;
}

/** Browser / server client with publishable (anon) privileges. */
export function createBrowserSupabase(): SupabaseClient {
  return createClient(
    requireEnv(supabaseUrl, 'NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv(supabaseAnonKey, 'NEXT_PUBLIC_SUPABASE_ANON_KEY')
  );
}

/** Server-only client with secret key (bypasses RLS). */
export function createAdminSupabase(): SupabaseClient {
  return createClient(
    requireEnv(supabaseUrl, 'NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv(supabaseSecretKey, 'SUPABASE_SECRET_KEY')
  );
}

export const supabase = createBrowserSupabase();
