import { NextResponse } from 'next/server';
import {
  fulfillCheckoutSession,
  toSubscriberSession,
} from '@/lib/checkout-entitlement';
import { applySubscriberCookie } from '@/lib/subscription';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PRODUCTION_APP_URL = 'https://remote-ready-hq.vercel.app';

function resolveAppUrl(request: Request): string {
  try {
    const requestOrigin = new URL(request.url).origin;
    if (requestOrigin && !/localhost|127\.0\.0\.1/i.test(requestOrigin)) {
      return requestOrigin;
    }
    if (requestOrigin) return requestOrigin;
  } catch {
    // ignore
  }

  const fromEnv = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, '');
  if (fromEnv && !/localhost|127\.0\.0\.1/i.test(fromEnv)) {
    return fromEnv;
  }

  const origin = request.headers.get('origin')?.replace(/\/$/, '');
  if (origin && !/localhost|127\.0\.0\.1/i.test(origin)) {
    return origin;
  }

  const forwardedHost = request.headers.get('x-forwarded-host');
  const host = forwardedHost || request.headers.get('host');
  if (host && !/localhost|127\.0\.0\.1/i.test(host)) {
    const proto =
      request.headers.get('x-forwarded-proto') ||
      (host.includes('localhost') ? 'http' : 'https');
    return `${proto}://${host}`.replace(/\/$/, '');
  }

  const vercel = process.env.VERCEL_URL?.replace(/^https?:\/\//, '').replace(
    /\/$/,
    ''
  );
  if (vercel) {
    return `https://${vercel}`;
  }

  if (process.env.VERCEL || process.env.NODE_ENV === 'production') {
    return PRODUCTION_APP_URL;
  }

  return fromEnv || 'http://localhost:3000';
}

/**
 * Stripe redirects here after checkout. Cookie writes are legal in Route Handlers.
 * Then we redirect to the display-only /success page.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get('session_id');
  const appBase = resolveAppUrl(request);

  if (!sessionId) {
    return NextResponse.redirect(new URL('/pricing', appBase));
  }

  try {
    const fulfillment = await fulfillCheckoutSession(sessionId);
    if (!fulfillment) {
      return NextResponse.redirect(new URL('/pricing?checkout=failed', appBase));
    }

    const success = new URL('/success', appBase);
    success.searchParams.set('session_id', fulfillment.sessionId);
    success.searchParams.set('plan', fulfillment.plan);

    const response = NextResponse.redirect(success);
    applySubscriberCookie(response, toSubscriberSession(fulfillment));
    return response;
  } catch {
    return NextResponse.redirect(new URL('/pricing?checkout=error', appBase));
  }
}
