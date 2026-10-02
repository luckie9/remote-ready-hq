import Link from 'next/link';
import { CheckoutButton } from '@/components/CheckoutButton';
import { getEffectiveSubscriberSession } from '@/lib/subscription';

export const dynamic = 'force-dynamic';

export default async function PricingPage({
  searchParams,
}: {
  searchParams: Promise<{ canceled?: string }>;
}) {
  const params = await searchParams;
  const session = await getEffectiveSubscriberSession();

  return (
    <main className="flex-1">
      <div className="mx-auto max-w-3xl px-6 py-10">
        <Link href="/" className="text-sm text-zinc-500 transition hover:text-zinc-900">
          ← Back to jobs
        </Link>

        <header className="mt-10 mb-10 text-center">
          <p className="text-3xl font-extrabold tracking-tight text-zinc-900">
            RemoteReady HQ
          </p>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-zinc-800">
            Unlock direct employer links
          </h1>
          <p className="mt-3 text-zinc-500">
            $1.97 3-Day All-Access Trial, then $13.97/month. Cancel anytime.
          </p>
        </header>

        {params.canceled && (
          <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Checkout canceled. You can restart anytime below.
          </div>
        )}

        {session ? (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-6 py-8 text-center">
            <p className="font-medium text-emerald-900">
              You already have an active {session.plan} plan ({session.email}).
            </p>
            <Link
              href="/"
              className="mt-4 inline-flex rounded-full bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-800"
            >
              Browse jobs
            </Link>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <section className="rounded-2xl border border-indigo-200 bg-gradient-to-b from-indigo-50 to-white p-6">
              <h2 className="text-lg font-semibold text-zinc-900">
                3-Day All-Access Trial
              </h2>
              <p className="mt-2 text-3xl font-semibold tracking-tight text-zinc-900">
                $1.97
                <span className="text-base font-medium text-zinc-400">
                  {' '}
                  / 3 days
                </span>
              </p>
              <p className="mt-3 text-sm text-zinc-500">
                Unlock every direct apply link for 3 days, then continue at
                $13.97/mo.
              </p>
              <div className="mt-6">
                <CheckoutButton
                  plan="trial"
                  label="Start $1.97 Trial"
                  className="inline-flex w-full items-center justify-center rounded-full bg-gradient-to-r from-indigo-600 to-emerald-500 px-5 py-2.5 text-sm font-bold text-white transition hover:from-indigo-500 hover:to-emerald-400 disabled:opacity-60"
                />
              </div>
            </section>

            <section className="rounded-2xl border border-zinc-800/15 bg-white/80 p-6">
              <h2 className="text-lg font-semibold text-zinc-900">Monthly</h2>
              <p className="mt-2 text-3xl font-semibold tracking-tight text-zinc-900">
                $13.97
                <span className="text-base font-medium text-zinc-400">
                  {' '}
                  / month
                </span>
              </p>
              <p className="mt-3 text-sm text-zinc-500">
                Full access to direct apply URLs for every curated listing.
              </p>
              <div className="mt-6">
                <CheckoutButton plan="monthly" label="Subscribe $13.97/mo" />
              </div>
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
