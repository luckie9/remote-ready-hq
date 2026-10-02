import Link from 'next/link';
import { redirect } from 'next/navigation';
import { TrackCheckoutCompleted } from '@/components/TrackCheckoutCompleted';
import { getStripe, PLAN_AMOUNTS } from '@/lib/stripe';
import { setSubscriberCookie } from '@/lib/subscription';
import { createAdminSupabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export default async function SuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string }>;
}) {
  const { session_id: sessionId } = await searchParams;
  if (!sessionId) {
    redirect('/pricing');
  }

  const stripe = getStripe();
  const session = await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ['subscription', 'line_items'],
  });

  const email =
    session.customer_details?.email || session.customer_email || undefined;

  if (!email) {
    redirect('/pricing');
  }

  const isPaymentMode = session.mode === 'payment';
  const subscription =
    typeof session.subscription === 'object' && session.subscription
      ? session.subscription
      : null;

  // Payment (one-time $1.97) and subscription modes both land here.
  if (isPaymentMode) {
    if (session.payment_status !== 'paid') {
      redirect('/pricing');
    }
  } else if (
    subscription &&
    subscription.status !== 'trialing' &&
    subscription.status !== 'active' &&
    session.payment_status !== 'paid'
  ) {
    redirect('/pricing');
  } else if (!subscription && session.payment_status !== 'paid') {
    redirect('/pricing');
  }

  const status: 'active' | 'trialing' = isPaymentMode
    ? 'trialing'
    : subscription?.status === 'trialing'
      ? 'trialing'
      : 'active';

  const plan =
    isPaymentMode || session.metadata?.plan === 'trial'
      ? 'trial'
      : session.metadata?.plan === 'monthly' || subscription?.status === 'active'
        ? 'monthly'
        : 'trial';

  const itemPeriodEnd = subscription?.items?.data?.[0]?.current_period_end;
  const periodEnd = itemPeriodEnd
    ? itemPeriodEnd * 1000
    : isPaymentMode
      ? Date.now() + PLAN_AMOUNTS.trialDays * 24 * 60 * 60 * 1000
      : Date.now() + 7 * 24 * 60 * 60 * 1000;

  await setSubscriberCookie({
    email: email.toLowerCase(),
    status,
    plan,
    exp: periodEnd,
  });

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

    let userId = existingUser?.id as string | undefined;
    if (!userId) {
      const { data: created } = await admin
        .from('users')
        .insert({
          email: normalized,
          stripe_customer_id: customerId,
          updated_at: new Date().toISOString(),
        })
        .select('id')
        .single();
      userId = created?.id;
    } else {
      await admin
        .from('users')
        .update({
          stripe_customer_id: customerId,
          updated_at: new Date().toISOString(),
        })
        .eq('id', userId);
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
          current_period_end: new Date(periodEnd).toISOString(),
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

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-20">
      <TrackCheckoutCompleted plan={plan} sessionId={sessionId} />
      <div className="max-w-lg rounded-2xl border border-zinc-800/15 bg-white/80 px-8 py-10 text-center">
        <p className="text-3xl font-extrabold tracking-tight text-zinc-900">
          You&apos;re in
        </p>
        <p className="mt-3 text-zinc-500">
          Apply links are unlocked for{' '}
          <span className="font-medium text-zinc-800">{email}</span>.
        </p>
        <Link
          href="/"
          className="mt-8 inline-flex rounded-full bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-800"
        >
          View remote jobs
        </Link>
      </div>
    </main>
  );
}
