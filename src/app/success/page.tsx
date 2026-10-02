import Link from 'next/link';
import { redirect } from 'next/navigation';
import { TrackCheckoutCompleted } from '@/components/TrackCheckoutCompleted';
import { getSubscriberSession } from '@/lib/subscription';

export const dynamic = 'force-dynamic';

/**
 * Display-only success page. Entitlement cookie is set by /api/stripe/success
 * (Route Handler) before Stripe redirects here — never call cookies().set() here.
 */
export default async function SuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string; plan?: string }>;
}) {
  const { session_id: sessionId, plan: planParam } = await searchParams;
  const subscriber = await getSubscriberSession();

  if (!subscriber) {
    redirect(sessionId ? `/api/stripe/success?session_id=${encodeURIComponent(sessionId)}` : '/pricing');
  }

  const plan = planParam === 'monthly' || planParam === 'trial'
    ? planParam
    : subscriber.plan;

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-20">
      {sessionId ? (
        <TrackCheckoutCompleted plan={plan} sessionId={sessionId} />
      ) : null}
      <div className="max-w-lg rounded-2xl border border-zinc-800/15 bg-white/80 px-8 py-10 text-center">
        <p className="text-3xl font-extrabold tracking-tight text-zinc-900">
          You&apos;re in
        </p>
        <p className="mt-3 text-zinc-500">
          Apply links are unlocked for{' '}
          <span className="font-medium text-zinc-800">{subscriber.email}</span>.
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
