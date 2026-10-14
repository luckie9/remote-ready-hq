import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { loadBillingTarget } from '@/lib/profile-subscription';
import { getStripe } from '@/lib/stripe';
import { ensureStripeCustomer } from '@/lib/stripe-mapping';
import type Stripe from 'stripe';

function appOrigin(request: Request): string {
  const origin = request.headers.get('origin')?.replace(/\/$/, '');
  if (origin) return origin;
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
  if (host) {
    const proto =
      request.headers.get('x-forwarded-proto') ||
      (host.includes('localhost') ? 'http' : 'https');
    return `${proto}://${host}`;
  }
  return process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') || 'http://localhost:3000';
}

/** Open the Stripe Customer Portal for the signed-in account's email. */
export async function openBillingPortal(request: Request, cancel: boolean) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) {
    return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  }

  let { customerId, subscriptionId } = await loadBillingTarget(
    supabase,
    user.id,
    user.email
  );
  if (!customerId) {
    const ensured = await ensureStripeCustomer(user.email, user.id);
    customerId = ensured?.customerId ?? null;
    subscriptionId = subscriptionId || ensured?.subscriptionId || null;
  }
  if (!customerId) {
    return NextResponse.json(
      { error: 'Stripe could not open a billing profile for this account.' },
      { status: 502 }
    );
  }

  const stripe = getStripe();
  const returnUrl = `${appOrigin(request)}${cancel ? '/pricing' : '/profile'}`;
  const portalParams: Stripe.BillingPortal.SessionCreateParams = {
    customer: customerId,
    return_url: returnUrl,
  };
  if (cancel && subscriptionId) {
    portalParams.flow_data = {
      type: 'subscription_cancel',
      subscription_cancel: { subscription: subscriptionId },
    };
  }

  let portal: Stripe.BillingPortal.Session;
  try {
    portal = await stripe.billingPortal.sessions.create(portalParams);
  } catch (err) {
    if (!portalParams.flow_data) throw err;
    portal = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });
  }
  if (!portal.url) {
    return NextResponse.json(
      { error: 'Stripe did not return a billing portal URL' },
      { status: 500 }
    );
  }
  return NextResponse.json({ url: portal.url });
}
