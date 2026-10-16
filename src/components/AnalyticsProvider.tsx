'use client';

import { Analytics } from '@vercel/analytics/react';
import posthog from 'posthog-js';
import { PostHogProvider } from 'posthog-js/react';
import { Suspense, useEffect, type ReactNode } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { track } from '@/lib/analytics';

const apiKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const apiHost =
  process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com';

let reportedInit = false;

function reportPostHog(message: string, details?: Record<string, string>) {
  if (reportedInit) return;
  reportedInit = true;
  console.log(`[PostHog] ${message}`, details ?? '');
}

function ensurePostHog() {
  if (typeof window === 'undefined') return false;
  if (!apiKey) {
    reportPostHog('not initialized: NEXT_PUBLIC_POSTHOG_KEY is unset');
    return false;
  }
  if (!posthog.__loaded) {
    posthog.init(apiKey, {
      api_host: apiHost,
      person_profiles: 'identified_only',
      capture_pageview: false,
      capture_pageleave: true,
      persistence: 'localStorage+cookie',
      loaded: (client) => {
        reportPostHog('initialized', {
          host: apiHost,
          distinctId: client.get_distinct_id(),
        });
      },
    });
  } else {
    reportPostHog('initialized', {
      host: apiHost,
      distinctId: posthog.get_distinct_id(),
    });
  }
  if (process.env.NODE_ENV === 'development') {
    (window as unknown as { __rrhqTrack?: typeof track }).__rrhqTrack = track;
    (window as unknown as { posthog?: typeof posthog }).posthog = posthog;
  }
  return posthog.__loaded;
}

function PostHogPageView() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!ensurePostHog() || !pathname) return;
    const search = searchParams?.toString() ?? '';
    const path = search ? `${pathname}?${search}` : pathname;
    const url = `${window.location.origin}${path}`;
    posthog.capture('$pageview', { $current_url: url });
    track('page_viewed', { path, pathname });
  }, [pathname, searchParams]);

  return null;
}

export function AnalyticsProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    ensurePostHog();
  }, []);

  const body = (
    <>
      <Suspense fallback={null}>
        <PostHogPageView />
      </Suspense>
      {children}
      <Analytics />
    </>
  );

  if (!apiKey) return body;

  return <PostHogProvider client={posthog}>{body}</PostHogProvider>;
}
