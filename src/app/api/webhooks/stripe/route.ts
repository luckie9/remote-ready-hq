import { getStripe } from '@/lib/stripe';
import { saveStripeCustomerLink, findStripeCustomerByEmail } from '@/lib/stripe-mapping';
import type Stripe from 'stripe';

export const runtime = 'nodejs';

async function upsertSubscriber(params: {
  email: string;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  stripePriceId?: string | null;
  status: string;
  plan: string;
  currentPeriodEnd?: number | null;
}) {
  await saveStripeCustomerLink({
    email: params.email,
    customerId: params.stripeCustomerId ?? null,
    subscriptionId: params.stripeSubscriptionId ?? null,
    status: params.status,
    plan: params.plan,
    priceId: params.stripePriceId ?? null,
    currentPeriodEnd: params.currentPeriodEnd
      ? new Date(params.currentPeriodEnd * 1000).toISOString()
      : null,
  });
}

function periodEndFromSubscription(sub: Stripe.Subscription): number | null {
  const fromItem = sub.items?.data?.[0]?.current_period_end;
  if (typeof fromItem === 'number') return fromItem;
  return null;
}

function planFromSubscription(sub: Stripe.Subscription): 'trial' | 'monthly' {
  if (sub.status === 'trialing') return 'trial';
  return 'monthly';
}

export async function POST(request: Request) {
  const stripe = getStripe();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const rawBody = await request.text();
  const signature = request.headers.get('stripe-signature');

  let event: Stripe.Event;
  try {
    if (webhookSecret && signature) {
      event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
    } else {
      // Local/dev fallback when webhook secret is not configured yet
      event = JSON.parse(rawBody) as Stripe.Event;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid webhook';
    return Response.json({ error: message }, { status: 400 });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const email =
          session.customer_details?.email ||
          session.customer_email ||
          session.metadata?.email;
        if (!email) break;

        let status = 'active';
        let plan = session.metadata?.plan === 'monthly' ? 'monthly' : 'trial';
        let stripeSubscriptionId =
          typeof session.subscription === 'string'
            ? session.subscription
            : session.subscription?.id ?? null;
        let currentPeriodEnd: number | null = null;
        let priceId: string | null = null;
        let stripeCustomerId =
          typeof session.customer === 'string'
            ? session.customer
            : session.customer?.id ?? null;

        if (stripeSubscriptionId?.startsWith('sub_')) {
          const sub = await stripe.subscriptions.retrieve(stripeSubscriptionId);
          status = sub.status;
          plan = planFromSubscription(sub);
          currentPeriodEnd = periodEndFromSubscription(sub);
          priceId = sub.items.data[0]?.price?.id ?? null;
          const customer =
            typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
          stripeCustomerId = stripeCustomerId || customer || null;
        } else if (session.mode === 'payment') {
          status = 'trialing';
          plan = 'trial';
          currentPeriodEnd =
            Math.floor(Date.now() / 1000) + 3 * 24 * 60 * 60;
          stripeSubscriptionId = null;
        }

        if (!stripeCustomerId || !stripeSubscriptionId) {
          const found = await findStripeCustomerByEmail(email);
          stripeCustomerId = stripeCustomerId || found?.customerId || null;
          stripeSubscriptionId = stripeSubscriptionId || found?.subscriptionId || null;
          if (found?.status) status = found.status;
        }

        await upsertSubscriber({
          email,
          stripeCustomerId,
          stripeSubscriptionId,
          stripePriceId: priceId,
          status,
          plan,
          currentPeriodEnd,
        });
        break;
      }
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        const customerId =
          typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
        const customer = await stripe.customers.retrieve(customerId);
        if (customer.deleted || !('email' in customer) || !customer.email) break;

        await upsertSubscriber({
          email: customer.email,
          stripeCustomerId: customerId,
          stripeSubscriptionId: sub.id,
          stripePriceId: sub.items.data[0]?.price?.id ?? null,
          status: event.type === 'customer.subscription.deleted' ? 'canceled' : sub.status,
          plan: planFromSubscription(sub),
          currentPeriodEnd: periodEndFromSubscription(sub),
        });
        break;
      }
      default:
        break;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Webhook handler failed';
    return Response.json({ error: message }, { status: 500 });
  }

  return Response.json({ received: true });
}
