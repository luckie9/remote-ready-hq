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
import type { User } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';

type AuthContextValue = {
  user: User | null;
  loading: boolean;
  appliedJobIds: Set<string>;
  authOpen: boolean;
  alertOpen: boolean;
  hasSubscribedAlerts: boolean;
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

export function AuthProvider({ children }: { children: ReactNode }) {
  const supabase = useMemo(() => createClient(), []);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(false);
  const [appliedJobIds, setAppliedJobIds] = useState<Set<string>>(new Set());
  const [authOpen, setAuthOpen] = useState(false);
  const [alertOpen, setAlertOpen] = useState(false);
  const [hasSubscribedAlerts, setHasSubscribedAlerts] = useState(false);
  const alertOpenRef = useRef(false);
  const scheduleGenRef = useRef(0);

  useEffect(() => {
    alertOpenRef.current = alertOpen;
  }, [alertOpen]);

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
    setHasSubscribedAlerts(readSubscribed());

    supabase.auth
      .getUser()
      .then(({ data }) => {
        if (!mounted) return;
        setUser(data.user ?? null);
      })
      .catch(() => undefined);

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [supabase]);

  useEffect(() => {
    void refreshApplications();
  }, [user?.id, refreshApplications]);

  const scheduleNextAlert = useCallback(() => {
    if (typeof window === 'undefined') return;
    scheduleGenRef.current += 1;
    const gen = scheduleGenRef.current;

    if (readSubscribed() || hasSubscribedAlerts) return;

    const start = getSessionStart();
    const fired = new Set(readFiredTriggers());
    const nextIndex = ALERT_TRIGGER_DELAYS_MS.findIndex((_, i) => !fired.has(i));
    if (nextIndex === -1) return;

    const delay = ALERT_TRIGGER_DELAYS_MS[nextIndex];
    const remaining = Math.max(0, delay - (Date.now() - start));

    const timer = window.setTimeout(() => {
      if (gen !== scheduleGenRef.current) return;
      if (readSubscribed()) return;
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
    if (hasSubscribedAlerts) return;
    if (alertOpen) return;
    return scheduleNextAlert();
  }, [alertOpen, hasSubscribedAlerts, scheduleNextAlert]);

  const markAlertSubscribed = useCallback(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(ALERT_SUBSCRIBED_KEY, '1');
    }
    setHasSubscribedAlerts(true);
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
  }, [supabase]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      appliedJobIds,
      authOpen,
      alertOpen,
      hasSubscribedAlerts,
      openAuth: () => setAuthOpen(true),
      closeAuth: () => setAuthOpen(false),
      openAlert: () => setAlertOpen(true),
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
