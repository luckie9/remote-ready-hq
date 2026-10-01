import { createClient } from '@/lib/supabase/server';

export function getAdminEmails(): string[] {
  return (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const admins = getAdminEmails();
  if (admins.length === 0) return false;
  return admins.includes(email.trim().toLowerCase());
}

/** Returns the signed-in admin email, or null if unauthorized. */
export async function requireAdminUser(): Promise<{
  email: string;
  userId: string;
} | null> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user?.email || !isAdminEmail(user.email)) return null;
    return { email: user.email, userId: user.id };
  } catch {
    return null;
  }
}

/** Optional shared-secret bypass for scripts / curl (ADMIN_API_SECRET). */
export function hasAdminApiSecret(request: Request): boolean {
  const secret = process.env.ADMIN_API_SECRET;
  if (!secret) return false;
  const header = request.headers.get('x-admin-secret');
  return Boolean(header && header === secret);
}
