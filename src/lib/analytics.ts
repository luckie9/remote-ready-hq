import { track as vercelTrack } from '@vercel/analytics';
import posthog from 'posthog-js';

export type FunnelEvent =
  | 'page_viewed'
  | 'job_card_expanded'
  | 'job_alert_email_submitted'
  | 'unlock_pass_clicked'
  | 'checkout_completed';

type Props = Record<string, string | number | boolean | null | undefined>;

function sanitize(props?: Props): Record<string, string | number | boolean> | undefined {
  if (!props) return undefined;
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined) continue;
    out[key] = value;
  }
  return Object.keys(out).length ? out : undefined;
}

/** Fire a conversion-funnel event to PostHog (if configured) + Vercel Analytics. */
export function track(event: FunnelEvent, properties?: Props) {
  if (typeof window === 'undefined') return;
  const props = sanitize(properties);

  try {
    if (process.env.NEXT_PUBLIC_POSTHOG_KEY) {
      posthog.capture(event, props);
    }
  } catch {
    // ignore analytics failures
  }

  try {
    vercelTrack(event, props);
  } catch {
    // ignore analytics failures
  }
}
