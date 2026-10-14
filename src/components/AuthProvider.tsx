'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
import type { User } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';

type AuthContextValue = {
  user: User | null;
  loading: boolean;
  appliedJobIds: Set<string>;
  authOpen: boolean;
  alertOpen: boolean;
  hasSubscribedAlerts: boolean;
  /** Paid members and people who already shared an email should not see the alert prompt. */
  hideJobAlerts: boolean;
  jobAlertsReady: boolean;
  openAuth: () => void;
  closeAuth: () => void;
  openAlert: () => void;
  closeAlert: () => void;
  markAlertSubscribed: () => void;
  signOut: () => Promise<void>;
  markApplied: (jobId: string) => Promise<void>;
  refreshApplications: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

const APPLIED_KEY = 'rrhq_applied_jobs';
export const ALERT_SUBSCRIBED_KEY = 'has_subscribed_job_alerts';
/** Persists a dismissed alert prompt across reloads and client navigations. */
const ALERT_HIDE_KEY = 'rrhq_hide_job_alerts';
const ALERT_SESSION_START_KEY = 'rrhq_alert_session_start';
const ALERT_FIRED_KEY = 'rrhq_alert_triggers_fired';

/** Auto popup schedule from session start: 5s, 20m, 1h, 2h */
export const ALERT_TRIGGER_DELAYS_MS = [
  5_000,
  20 * 60_000,
  60 * 60_000,
  2 * 60 * 60_000,
] as const;

function readLocalApplied(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(APPLIED_KEY);
    const arr = raw ? (JSON.parse(raw) as string[]) : [];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function writeLocalApplied(ids: Set<string>) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(APPLIED_KEY, JSON.stringify([...ids]));
}

function readSubscribed(): boolean {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(ALERT_SUBSCRIBED_KEY) === '1';
}

function readAlertHidden(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    readSubscribed() || window.localStorage.getItem(ALERT_HIDE_KEY) === '1'
  );
}

function writeAlertHidden(hidden: boolean) {
  if (typeof window === 'undefined') return;
  if (hidden) window.localStorage.setItem(ALERT_HIDE_KEY, '1');
  else window.localStorage.removeItem(ALERT_HIDE_KEY);
}

function emailIsConfirmed(user: User | null): boolean {
  if (!user?.email) return false;
  const record = user as User & {
    email_confirmed_at?: string | null;
    confirmed_at?: string | null;
  };
  return Boolean(record.email_confirmed_at || record.confirmed_at);
}

function getSessionStart(): number {
  const existing = window.sessionStorage.getItem(ALERT_SESSION_START_KEY);
  if (existing) {
    const n = Number(existing);
    if (Number.isFinite(n) && n > 0) return n;
  }
  const now = Date.now();
  window.sessionStorage.setItem(ALERT_SESSION_START_KEY, String(now));
  return now;
}

function readFiredTriggers(): number[] {
  try {
    const raw = window.sessionStorage.getItem(ALERT_FIRED_KEY);
    const arr = raw ? (JSON.parse(raw) as number[]) : [];
    return Array.isArray(arr) ? arr.filter((n) => Number.isInteger(n)) : [];
  } catch {
    return [];
  }
}

function markTriggerFired(index: number) {
  const fired = new Set(readFiredTriggers());
  fired.add(index);
  window.sessionStorage.setItem(ALERT_FIRED_KEY, JSON.stringify([...fired]));
}

async function syncUnlockCookie(): Promise<boolean> {
  try {
    const res = await fetch('/api/subscription/sync', { method: 'POST' });
    if (!res.ok) return false;
    const data = (await res.json()) as { unlocked?: boolean };
    return Boolean(data.unlocked);
  } catch {
    return false;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(false);
  const [appliedJobIds, setAppliedJobIds] = useState<Set<string>>(new Set());
  const [authOpen, setAuthOpen] = useState(false);
  const [alertOpen, setAlertOpen] = useState(false);
  const [hasSubscribedAlerts, setHasSubscribedAlerts] = useState(false);
  const [hideJobAlerts, setHideJobAlerts] = useState(false);
  const [jobAlertsReady, setJobAlertsReady] = useState(false);
  const alertOpenRef = useRef(false);
  const hideJobAlertsRef = useRef(false);
  const alertCheckRef = useRef(0);
  const scheduleGenRef = useRef(0);
  const lastSyncedUserId = useRef<string | null>(null);

  useEffect(() => {
    alertOpenRef.current = alertOpen;
  }, [alertOpen]);

  useEffect(() => {
    hideJobAlertsRef.current = hideJobAlerts;
  }, [hideJobAlerts]);

  const resolveAlertSuppression = useCallback(
    async (current: User | null): Promise<boolean> => {
      if (readSubscribed()) return true;
      if (!current?.email) return false;
      if (emailIsConfirmed(current)) return true;

      const unlocked = await syncUnlockCookie();
      if (unlocked) return true;

      try {
        const email = current.email.trim().toLowerCase();
        const { data, error } = await supabase
          .from('job_alerts')
          .select('email')
          .ilike('email', email)
          .maybeSingle();
        if (!error && data?.email) return true;
      } catch {
        // Missing table or RLS — local session state still applies.
      }
      return false;
    },
    [supabase]
  );

  const refreshApplications = useCallback(async () => {
    const local = readLocalApplied();
    const {
      data: { user: current },
    } = await supabase.auth.getUser();
    if (!current) {
      setAppliedJobIds(local);
      return;
    }
    try {
      const res = await fetch('/api/applications');
      if (!res.ok) {
        setAppliedJobIds(local);
        return;
      }
      const data = (await res.json()) as { jobIds?: string[] };
      const merged = new Set([...(data.jobIds ?? []), ...local]);
      setAppliedJobIds(merged);
      writeLocalApplied(merged);
    } catch {
      setAppliedJobIds(local);
    }
  }, [supabase]);

  useEffect(() => {
    let mounted = true;
    setAppliedJobIds(readLocalApplied());
    const storedHide = readAlertHidden();
    setHasSubscribedAlerts(readSubscribed());
    setHideJobAlerts(storedHide);

    async function applyUser(current: User | null) {
      const checkId = ++alertCheckRef.current;
      if (!mounted) return;
      setUser(current);
      const hide = await resolveAlertSuppression(current);
      if (!mounted || checkId !== alertCheckRef.current) return;
      setHideJobAlerts(hide);
      if (hide) writeAlertHidden(true);
      else if (!readSubscribed()) writeAlertHidden(false);
      if (hide) setAlertOpen(false);
      setJobAlertsReady(true);
    }

    supabase.auth
      .getUser()
      .then(({ data }) => applyUser(data.user ?? null))
      .catch(() => {
        if (!mounted) return;
        setJobAlertsReady(true);
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      void applyUser(session?.user ?? null);
    });
    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [supabase, resolveAlertSuppression]);

  useEffect(() => {
    void refreshApplications();
  }, [user?.id, refreshApplications]);

  // After sign-in, sync paid unlock from Supabase → cookie and refresh RSC paywall.
  useEffect(() => {
    if (!user?.id) {
      lastSyncedUserId.current = null;
      return;
    }
    if (lastSyncedUserId.current === user.id) return;
    lastSyncedUserId.current = user.id;
    void (async () => {
      const unlocked = await syncUnlockCookie();
      if (unlocked) router.refresh();
    })();
  }, [user?.id, router]);

  const scheduleNextAlert = useCallback(() => {
    if (typeof window === 'undefined') return;
    scheduleGenRef.current += 1;
    const gen = scheduleGenRef.current;

    if (readSubscribed() || hasSubscribedAlerts || hideJobAlertsRef.current) return;

    const start = getSessionStart();
    const fired = new Set(readFiredTriggers());
    const nextIndex = ALERT_TRIGGER_DELAYS_MS.findIndex((_, i) => !fired.has(i));
    if (nextIndex === -1) return;

    const delay = ALERT_TRIGGER_DELAYS_MS[nextIndex];
    const remaining = Math.max(0, delay - (Date.now() - start));

    const timer = window.setTimeout(() => {
      if (gen !== scheduleGenRef.current) return;
      if (readSubscribed() || hideJobAlertsRef.current) return;
      if (alertOpenRef.current) {
        // Modal already open (manual) — retry soon without consuming the slot
        window.setTimeout(() => {
          if (gen === scheduleGenRef.current) scheduleNextAlert();
        }, 1500);
        return;
      }
      markTriggerFired(nextIndex);
      setAlertOpen(true);
    }, remaining);

    return () => window.clearTimeout(timer);
  }, [hasSubscribedAlerts]);

  useEffect(() => {
    if (!jobAlertsReady || hideJobAlerts) return;
    if (alertOpen) return;
    return scheduleNextAlert();
  }, [alertOpen, hideJobAlerts, jobAlertsReady, scheduleNextAlert]);

  useEffect(() => {
    if (hideJobAlerts) setAlertOpen(false);
  }, [hideJobAlerts]);

  const markAlertSubscribed = useCallback(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(ALERT_SUBSCRIBED_KEY, '1');
      writeAlertHidden(true);
    }
    setHasSubscribedAlerts(true);
    setHideJobAlerts(true);
    setAlertOpen(false);
  }, []);

  const markApplied = useCallback(
    async (jobId: string) => {
      setAppliedJobIds((prev) => {
        const next = new Set(prev).add(jobId);
        writeLocalApplied(next);
        return next;
      });
      const {
        data: { user: current },
      } = await supabase.auth.getUser();
      if (!current) {
        setAuthOpen(true);
        return;
      }
      const res = await fetch('/api/applications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId }),
      });
      if (!res.ok && res.status === 401) {
        setAuthOpen(true);
      }
    },
    [supabase]
  );

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    writeAlertHidden(readSubscribed());
    setHideJobAlerts(readSubscribed());
  }, [supabase]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      appliedJobIds,
      authOpen,
      alertOpen,
      hasSubscribedAlerts,
      hideJobAlerts,
      jobAlertsReady,
      openAuth: () => setAuthOpen(true),
      closeAuth: () => setAuthOpen(false),
      openAlert: () => {
        if (hideJobAlertsRef.current) return;
        setAlertOpen(true);
      },
      closeAlert: () => setAlertOpen(false),
      markAlertSubscribed,
      signOut,
      markApplied,
      refreshApplications,
    }),
    [
      user,
      loading,
      appliedJobIds,
      authOpen,
      alertOpen,
      hasSubscribedAlerts,
      hideJobAlerts,
      jobAlertsReady,
      markAlertSubscribed,
      signOut,
      markApplied,
      refreshApplications,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
