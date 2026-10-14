import { getStripe, PLAN_AMOUNTS, STRIPE_PRICES, DEFAULT_STRIPE_PRICE_ID_MONTHLY } from '@/lib/stripe';
import { findStripeCustomerByEmail } from '@/lib/stripe-mapping';

export const runtime = 'nodejs';

type CheckoutBody = {
  plan?: 'trial' | 'monthly';
  email?: string;
};

const PRODUCTION_APP_URL = 'https://remotereadyhq.com';

/** Prefer live request origin, then public/Vercel env, never sticky localhost in prod. */
function resolveAppUrl(request: Request): string {
  try {
    const requestOrigin = new URL(request.url).origin;
    if (requestOrigin) {
      // Stripe redirects hit this host directly — trust non-local request URL.
      if (!/localhost|127\.0\.0\.1/i.test(requestOrigin)) {
        return requestOrigin;
      }
    }
  } catch {
    // ignore malformed URL
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

  // Local browser hitting a local API — keep localhost when requested
  if (origin && /localhost|127\.0\.0\.1/i.test(origin)) {
    return origin;
  }
  if (host && /localhost|127\.0\.0\.1/i.test(host)) {
    const proto = request.headers.get('x-forwarded-proto') || 'http';
    return `${proto}://${host}`.replace(/\/$/, '');
  }

  try {
    const requestOrigin = new URL(request.url).origin;
    if (requestOrigin) return requestOrigin;
  } catch {
    // ignore
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

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as CheckoutBody;
    const plan = body.plan === 'monthly' ? 'monthly' : 'trial';
    const email = body.email?.trim().toLowerCase();

    const stripe = getStripe();
    const configuredMonthly = await stripe.prices.retrieve(STRIPE_PRICES.monthly);
    const recurringPriceId = configuredMonthly.recurring
      ? configuredMonthly.id
      : DEFAULT_STRIPE_PRICE_ID_MONTHLY;
    const trialFeeId = STRIPE_PRICES.trial;

    const existingCustomer = email
      ? await findStripeCustomerByEmail(email)
      : null;

    const appBase = resolveAppUrl(request);
    const successUrl = `${appBase}/api/stripe/success?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${appBase}/pricing?canceled=1`;

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      ...(existingCustomer?.customerId
        ? { customer: existingCustomer.customerId }
        : { customer_email: email || undefined }),
      line_items:
        plan === 'trial'
          ? [
              { price: trialFeeId, quantity: 1 },
              { price: recurringPriceId, quantity: 1 },
            ]
          : [{ price: recurringPriceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      allow_promotion_codes: true,
      subscription_data: {
        ...(plan === 'trial' ? { trial_period_days: PLAN_AMOUNTS.trialDays } : {}),
        metadata: {
          plan,
          app: 'remote-ready-hq',
        },
      },
      metadata: {
        plan,
        app: 'remote-ready-hq',
        checkout_mode: 'subscription',
        ...(email ? { email } : {}),
      },
    });

    if (!session.url) {
      return Response.json(
        { error: 'Stripe did not return a checkout URL' },
        { status: 500 }
      );
    }

    return Response.json({ url: session.url, id: session.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Checkout failed';
    return Response.json({ error: message }, { status: 500 });
  }
}
