'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/components/AuthProvider';

type Mode = 'signin' | 'signup';

function EyeIcon({ open }: { open: boolean }) {
  if (open) {
    return (
      <svg
        viewBox="0 0 24 24"
        className="h-4 w-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden
      >
        <path
          d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12s-3.5 6.5-9.5 6.5S2.5 12 2.5 12Z"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="12" cy="12" r="2.75" />
      </svg>
    );
  }
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden
    >
      <path
        d="M3 3l18 18M10.6 10.7a2.75 2.75 0 0 0 3.8 3.8M9.5 5.4A10.3 10.3 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17.6 17.6 0 0 1-3.2 3.7M6.2 6.3C4 7.9 2.5 12 2.5 12S6 18.5 12 18.5c1.2 0 2.3-.2 3.3-.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PasswordField({
  id,
  label,
  value,
  onChange,
  placeholder,
  autoComplete,
  visible,
  onToggleVisible,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  autoComplete: string;
  visible: boolean;
  onToggleVisible: () => void;
}) {
  return (
    <label className="block" htmlFor={id}>
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </span>
      <div className="relative">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          required
          minLength={6}
          autoComplete={autoComplete}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 pr-11 text-sm text-white outline-none placeholder:text-slate-500 focus:border-emerald-500/40"
        />
        <button
          type="button"
          onClick={onToggleVisible}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-2 text-slate-400 transition hover:text-emerald-300"
          aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
        >
          <EyeIcon open={visible} />
        </button>
      </div>
    </label>
  );
}

export function AuthModal() {
  const router = useRouter();
  const { authOpen, closeAuth, refreshApplications } = useAuth();
  const [mode, setMode] = useState<Mode>('signin');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>(
    'idle'
  );
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!authOpen) {
      setMode('signin');
      setFullName('');
      setEmail('');
      setPassword('');
      setConfirmPassword('');
      setShowPassword(false);
      setShowConfirmPassword(false);
      setStatus('idle');
      setMessage('');
    }
  }, [authOpen]);

  async function finalizeSession() {
    closeAuth();
    await refreshApplications();
    router.refresh();
  }

  if (!authOpen) return null;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const value = email.trim().toLowerCase();
    const name = fullName.trim();
    if (!value || !password) return;

    if (mode === 'signup') {
      if (!name) {
        setStatus('error');
        setMessage('Please enter your full name.');
        return;
      }
      if (password !== confirmPassword) {
        setStatus('error');
        setMessage('Passwords do not match.');
        return;
      }
    }

    setStatus('loading');
    setMessage('');
    try {
      const supabase = createClient();
      if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({
          email: value,
          password,
          options: {
            data: { full_name: name },
          },
        });
        if (error) throw error;

        // Prefer the session returned by signUp when available
        if (data.session) {
          await finalizeSession();
          return;
        }

        // If email confirmation is enabled, signUp may not return a session —
        // immediately sign in so the user lands in the logged-in UI.
        const { data: signedIn, error: signInError } =
          await supabase.auth.signInWithPassword({
            email: value,
            password,
          });
        if (signInError) throw signInError;
        if (!signedIn.session) {
          throw new Error('Account created but sign-in did not return a session.');
        }
        await finalizeSession();
        return;
      }

      const { data, error } = await supabase.auth.signInWithPassword({
        email: value,
        password,
      });
      if (error) throw error;
      if (!data.session) {
        throw new Error('Sign-in succeeded but no session was returned.');
      }
      await finalizeSession();
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
              setConfirmPassword('');
              setFullName('');
              setShowConfirmPassword(false);
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
          <div className="mt-6 space-y-4">
            <p className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
              {message}
            </p>
            <button
              type="button"
              onClick={closeAuth}
              className="inline-flex w-full items-center justify-center rounded-full border border-slate-600 bg-[#0D131F] px-5 py-2.5 text-sm font-semibold text-slate-200 transition hover:border-emerald-500/40 hover:text-emerald-300"
            >
              Dismiss
            </button>
          </div>
        ) : (
          <form className="mt-6 space-y-3" onSubmit={onSubmit}>
            {mode === 'signup' && (
              <label className="block" htmlFor="auth-full-name">
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Full Name
                </span>
                <input
                  id="auth-full-name"
                  type="text"
                  required
                  autoComplete="name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Jane Doe"
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-emerald-500/40"
                />
              </label>
            )}

            <label className="block" htmlFor="auth-email">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Email
              </span>
              <input
                id="auth-email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-emerald-500/40"
              />
            </label>

            <PasswordField
              id="auth-password"
              label="Password"
              value={password}
              onChange={setPassword}
              placeholder="At least 6 characters"
              autoComplete={
                mode === 'signin' ? 'current-password' : 'new-password'
              }
              visible={showPassword}
              onToggleVisible={() => setShowPassword((v) => !v)}
            />

            {mode === 'signup' && (
              <PasswordField
                id="auth-confirm-password"
                label="Confirm Password"
                value={confirmPassword}
                onChange={setConfirmPassword}
                placeholder="Re-enter your password"
                autoComplete="new-password"
                visible={showConfirmPassword}
                onToggleVisible={() => setShowConfirmPassword((v) => !v)}
              />
            )}

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
