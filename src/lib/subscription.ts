import { createHmac, timingSafeEqual } from 'crypto';
import { cookies } from 'next/headers';

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

export async function setSubscriberCookie(session: SubscriberSession): Promise<void> {
  const jar = await cookies();
  jar.set(COOKIE_NAME, encodeSubscriberCookie(session), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function clearSubscriberCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE_NAME);
}

export { COOKIE_NAME };
