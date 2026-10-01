'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BrandMark } from '@/components/BrandMark';
import { useAuth } from '@/components/AuthProvider';

const NAV = [
  { href: '/', label: 'Home' },
  { href: '/my-jobs', label: 'My Jobs' },
  { href: '/profile', label: 'Profile' },
] as const;

export function SiteHeader() {
  const pathname = usePathname();
  const { user, loading, openAuth, openAlert, signOut } = useAuth();

  return (
    <header className="animate-rise border-b border-slate-800 pb-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <BrandMark />

        <nav className="order-3 flex w-full flex-wrap items-center justify-center gap-1 sm:order-none sm:w-auto sm:gap-1">
          {NAV.map((item) => {
            const active =
              item.href === '/'
                ? pathname === '/'
                : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={
                  active
                    ? 'rounded-full bg-emerald-500/15 px-3.5 py-1.5 text-sm font-semibold text-emerald-300'
                    : 'rounded-full px-3.5 py-1.5 text-sm font-medium text-slate-400 transition hover:bg-slate-800 hover:text-white'
                }
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-2 text-sm">
          <button
            type="button"
            onClick={openAlert}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-700 bg-slate-900 text-slate-300 transition hover:border-emerald-500/40 hover:text-emerald-300"
            aria-label="Job alert notifications"
            title="Job alerts"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path
                d="M15 17h5l-1.4-1.4A2 2 0 0 1 18 14.2V11a6 6 0 1 0-12 0v3.2c0 .5-.2 1-.6 1.4L4 17h5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path d="M9.5 17a2.5 2.5 0 0 0 5 0" strokeLinecap="round" />
            </svg>
          </button>

          {loading ? (
            <span className="rounded-full border border-slate-800 px-3.5 py-1.5 text-slate-500">
              …
            </span>
          ) : user ? (
            <button
              type="button"
              onClick={() => void signOut()}
              className="rounded-full border border-slate-700 bg-slate-900 px-3.5 py-1.5 font-medium text-slate-200 transition hover:border-slate-600 hover:bg-slate-800"
            >
              Sign Out
            </button>
          ) : (
            <button
              type="button"
              onClick={openAuth}
              className="rounded-full bg-white px-3.5 py-1.5 font-medium text-slate-950 transition hover:bg-slate-100"
            >
              Sign In
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
