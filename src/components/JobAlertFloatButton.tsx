'use client';

import { useAuth } from '@/components/AuthProvider';

export function JobAlertFloatButton() {
  const { openAlert, hasSubscribedAlerts, alertOpen } = useAuth();

  if (hasSubscribedAlerts || alertOpen) return null;

  return (
    <button
      type="button"
      onClick={openAlert}
      className="fixed left-2 top-1/2 z-40 inline-flex -translate-y-1/2 items-center gap-2 rounded-full border border-emerald-500/40 bg-[#161F2E] p-3 text-sm font-semibold text-emerald-300 shadow-[0_0_24px_rgba(16,185,129,0.35)] transition hover:border-emerald-400/70 hover:bg-[#1a2538] hover:text-emerald-200 hover:shadow-[0_0_32px_rgba(16,185,129,0.5)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400 sm:left-4 sm:px-4 sm:py-3"
      aria-label="Get daily job alerts"
    >
      <span className="text-base leading-none" aria-hidden>
        🔔
      </span>
      <span className="hidden sm:inline">Get Daily Job Alerts</span>
    </button>
  );
}
