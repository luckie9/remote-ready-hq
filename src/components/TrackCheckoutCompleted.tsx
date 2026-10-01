'use client';

import { useEffect } from 'react';
import { track } from '@/lib/analytics';

export function TrackCheckoutCompleted({
  plan,
  sessionId,
}: {
  plan: string;
  sessionId: string;
}) {
  useEffect(() => {
    track('checkout_completed', {
      plan,
      session_id: sessionId,
    });
  }, [plan, sessionId]);

  return null;
}
