'use client';

import { useDeferredValue, useMemo, useState } from 'react';
import { JobCard } from '@/components/JobCard';
import {
  DATE_OPTIONS,
  JOB_CATEGORIES,
  REGION_OPTIONS,
  SALARY_OPTIONS,
  categoryCounts,
  matchesJobFilters,
  type DatePostedFilter,
  type Job,
  type JobCategory,
  type RegionFilter,
  type SalaryFilter,
} from '@/lib/jobs';

const SELECT_CLASS =
  'w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2.5 text-sm text-white outline-none transition hover:border-slate-700 focus:border-emerald-500/40';

const INPUT_CLASS =
  'w-full rounded-xl border border-slate-800 bg-slate-900 py-3 pl-10 pr-4 text-sm text-white outline-none transition placeholder:text-slate-500 hover:border-slate-700 focus:border-emerald-500/40';

export function JobBoard({
  jobs,
  isSubscriber,
}: {
  jobs: Job[];
  isSubscriber: boolean;
}) {
  const [query, setQuery] = useState('');
  const [locationQuery, setLocationQuery] = useState('');
  const [region, setRegion] = useState<RegionFilter>('any');
  const [datePosted, setDatePosted] = useState<DatePostedFilter>('anytime');
  const [salary, setSalary] = useState<SalaryFilter>('all');
  const [category, setCategory] = useState<JobCategory>('All');

  const deferredQuery = useDeferredValue(query);
  const deferredLocation = useDeferredValue(locationQuery);

  const filterState = useMemo(
    () => ({
      query: deferredQuery,
      locationQuery: deferredLocation,
      region,
      datePosted,
      salary,
    }),
    [deferredQuery, deferredLocation, region, datePosted, salary]
  );

  const counts = useMemo(
    () => categoryCounts(jobs, filterState),
    [jobs, filterState]
  );

  const filtered = useMemo(
    () =>
      jobs.filter((job) =>
        matchesJobFilters(job, { ...filterState, category })
      ),
    [jobs, filterState, category]
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="relative block">
            <span className="sr-only">Filter by title, company, or keyword</span>
            <svg
              aria-hidden
              viewBox="0 0 24 24"
              className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" strokeLinecap="round" />
            </svg>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter by title, company, or keyword"
              className={INPUT_CLASS}
            />
          </label>

          <label className="relative block">
            <span className="sr-only">
              Filter by remote location or country
            </span>
            <svg
              aria-hidden
              viewBox="0 0 24 24"
              className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path
                d="M12 21s7-5.2 7-11a7 7 0 1 0-14 0c0 5.8 7 11 7 11Z"
                strokeLinejoin="round"
              />
              <circle cx="12" cy="10" r="2.25" />
            </svg>
            <input
              type="search"
              value={locationQuery}
              onChange={(e) => setLocationQuery(e.target.value)}
              placeholder="Filter by remote location or country"
              className={INPUT_CLASS}
            />
          </label>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Region / Location
            </span>
            <select
              value={region}
              onChange={(e) => setRegion(e.target.value as RegionFilter)}
              className={SELECT_CLASS}
            >
              {REGION_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Date Posted
            </span>
            <select
              value={datePosted}
              onChange={(e) =>
                setDatePosted(e.target.value as DatePostedFilter)
              }
              className={SELECT_CLASS}
            >
              {DATE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Salary Status
            </span>
            <select
              value={salary}
              onChange={(e) => setSalary(e.target.value as SalaryFilter)}
              className={SELECT_CLASS}
            >
              {SALARY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div
          className="flex flex-wrap justify-center gap-2"
          role="tablist"
          aria-label="Job categories"
        >
          {JOB_CATEGORIES.map((item) => {
            const active = category === item;
            const count = counts[item];
            if (item !== 'All' && count === 0) return null;
            return (
              <button
                key={item}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setCategory(item)}
                className={
                  active
                    ? 'rounded-full border border-emerald-500/40 bg-emerald-500/15 px-3.5 py-1.5 text-sm font-medium text-emerald-300 transition'
                    : 'rounded-full border border-slate-800 bg-slate-900 px-3.5 py-1.5 text-sm font-medium text-slate-400 transition hover:border-slate-700 hover:text-slate-200'
                }
              >
                {item === 'All' ? `All (${count}+)` : `${item} (${count})`}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        {filtered.length === 0 ? (
          <div className="rounded-2xl border border-slate-800 bg-slate-900 px-6 py-16 text-center text-slate-400">
            No roles match those filters. Try another keyword, region, or date
            range.
          </div>
        ) : (
          <ul className="flex flex-col gap-4">
            {filtered.map((job) => (
              <JobCard key={job.id} job={job} isSubscriber={isSubscriber} />
            ))}
          </ul>
        )}
      </div>

      <p className="text-center text-xs text-slate-500">
        Showing {filtered.length} of {jobs.length} curated roles
      </p>
    </div>
  );
}
