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
    // Prefer env; fall back to hardcoded $1.97 trial price ID
    const monthlyPrice = STRIPE_PRICES.monthly;
    const trialPrice = STRIPE_PRICES.trial || monthlyPrice;

    if (!monthlyPrice) {
      return Response.json(
        { error: 'STRIPE_PRICE_ID_MONTHLY is not configured' },
        { status: 500 }
      );
    }

    const lineItems: { price: string; quantity: number }[] = [
      { price: monthlyPrice, quantity: 1 },
    ];

    // Paid trial: charge $1.97 immediately as a one-time line item while
    // starting the monthly subscription after a 3-day trial window.
    // Skip duplicate when monthly env already points at the trial price.
    if (plan === 'trial' && trialPrice && trialPrice !== monthlyPrice) {
      lineItems.push({ price: trialPrice, quantity: 1 });
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer_email: email || undefined,
      line_items: lineItems,
      success_url: `${appUrl()}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl()}/pricing?canceled=1`,
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
      },
    });

    if (!session.url) {
      return Response.json({ error: 'Stripe did not return a checkout URL' }, { status: 500 });
    }

    return Response.json({ url: session.url, id: session.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Checkout failed';
    return Response.json({ error: message }, { status: 500 });
  }
}
