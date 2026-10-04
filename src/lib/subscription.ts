import { createHmac, timingSafeEqual } from 'crypto';
import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { createAdminSupabase, isMissingRelationError } from '@/lib/supabase';

const COOKIE_NAME = 'rrhq_sub';
const MAX_AGE_SECONDS = 60 * 60 * 24 * 35; // ~35 days

function getSecret(): string {
  return (
    process.env.SUBSCRIPTION_COOKIE_SECRET ||
    process.env.STRIPE_SECRET_KEY ||
    'dev-insecure-secret'
  );
}

function sign(payload: string): string {
  return createHmac('sha256', getSecret()).update(payload).digest('base64url');
}

export type SubscriberSession = {
  email: string;
  status: 'trialing' | 'active';
  plan: 'trial' | 'monthly';
  exp: number;
};

export function encodeSubscriberCookie(session: SubscriberSession): string {
  const body = Buffer.from(JSON.stringify(session), 'utf8').toString('base64url');
  return `${body}.${sign(body)}`;
}

export function decodeSubscriberCookie(value: string | undefined): SubscriberSession | null {
  if (!value) return null;
  const [body, sig] = value.split('.');
  if (!body || !sig) return null;
  const expected = sign(body);
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  try {
    const session = JSON.parse(
      Buffer.from(body, 'base64url').toString('utf8')
    ) as SubscriberSession;
    if (!session.email || !session.exp || Date.now() > session.exp) return null;
    if (session.status !== 'trialing' && session.status !== 'active') return null;
    return session;
  } catch {
    return null;
  }
}

export async function getSubscriberSession(): Promise<SubscriberSession | null> {
  const jar = await cookies();
  return decodeSubscriberCookie(jar.get(COOKIE_NAME)?.value);
}

function isUnlockStatus(status: string | null | undefined): boolean {
  return status === 'active' || status === 'trialing' || status === 'paid';
}

/** Look up paid/unlocked entitlement from Supabase for an email. */
export async function lookupDbEntitlement(
  email: string
): Promise<SubscriberSession | null> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return null;

  try {
    const admin = createAdminSupabase();

    // 1) subscriptions table (primary)
    const { data: sub, error: subErr } = await admin
      .from('subscriptions')
      .select('email, status, plan, current_period_end')
      .eq('email', normalized)
      .in('status', ['active', 'trialing', 'paid'])
      .order('current_period_end', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (subErr && !isMissingRelationError(subErr)) {
      console.warn('[subscription] subscriptions lookup failed:', subErr.message);
    }

    if (sub && isUnlockStatus(sub.status)) {
      const exp = sub.current_period_end
        ? new Date(sub.current_period_end).getTime()
        : Date.now() + 30 * 24 * 60 * 60 * 1000;
      if (Date.now() <= exp) {
        const status: 'active' | 'trialing' =
          sub.status === 'trialing' ? 'trialing' : 'active';
        const plan: 'trial' | 'monthly' =
          sub.plan === 'trial' || status === 'trialing' ? 'trial' : 'monthly';
        return { email: normalized, status, plan, exp };
      }
    }

    // 2) users.active_subscriber flag (set by Stripe webhook / checkout)
    const { data: userRow, error: userErr } = await admin
      .from('users')
      .select('email, active_subscriber, unlock_expires_at')
      .eq('email', normalized)
      .maybeSingle();

    if (userErr) {
      // Column may not exist yet — ignore schema-cache / missing column errors
      if (
        !isMissingRelationError(userErr) &&
        !/active_subscriber|unlock_expires_at|column/i.test(userErr.message)
      ) {
        console.warn('[subscription] users lookup failed:', userErr.message);
      }
      return null;
    }

    if (userRow?.active_subscriber) {
      const exp = userRow.unlock_expires_at
        ? new Date(userRow.unlock_expires_at).getTime()
        : Date.now() + 30 * 24 * 60 * 60 * 1000;
      if (Date.now() <= exp) {
        return {
          email: normalized,
          status: 'active',
          plan: 'monthly',
          exp,
        };
      }
    }

    return null;
  } catch (err) {
    console.warn(
      '[subscription] DB entitlement lookup error:',
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

/** Cookie entitlement, or an active/trialing Supabase subscription for the signed-in user. */
export async function getEffectiveSubscriberSession(): Promise<SubscriberSession | null> {
  const fromCookie = await getSubscriberSession();
  if (fromCookie) return fromCookie;

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const email = user?.email?.trim().toLowerCase();
    if (!email) return null;
    return lookupDbEntitlement(email);
  } catch {
    return null;
  }
}

export async function setSubscriberCookie(session: SubscriberSession): Promise<void> {
  const jar = await cookies();
  jar.set(COOKIE_NAME, encodeSubscriberCookie(session), subscriberCookieOptions());
}

export function subscriberCookieOptions(): {
  httpOnly: boolean;
  sameSite: 'lax';
  secure: boolean;
  path: string;
  maxAge: number;
} {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: MAX_AGE_SECONDS,
  };
}

/** Attach entitlement cookie to a Route Handler response (legal cookie write path). */
export function applySubscriberCookie(
  response: { cookies: { set: (name: string, value: string, options: object) => void } },
  session: SubscriberSession
): void {
  response.cookies.set(
    COOKIE_NAME,
    encodeSubscriberCookie(session),
    subscriberCookieOptions()
  );
}

export async function clearSubscriberCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE_NAME);
}

export { COOKIE_NAME };
