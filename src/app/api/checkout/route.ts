import { getStripe, STRIPE_PRICES } from '@/lib/stripe';

export const runtime = 'nodejs';

type CheckoutBody = {
  plan?: 'trial' | 'monthly';
  email?: string;
};

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as CheckoutBody;
    const plan = body.plan === 'monthly' ? 'monthly' : 'trial';
    const email = body.email?.trim().toLowerCase();

    const stripe = getStripe();
    // Prefer env; fall back to hardcoded $1.97 trial / unlock price ID
    const monthlyPriceId = STRIPE_PRICES.monthly;
    const trialPriceId = STRIPE_PRICES.trial || monthlyPriceId;

    if (!monthlyPriceId) {
      return Response.json(
        { error: 'STRIPE_PRICE_ID_MONTHLY is not configured' },
        { status: 500 }
      );
    }

    // Unlock / $1.97 pass uses trial price (or monthly env when trial unset).
    const primaryPriceId = plan === 'trial' ? trialPriceId : monthlyPriceId;
    const price = await stripe.prices.retrieve(primaryPriceId);
    const isRecurring = Boolean(price.recurring);

    // One-time prices (e.g. $1.97 pass) require payment mode.
    // Recurring prices use subscription mode.
    const mode = isRecurring ? 'subscription' : 'payment';
    const resolvedPlan = mode === 'payment' ? 'trial' : plan;

    const successUrl = `${appUrl()}/success?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${appUrl()}/pricing?canceled=1`;

    const session = await stripe.checkout.sessions.create(
      mode === 'payment'
        ? {
            mode: 'payment',
            customer_email: email || undefined,
            line_items: [{ price: primaryPriceId, quantity: 1 }],
            success_url: successUrl,
            cancel_url: cancelUrl,
            allow_promotion_codes: true,
            metadata: {
              plan: resolvedPlan,
              app: 'remote-ready-hq',
              checkout_mode: 'payment',
            },
          }
        : {
            mode: 'subscription',
            customer_email: email || undefined,
            line_items: [{ price: primaryPriceId, quantity: 1 }],
            success_url: successUrl,
            cancel_url: cancelUrl,
            allow_promotion_codes: true,
            subscription_data: {
              trial_period_days: plan === 'trial' ? 3 : undefined,
              metadata: {
                plan,
                app: 'remote-ready-hq',
              },
            },
            metadata: {
              plan,
              app: 'remote-ready-hq',
              checkout_mode: 'subscription',
            },
          }
    );

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
