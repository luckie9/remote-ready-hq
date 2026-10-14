import { getStripe, PLAN_AMOUNTS } from '@/lib/stripe';
import {
  findStripeCustomerByEmail,
  saveStripeCustomerLink,
} from '@/lib/stripe-mapping';
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

  const customerFromSession =
    typeof session.customer === 'string'
      ? session.customer
      : session.customer?.id ?? null;
  const linePriceId =
    session.line_items?.data?.[0]?.price &&
    typeof session.line_items.data[0].price === 'object'
      ? session.line_items.data[0].price.id
      : null;

  let customerId = customerFromSession;
  let subscriptionId = subscription?.id ?? null;
  if (!customerId || !subscriptionId) {
    const found = await findStripeCustomerByEmail(email.toLowerCase());
    customerId = customerId || found?.customerId || null;
    subscriptionId = subscriptionId || found?.subscriptionId || null;
  }

  try {
    await saveStripeCustomerLink({
      email,
      customerId,
      subscriptionId,
      status,
      plan,
      priceId: subscription?.items?.data?.[0]?.price?.id ?? linePriceId,
      currentPeriodEnd: new Date(exp).toISOString(),
    });
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
