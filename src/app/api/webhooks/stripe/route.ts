import { getStripe } from '@/lib/stripe';
import { createAdminSupabase } from '@/lib/supabase';
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
  const admin = createAdminSupabase();
  const email = params.email.toLowerCase();

  const { data: existingUser } = await admin
    .from('users')
    .select('id')
    .eq('email', email)
    .maybeSingle();

  const unlocked =
    params.status === 'active' ||
    params.status === 'trialing' ||
    params.status === 'paid';
  const unlockExpiresAt = params.currentPeriodEnd
    ? new Date(params.currentPeriodEnd * 1000).toISOString()
    : unlocked
      ? new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString()
      : null;

  const userPayload: Record<string, unknown> = {
    email,
    stripe_customer_id: params.stripeCustomerId ?? null,
    updated_at: new Date().toISOString(),
    active_subscriber: unlocked,
    unlock_expires_at: unlockExpiresAt,
  };

  let userId = existingUser?.id as string | undefined;
  if (!userId) {
    const { data: created, error } = await admin
      .from('users')
      .insert(userPayload)
      .select('id')
      .single();
    if (error) {
      // Retry without unlock columns if schema not migrated yet
      const { data: createdFallback, error: fallbackErr } = await admin
        .from('users')
        .insert({
          email,
          stripe_customer_id: params.stripeCustomerId ?? null,
          updated_at: new Date().toISOString(),
        })
        .select('id')
        .single();
      if (fallbackErr) throw fallbackErr;
      userId = createdFallback.id;
    } else {
      userId = created.id;
    }
  } else {
    const { error: updateErr } = await admin
      .from('users')
      .update(userPayload)
      .eq('id', userId);
    if (updateErr) {
      await admin
        .from('users')
        .update({
          stripe_customer_id: params.stripeCustomerId ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', userId);
    }
  }

  const row = {
    user_id: userId,
    email,
    stripe_customer_id: params.stripeCustomerId ?? null,
    stripe_subscription_id: params.stripeSubscriptionId ?? null,
    stripe_price_id: params.stripePriceId ?? null,
    status: params.status,
    plan: params.plan,
    current_period_end: params.currentPeriodEnd
      ? new Date(params.currentPeriodEnd * 1000).toISOString()
      : null,
    updated_at: new Date().toISOString(),
  };

  if (params.stripeSubscriptionId) {
    const { data: existingSub } = await admin
      .from('subscriptions')
      .select('id')
      .eq('stripe_subscription_id', params.stripeSubscriptionId)
      .maybeSingle();

    if (existingSub?.id) {
      await admin.from('subscriptions').update(row).eq('id', existingSub.id);
      return;
    }
  }

  await admin.from('subscriptions').insert(row);
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

        if (stripeSubscriptionId) {
          const sub = await stripe.subscriptions.retrieve(stripeSubscriptionId);
          status = sub.status;
          plan = planFromSubscription(sub);
          currentPeriodEnd = periodEndFromSubscription(sub);
          priceId = sub.items.data[0]?.price?.id ?? null;
        } else if (session.mode === 'payment') {
          // One-time $1.97 pass — grant a 3-day access window
          status = 'trialing';
          plan = 'trial';
          currentPeriodEnd =
            Math.floor(Date.now() / 1000) + 3 * 24 * 60 * 60;
          stripeSubscriptionId = session.id;
          const full = await stripe.checkout.sessions.retrieve(session.id, {
            expand: ['line_items'],
          });
          const linePrice = full.line_items?.data?.[0]?.price;
          priceId =
            linePrice && typeof linePrice === 'object' ? linePrice.id : null;
        }

        await upsertSubscriber({
          email,
          stripeCustomerId:
            typeof session.customer === 'string'
              ? session.customer
              : session.customer?.id ?? null,
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
