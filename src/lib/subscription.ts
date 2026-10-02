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

    const admin = createAdminSupabase();
    const { data, error } = await admin
      .from('subscriptions')
      .select('email, status, plan, current_period_end')
      .eq('email', email)
      .in('status', ['active', 'trialing'])
      .order('current_period_end', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      if (!isMissingRelationError(error)) {
        console.warn('[subscription] DB lookup failed:', error.message);
      }
      return null;
    }
    if (!data) return null;

    const exp = data.current_period_end
      ? new Date(data.current_period_end).getTime()
      : Date.now() + 30 * 24 * 60 * 60 * 1000;
    if (Date.now() > exp) return null;

    const status: 'active' | 'trialing' =
      data.status === 'trialing' ? 'trialing' : 'active';
    const plan: 'trial' | 'monthly' =
      data.plan === 'trial' || status === 'trialing' ? 'trial' : 'monthly';

    return {
      email,
      status,
      plan,
      exp,
    };
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
