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

function ensurePostHog() {
  if (typeof window === 'undefined' || !apiKey) return false;
  if (!posthog.__loaded) {
    posthog.init(apiKey, {
      api_host: apiHost,
      person_profiles: 'identified_only',
      capture_pageview: false,
      capture_pageleave: true,
      persistence: 'localStorage+cookie',
    });
  }
  if (process.env.NODE_ENV === 'development') {
    (window as unknown as { __rrhqTrack?: typeof track }).__rrhqTrack = track;
    (window as unknown as { posthog?: typeof posthog }).posthog = posthog;
  }
  return posthog.__loaded;
}

function PageViewTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    ensurePostHog();
    const search = searchParams?.toString();
    const path = search ? `${pathname}?${search}` : pathname;
    track('page_viewed', { path: path || '/', pathname: pathname || '/' });
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
        <PageViewTracker />
      </Suspense>
      {children}
      <Analytics />
    </>
  );

  if (!apiKey) return body;

  return <PostHogProvider client={posthog}>{body}</PostHogProvider>;
}
