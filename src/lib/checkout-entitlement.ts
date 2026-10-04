import { getStripe, PLAN_AMOUNTS } from '@/lib/stripe';
import { createAdminSupabase } from '@/lib/supabase';
import type { SubscriberSession } from '@/lib/subscription';

export type CheckoutFulfillment = {
  email: string;
  plan: 'trial' | 'monthly';
  status: 'trialing' | 'active';
  exp: number;
  sessionId: string;
};

/**
 * Verify a completed Stripe Checkout session and build local entitlement.
 * Does not write cookies — callers must attach the cookie from a Route Handler.
 */
export async function fulfillCheckoutSession(
  sessionId: string
): Promise<CheckoutFulfillment | null> {
  const stripe = getStripe();
  const session = await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ['subscription', 'line_items'],
  });

  const email =
    session.customer_details?.email || session.customer_email || undefined;
  if (!email) return null;

  const isPaymentMode = session.mode === 'payment';
  const subscription =
    typeof session.subscription === 'object' && session.subscription
      ? session.subscription
      : null;

  if (isPaymentMode) {
    if (session.payment_status !== 'paid') return null;
  } else if (
    subscription &&
    subscription.status !== 'trialing' &&
    subscription.status !== 'active' &&
    session.payment_status !== 'paid'
  ) {
    return null;
  } else if (!subscription && session.payment_status !== 'paid') {
    return null;
  }

  const status: 'active' | 'trialing' = isPaymentMode
    ? 'trialing'
    : subscription?.status === 'trialing'
      ? 'trialing'
      : 'active';

  const plan: 'trial' | 'monthly' =
    isPaymentMode || session.metadata?.plan === 'trial'
      ? 'trial'
      : session.metadata?.plan === 'monthly' || subscription?.status === 'active'
        ? 'monthly'
        : 'trial';

  const itemPeriodEnd = subscription?.items?.data?.[0]?.current_period_end;
  const exp = itemPeriodEnd
    ? itemPeriodEnd * 1000
    : isPaymentMode
      ? Date.now() + PLAN_AMOUNTS.trialDays * 24 * 60 * 60 * 1000
      : Date.now() + 7 * 24 * 60 * 60 * 1000;

  try {
    const admin = createAdminSupabase();
    const normalized = email.toLowerCase();
    const customerId =
      typeof session.customer === 'string' ? session.customer : null;
    const linePriceId =
      session.line_items?.data?.[0]?.price &&
      typeof session.line_items.data[0].price === 'object'
        ? session.line_items.data[0].price.id
        : null;

    const { data: existingUser } = await admin
      .from('users')
      .select('id')
      .eq('email', normalized)
      .maybeSingle();

    const unlockExpiresAt = new Date(exp).toISOString();
    const userPayload: Record<string, unknown> = {
      email: normalized,
      stripe_customer_id: customerId,
      updated_at: new Date().toISOString(),
      active_subscriber: true,
      unlock_expires_at: unlockExpiresAt,
    };

    let userId = existingUser?.id as string | undefined;
    if (!userId) {
      const { data: created, error: createErr } = await admin
        .from('users')
        .insert(userPayload)
        .select('id')
        .single();
      if (createErr) {
        const { data: createdFallback } = await admin
          .from('users')
          .insert({
            email: normalized,
            stripe_customer_id: customerId,
            updated_at: new Date().toISOString(),
          })
          .select('id')
          .single();
        userId = createdFallback?.id;
      } else {
        userId = created?.id;
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
            stripe_customer_id: customerId,
            updated_at: new Date().toISOString(),
          })
          .eq('id', userId);
      }
    }

    if (userId) {
      const subId = subscription?.id ?? (isPaymentMode ? session.id : null);
      if (subId) {
        const { data: existingSub } = await admin
          .from('subscriptions')
          .select('id')
          .eq('stripe_subscription_id', subId)
          .maybeSingle();
        const row = {
          user_id: userId,
          email: normalized,
          stripe_customer_id: customerId,
          stripe_subscription_id: subId,
          stripe_price_id:
            subscription?.items?.data?.[0]?.price?.id ?? linePriceId,
          status,
          plan,
          current_period_end: new Date(exp).toISOString(),
          updated_at: new Date().toISOString(),
        };
        if (existingSub?.id) {
          await admin.from('subscriptions').update(row).eq('id', existingSub.id);
        } else {
          await admin.from('subscriptions').insert(row);
        }
      }
    }
  } catch {
    // Cookie entitlement still unlocks apply links locally.
  }

  return {
    email: email.toLowerCase(),
    plan,
    status,
    exp,
    sessionId,
  };
}

export function toSubscriberSession(
  fulfillment: CheckoutFulfillment
): SubscriberSession {
  return {
    email: fulfillment.email,
    status: fulfillment.status,
    plan: fulfillment.plan,
    exp: fulfillment.exp,
  };
}
