import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;

const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

const supabaseSecretKey =
  process.env.SUPABASE_SECRET_KEY ??
  process.env.SUPABASE_SERVICE_ROLE_KEY;

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

/** Server-only client with secret/service-role key (bypasses RLS). */
export function createAdminSupabase(): SupabaseClient {
  return createClient(
    requireEnv(supabaseUrl, 'NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv(
      supabaseSecretKey,
      'SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY)'
    )
  );
}

/** True when PostgREST/Postgres reports a missing relation. */
export function isMissingRelationError(error: {
  code?: string;
  message?: string;
} | null | undefined): boolean {
  if (!error) return false;
  const code = error.code ?? '';
  const message = (error.message ?? '').toLowerCase();
  return (
    code === '42P01' ||
    code === 'PGRST205' ||
    message.includes('does not exist') ||
    message.includes('could not find the table') ||
    message.includes('schema cache')
  );
}

export const supabase = createBrowserSupabase();
