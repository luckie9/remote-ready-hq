'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/components/AuthProvider';

type Mode = 'signin' | 'signup';

export function AuthModal() {
  const { authOpen, closeAuth } = useAuth();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>(
    'idle'
  );
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!authOpen) {
      setMode('signin');
      setEmail('');
      setPassword('');
      setStatus('idle');
      setMessage('');
    }
  }, [authOpen]);

  if (!authOpen) return null;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const value = email.trim().toLowerCase();
    if (!value || !password) return;
    setStatus('loading');
    setMessage('');
    try {
      const supabase = createClient();
      if (mode === 'signup') {
        const { error } = await supabase.auth.signUp({
          email: value,
          password,
        });
        if (error) throw error;
        setStatus('done');
        setMessage(
          'Account created. If email confirmation is enabled, check your inbox — otherwise you’re signed in.'
        );
        window.setTimeout(() => closeAuth(), 1400);
        return;
      }

      const { error } = await supabase.auth.signInWithPassword({
        email: value,
        password,
      });
      if (error) throw error;
      setStatus('done');
      setMessage('Signed in successfully.');
      window.setTimeout(() => closeAuth(), 800);
    } catch (err) {
      setStatus('error');
      setMessage(err instanceof Error ? err.message : 'Authentication failed');
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
              {mode === 'signin' ? 'Sign in to RemoteReady HQ' : 'Create your account'}
            </h2>
            <p className="mt-1 text-sm text-slate-400">
              Email and password — track applied jobs and unlock My Jobs.
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

        <div className="mt-5 grid grid-cols-2 gap-2 rounded-xl border border-slate-700 bg-slate-950/60 p-1">
          <button
            type="button"
            onClick={() => {
              setMode('signin');
              setStatus('idle');
              setMessage('');
            }}
            className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${
              mode === 'signin'
                ? 'bg-emerald-500 text-[#0B0F17]'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Sign In
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('signup');
              setStatus('idle');
              setMessage('');
            }}
            className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${
              mode === 'signup'
                ? 'bg-emerald-500 text-[#0B0F17]'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Sign Up
          </button>
        </div>

        {status === 'done' ? (
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
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-emerald-500/40"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Password
              </span>
              <input
                type="password"
                required
                minLength={6}
                autoComplete={
                  mode === 'signin' ? 'current-password' : 'new-password'
                }
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 6 characters"
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-emerald-500/40"
              />
            </label>
            <button
              type="submit"
              disabled={status === 'loading'}
              className="inline-flex w-full items-center justify-center rounded-full bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-emerald-500 disabled:opacity-60"
            >
              {status === 'loading'
                ? mode === 'signin'
                  ? 'Signing in…'
                  : 'Creating account…'
                : mode === 'signin'
                  ? 'Sign In'
                  : 'Create Account'}
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
