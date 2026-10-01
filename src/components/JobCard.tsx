'use client';

import { useId, useMemo, useState, type MouseEvent } from 'react';
import { ApplyAction } from '@/components/ApplyAction';
import { JobDescription } from '@/components/JobDescription';
import { useUnlock } from '@/components/UnlockProvider';
import { track } from '@/lib/analytics';
import {
  categorizeJob,
  deriveBadges,
  extractSkillTags,
  formatLocation,
  formatRelativeTime,
  formatSalaryHighlight,
  freshnessBadge,
  lockedDomainPreview,
  obfuscateListing,
  socialProofLine,
  type Job,
  type JobBadge,
} from '@/lib/jobs';

const BADGE_STYLES: Record<JobBadge, string> = {
  HOT: 'bg-[#DC2626] text-white border-transparent',
  FEATURED: 'bg-[#D97706] text-white border-transparent',
  DIRECT_APPLY: 'bg-[#059669] text-white border-transparent',
  SALARY_VERIFIED: 'bg-[#0284C7] text-white border-transparent',
};

const BADGE_LABELS: Record<JobBadge, string> = {
  HOT: 'HOT',
  FEATURED: 'FEATURED',
  DIRECT_APPLY: 'DIRECT APPLY',
  SALARY_VERIFIED: 'SALARY VERIFIED',
};

function shellClass(isFeatured: boolean, open: boolean): string {
  if (open) {
    return [
      'overflow-hidden rounded-xl border border-emerald-500/40 bg-[#161F2E]',
      'ring-1 ring-emerald-500/50 shadow-lg shadow-emerald-950/30',
      'transition-shadow',
    ].join(' ');
  }
  if (isFeatured) {
    return [
      'overflow-hidden rounded-xl border border-amber-500/35 bg-[#161F2E]',
      'shadow-md shadow-black/20 transition hover:border-amber-400/50',
    ].join(' ');
  }
  return [
    'overflow-hidden rounded-xl border border-slate-800 bg-[#161F2E]',
    'shadow-sm shadow-black/20 transition hover:border-slate-700',
  ].join(' ');
}

export function JobCard({
  job,
  isSubscriber,
}: {
  job: Job;
  isSubscriber: boolean;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const { openUnlock } = useUnlock();

  const jobCategory = categorizeJob(job.title, job.description);
  const badges = job.badges ?? deriveBadges(job);
  const domain = job.locked_domain ?? lockedDomainPreview(job.apply_url);
  const proof = job.social_proof ?? socialProofLine(job.id, badges);
  const fresh = freshnessBadge(job.created_at);
  const isFeatured = badges.includes('FEATURED');
  const salaryLabel = formatSalaryHighlight(job.salary);
  const skillTags = useMemo(() => extractSkillTags(job), [job]);
  const locked = useMemo(
    () => (isSubscriber ? null : obfuscateListing(job)),
    [isSubscriber, job]
  );

  const displayCompany = isSubscriber
    ? job.company
    : (locked?.companyLabel ?? 'Hiring company');
  const displayTitle = isSubscriber
    ? job.title
    : (locked?.titleLabel ?? job.title);

  function toggle() {
    setOpen((v) => {
      const next = !v;
      if (next) {
        track('job_card_expanded', { job_id: job.id });
      }
      return next;
    });
  }

  function collapse(e: MouseEvent) {
    e.stopPropagation();
    setOpen(false);
  }

  function onLockedClick(e: MouseEvent) {
    e.stopPropagation();
    openUnlock();
  }

  return (
    <li className={shellClass(isFeatured, open)}>
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={toggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggle();
          }
        }}
        className="group grid cursor-pointer gap-4 px-5 py-5 transition hover:bg-slate-800/40 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-6"
      >
        <div className="min-w-0 space-y-2.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
            <p className="text-sm font-medium text-slate-400">{displayCompany}</p>
            <span className="rounded-md border border-slate-700 bg-slate-800/80 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-300">
              {jobCategory}
            </span>
            {badges.map((badge) => (
              <span
                key={badge}
                className={`rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wide ${BADGE_STYLES[badge]}`}
              >
                {BADGE_LABELS[badge]}
              </span>
            ))}
            <span
              className={`ml-auto inline-flex h-6 w-6 items-center justify-center rounded-full border border-slate-700 text-slate-400 transition ${
                open
                  ? 'rotate-180 bg-emerald-500/15 text-emerald-400'
                  : 'bg-slate-900'
              }`}
              aria-hidden
            >
              <svg
                viewBox="0 0 20 20"
                className="h-3.5 w-3.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path
                  d="M5 7.5 10 12.5 15 7.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
          </div>

          <h2 className="text-lg font-semibold tracking-tight text-white transition group-hover:text-slate-200 sm:text-[1.2rem]">
            {displayTitle}
          </h2>

          <div className="flex flex-wrap items-center gap-2 text-sm text-slate-300">
            <span className="inline-flex items-center rounded-full border border-slate-700 bg-slate-800/70 px-2.5 py-0.5">
              {formatLocation(job.location)}
            </span>
            {salaryLabel && (
              <span className="inline-flex items-center rounded-md border border-emerald-500/30 bg-emerald-600 px-2.5 py-0.5 text-xs font-bold tracking-wide text-white shadow-sm shadow-emerald-950/40">
                {salaryLabel}
              </span>
            )}
            <span className="text-slate-500">
              {job.posted_label || formatRelativeTime(job.created_at)}
            </span>
          </div>

          <ul className="flex flex-wrap gap-1.5">
            <li className="rounded-full border border-emerald-500/35 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-300">
              ✓ Active Hiring Link
            </li>
            <li className="rounded-full border border-sky-500/30 bg-sky-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-sky-300">
              {fresh}
            </li>
            {skillTags.map((tag) => (
              <li
                key={tag}
                className="rounded-full border border-slate-700 bg-slate-800/60 px-2.5 py-0.5 text-[11px] font-medium text-slate-300"
              >
                {tag}
              </li>
            ))}
          </ul>

          {!isSubscriber && (
            <p className="flex flex-wrap items-center gap-1.5 text-xs text-slate-400">
              <button
                type="button"
                onClick={onLockedClick}
                className="select-none rounded border border-slate-700 bg-slate-950/60 px-2 py-1 font-mono text-[11px] text-slate-400 [filter:blur(2.5px)] transition hover:border-emerald-500/40"
                aria-label="Unlock direct application link"
              >
                {domain}
              </button>
              <span className="font-semibold text-slate-200">🔒 LOCKED</span>
            </p>
          )}

          <p className="text-xs font-medium text-amber-400">{proof}</p>
        </div>

        <div className="sm:justify-self-end">
          <ApplyAction
            jobId={job.id}
            isSubscriber={isSubscriber}
            applyUrl={job.apply_url}
            unlockLabel="Unlock Direct Link ($1.97)"
          />
        </div>
      </div>

      <div
        id={panelId}
        hidden={!open}
        className={open ? 'px-2 pb-2' : undefined}
      >
        {open && (
          <div className="mx-0 space-y-5 rounded-b-xl border-t border-b border-slate-700/80 bg-[#0D131F] p-5 ring-1 ring-emerald-500/50 sm:mx-1 sm:mb-1 sm:rounded-xl sm:p-6">
            <JobDescription job={job} isSubscriber={isSubscriber} />

            <div className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-4 shadow-sm">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white">
                    Ready to apply?
                  </p>
                  {!isSubscriber ? (
                    <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-400">
                      <button
                        type="button"
                        onClick={onLockedClick}
                        className="select-none rounded border border-slate-700 bg-slate-950 px-2 py-0.5 font-mono text-[11px] [filter:blur(2.5px)] transition hover:border-emerald-500/40"
                        aria-label="Unlock direct application link"
                      >
                        {domain}
                      </button>
                      <span className="font-semibold text-slate-200">
                        🔒 Direct link locked
                      </span>
                    </p>
                  ) : (
                    <p className="mt-0.5 truncate text-xs text-emerald-400">
                      Direct recruiter link unlocked
                    </p>
                  )}
                </div>
                <ApplyAction
                  jobId={job.id}
                  isSubscriber={isSubscriber}
                  applyUrl={job.apply_url}
                  applyLabel="Apply Now"
                  unlockLabel="Unlock Direct Application ($1.97)"
                  className={
                    isSubscriber
                      ? 'inline-flex w-full items-center justify-center rounded-full bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-500 sm:w-auto'
                      : 'inline-flex w-full items-center justify-center rounded-full bg-gradient-to-r from-indigo-600 to-emerald-500 px-5 py-2.5 text-sm font-bold text-white shadow-md shadow-indigo-500/20 transition hover:from-indigo-500 hover:to-emerald-400 disabled:opacity-60 sm:w-auto'
                  }
                />
              </div>
            </div>

            <div className="flex justify-center border-t border-slate-700/80 pt-4">
              <button
                type="button"
                onClick={collapse}
                className="inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-900 px-4 py-2 text-sm font-semibold text-slate-200 shadow-sm transition hover:border-emerald-500/40 hover:bg-emerald-500/10 hover:text-emerald-300"
              >
                <span aria-hidden>▲</span>
                Collapse Details
              </button>
            </div>
          </div>
        )}
      </div>
    </li>
  );
}
