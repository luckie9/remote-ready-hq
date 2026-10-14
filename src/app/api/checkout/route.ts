import { getStripe, PLAN_AMOUNTS, STRIPE_PRICES } from '@/lib/stripe';
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
    const monthlyPriceId = STRIPE_PRICES.monthly;
    const trialPriceId = STRIPE_PRICES.trial || monthlyPriceId;

    if (!monthlyPriceId) {
      return Response.json(
        { error: 'STRIPE_PRICE_ID_MONTHLY is not configured' },
        { status: 500 }
      );
    }

    const configuredPriceId = plan === 'trial' ? trialPriceId : monthlyPriceId;
    const configuredPrice = await stripe.prices.retrieve(configuredPriceId);
    const lineItems: {
      price?: string;
      quantity: number;
      price_data?: {
        currency: string;
        unit_amount: number;
        recurring: { interval: 'month' };
        product_data: { name: string };
      };
    }[] = [];

    if (plan === 'trial' && !configuredPrice.recurring) {
      lineItems.push({ price: configuredPrice.id, quantity: 1 });
    }

    if (configuredPrice.recurring) {
      lineItems.push({ price: configuredPrice.id, quantity: 1 });
    } else {
      lineItems.push({
        quantity: 1,
        price_data: {
          currency: configuredPrice.currency || 'usd',
          unit_amount: PLAN_AMOUNTS.monthlyCents,
          recurring: { interval: 'month' },
          product_data: { name: 'RemoteReady HQ Monthly Membership' },
        },
      });
    }

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
      line_items: lineItems,
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
