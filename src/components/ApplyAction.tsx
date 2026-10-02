'use client';

import type { KeyboardEvent, MouseEvent } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { useUnlock } from '@/components/UnlockProvider';

export const RISK_REVERSAL_COPY =
  '⚡ 3-Day Unlimited Pass ($1.97) • Direct Recruiter Link • Cancel Anytime in 1-Click';

type Props = {
  jobId: string;
  isSubscriber: boolean;
  applyUrl: string;
  applyLabel?: string;
  unlockLabel?: string;
  hideMicrocopy?: boolean;
  className?: string;
  stopRowToggle?: boolean;
};

export function ApplyAction({
  jobId,
  isSubscriber,
  applyUrl,
  applyLabel = 'Apply Now',
  unlockLabel = 'Unlock Direct Link ($1.97)',
  hideMicrocopy = false,
  className,
  stopRowToggle = true,
}: Props) {
  const { appliedJobIds, markApplied, user, openAuth } = useAuth();
  const { openUnlock } = useUnlock();
  const applied = appliedJobIds.has(jobId);

  const stop = stopRowToggle
    ? (e: MouseEvent | KeyboardEvent) => {
        e.stopPropagation();
      }
    : undefined;

  if (applied) {
    return (
      <div
        className="flex w-full flex-col items-stretch gap-1.5 sm:w-auto sm:items-end"
        onClick={stop}
        onKeyDown={stop}
      >
        <span className="inline-flex w-full items-center justify-center rounded-full border border-emerald-500/40 bg-emerald-500/15 px-4 py-2.5 text-sm font-bold text-emerald-300 sm:w-auto">
          ✓ APPLIED
        </span>
        <a
          href={applyUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-center text-[11px] text-slate-500 underline-offset-2 hover:text-slate-300 hover:underline sm:text-right"
          onClick={stop}
        >
          Open link again
        </a>
      </div>
    );
  }

  if (isSubscriber) {
    return (
      <a
        href={applyUrl}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => {
          stop?.(e);
          if (!user) {
            openAuth();
          }
          void markApplied(jobId);
        }}
        className={
          className ||
          'inline-flex items-center justify-center rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-500'
        }
      >
        {applyLabel}
      </a>
    );
  }

  return (
    <div
      className="flex w-full flex-col items-stretch gap-1.5 sm:w-auto sm:items-end"
      onClick={stop}
      onKeyDown={stop}
    >
      <button
        type="button"
        onClick={(e) => {
          stop?.(e);
          openUnlock();
        }}
        className={
          className ||
          'inline-flex w-full cursor-pointer items-center justify-center rounded-full bg-[#10B981] px-5 py-3 text-sm font-bold text-[#0B0F17] shadow-lg shadow-emerald-950/40 transition hover:bg-emerald-400 hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300 active:scale-[0.98] active:bg-emerald-600 sm:w-auto'
        }
      >
        {unlockLabel}
      </button>
      {!hideMicrocopy && (
        <p className="text-[11px] leading-snug text-slate-500 sm:max-w-[16rem] sm:text-right">
          {RISK_REVERSAL_COPY}
        </p>
      )}
    </div>
  );
}
