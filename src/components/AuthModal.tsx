'use client';

import { useState, type FormEvent } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/components/AuthProvider';

export function AuthModal() {
  const { authOpen, closeAuth } = useAuth();
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'sent' | 'error'>(
    'idle'
  );
  const [message, setMessage] = useState('');

  if (!authOpen) return null;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const value = email.trim().toLowerCase();
    if (!value) return;
    setStatus('loading');
    setMessage('');
    try {
      const supabase = createClient();
      const origin = window.location.origin;
      const { error } = await supabase.auth.signInWithOtp({
        email: value,
        options: {
          emailRedirectTo: `${origin}/auth/callback`,
        },
      });
      if (error) throw error;
      setStatus('sent');
      setMessage('Check your inbox for a magic sign-in link.');
    } catch (err) {
      setStatus('error');
      setMessage(
        err instanceof Error ? err.message : 'Unable to send magic link'
      );
    }
  }

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal
      aria-labelledby="auth-modal-title"
      onClick={closeAuth}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-slate-700 bg-[#161F2E] p-6 shadow-2xl shadow-black/40"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2
              id="auth-modal-title"
              className="text-xl font-semibold tracking-tight text-white"
            >
              Sign in to RemoteReady HQ
            </h2>
            <p className="mt-1 text-sm text-slate-400">
              Magic link — no password. Track applied jobs and unlock My Jobs.
            </p>
          </div>
          <button
            type="button"
            onClick={closeAuth}
            className="rounded-lg border border-slate-700 px-2 py-1 text-sm text-slate-400 hover:text-white"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {status === 'sent' ? (
          <p className="mt-6 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
            {message}
          </p>
        ) : (
          <form className="mt-6 space-y-3" onSubmit={onSubmit}>
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Email
              </span>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-emerald-500/40"
              />
            </label>
            <button
              type="submit"
              disabled={status === 'loading'}
              className="inline-flex w-full items-center justify-center rounded-full bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-emerald-500 disabled:opacity-60"
            >
              {status === 'loading' ? 'Sending…' : 'Email me a magic link'}
            </button>
            {status === 'error' && (
              <p className="text-sm text-red-400">{message}</p>
            )}
          </form>
        )}
      </div>
    </div>
  );
}
