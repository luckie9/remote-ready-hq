'use client';

import { useEffect, useState } from 'react';

type Props = {
  label: string;
  className?: string;
  /** Hide the link until the signed-in account has an active plan. */
  whenActive?: boolean;
};

export function CancelSubscriptionLink({
  label,
  className,
  whenActive = false,
}: Props) {
  const [visible, setVisible] = useState(!whenActive);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!whenActive) return;
    let cancelled = false;
    fetch('/api/subscription/status')
      .then((res) => res.json())
      .then((data: { active?: boolean }) => {
        if (!cancelled) setVisible(Boolean(data.active));
      })
      .catch(() => {
        if (!cancelled) setVisible(false);
      });
    return () => {
      cancelled = true;
    };
  }, [whenActive]);

  async function openCancellation() {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/subscription/portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intent: 'cancel' }),
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        throw new Error(data.error || 'Unable to open cancellation');
      }
      window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to open cancellation');
      setBusy(false);
    }
  }

  if (!visible) return null;

  return (
    <span className="inline-flex flex-col items-center">
      <button
        type="button"
        onClick={() => void openCancellation()}
        disabled={busy}
        className={
          className ||
          'text-xs font-normal text-zinc-400 underline decoration-zinc-300 underline-offset-2 transition hover:text-zinc-500 disabled:opacity-60'
        }
      >
        {busy ? 'Opening…' : label}
      </button>
      {error ? <span className="mt-1 text-xs text-red-400">{error}</span> : null}
    </span>
  );
}
