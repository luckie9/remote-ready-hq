import type { SupabaseClient } from '@supabase/supabase-js';
import type Stripe from 'stripe';
import { getStripe, PLAN_AMOUNTS } from '@/lib/stripe';
import {
  findStripeCustomerByEmail,
  saveStripeCustomerLink,
} from '@/lib/stripe-mapping';
import { createAdminSupabase } from '@/lib/supabase';
import {
  getSubscriberSession,
  type SubscriberSession,
} from '@/lib/subscription';

export type ProfileSubscription = {
  active: boolean;
  plan: 'trial' | 'monthly' | null;
  planLabel: string;
  startedAt: string | null;
  endsAt: string | null;
  /** Trial access end, or the next monthly renewal. */
  dateLabel: 'Access ends' | 'Next renewal';
  canManage: boolean;
};

const INACTIVE: ProfileSubscription = {
  active: false,
  plan: null,
  planLabel: '',
  startedAt: null,
  endsAt: null,
  dateLabel: 'Access ends',
  canManage: false,
};

const FULL_COLUMNS =
  'status, plan, current_period_end, created_at, stripe_customer_id, stripe_subscription_id, user_id, email';
const LIVE_COLUMNS =
  'status, created_at, stripe_customer_id, stripe_subscription_id, user_id';

type SubRow = {
  status?: string | null;
  plan?: string | null;
  current_period_end?: string | null;
  created_at?: string | null;
  stripe_customer_id?: string | null;
  stripe_subscription_id?: string | null;
  user_id?: string | null;
  email?: string | null;
};

function missingColumn(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const message = (error.message ?? '').toLowerCase();
  return (
    error.code === '42703' ||
    error.code === 'PGRST204' ||
    message.includes('does not exist') ||
    message.includes('schema cache')
  );
}

function isActiveStatus(status: string | null | undefined): boolean {
  return status === 'active' || status === 'trialing' || status === 'paid';
}

function planLabel(plan: 'trial' | 'monthly'): string {
  return plan === 'trial' ? '3-Day Trial' : 'Monthly Membership';
}

function isoFromUnix(seconds: number | null | undefined): string | null {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return null;
  return new Date(seconds * 1000).toISOString();
}

function periodBounds(sub: Stripe.Subscription): {
  start: string | null;
  end: string | null;
} {
  const item = sub.items?.data?.[0] as
    | { current_period_start?: number; current_period_end?: number }
    | undefined;
  const start =
    typeof item?.current_period_start === 'number'
      ? item.current_period_start
      : sub.start_date;
  const end =
    typeof item?.current_period_end === 'number' ? item.current_period_end : null;
  return { start: isoFromUnix(start), end: isoFromUnix(end) };
}

async function firstMatchingRow(
  client: SupabaseClient,
  userId: string,
  email: string
): Promise<SubRow | null> {
  const byUser = await client
    .from('subscriptions')
    .select(FULL_COLUMNS)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1);
  if (!byUser.error) {
    if (byUser.data?.[0]) return byUser.data[0] as SubRow;
    const byEmail = await client
      .from('subscriptions')
      .select(FULL_COLUMNS)
      .eq('email', email)
      .order('created_at', { ascending: false })
      .limit(1);
    if (byEmail.error || !byEmail.data?.[0]) return null;
    return byEmail.data[0] as SubRow;
  }

  if (!missingColumn(byUser.error)) return null;

  const slim = await client
    .from('subscriptions')
    .select(LIVE_COLUMNS)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1);
  if (slim.error || !slim.data?.[0]) return null;
  return slim.data[0] as SubRow;
}

async function readSubscriptionRow(
  session: SupabaseClient,
  userId: string,
  email: string
): Promise<SubRow | null> {
  const fromSession = await firstMatchingRow(session, userId, email);
  if (fromSession) return fromSession;
  try {
    return await firstMatchingRow(createAdminSupabase(), userId, email);
  } catch {
    return null;
  }
}

function stripeClient(): Stripe | null {
  try {
    return getStripe();
  } catch {
    return null;
  }
}

async function stripeSubscriptionFor(
  row: SubRow | null,
  email: string
): Promise<{ sub: Stripe.Subscription | null; customerId: string | null }> {
  const stripe = stripeClient();
  const rowCustomer = row?.stripe_customer_id ?? null;
  const rowSubId = row?.stripe_subscription_id ?? null;
  if (!stripe) return { sub: null, customerId: rowCustomer };

  if (rowSubId?.startsWith('sub_')) {
    try {
      const sub = await stripe.subscriptions.retrieve(rowSubId);
      const customer =
        typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
      return { sub, customerId: customer || rowCustomer };
    } catch {
      // Fall through to a customer lookup by email.
    }
  }

  try {
    const found = await findStripeCustomerByEmail(email);
    if (!found) return { sub: null, customerId: rowCustomer };
    if (!found.subscriptionId) {
      return { sub: null, customerId: found.customerId };
    }
    const sub = await stripe.subscriptions.retrieve(found.subscriptionId);
    return { sub, customerId: found.customerId };
  } catch {
    return { sub: null, customerId: rowCustomer };
  }
}

function fromStripe(
  sub: Stripe.Subscription,
  customerId: string | null,
  row: SubRow | null
): ProfileSubscription {
  const active = sub.status === 'trialing' || sub.status === 'active';
  if (!active) return INACTIVE;
  const plan: 'trial' | 'monthly' = sub.status === 'trialing' ? 'trial' : 'monthly';
  const bounds = periodBounds(sub);
  return {
    active: true,
    plan,
    planLabel: planLabel(plan),
    startedAt: bounds.start || row?.created_at || null,
    endsAt: plan === 'trial' ? isoFromUnix(sub.trial_end) || bounds.end : bounds.end,
    dateLabel: plan === 'trial' ? 'Access ends' : 'Next renewal',
    canManage: Boolean((customerId || '').startsWith('cus_')),
  };
}

function fromRow(row: SubRow): ProfileSubscription | null {
  if (!isActiveStatus(row.status)) return null;
  const plan: 'trial' | 'monthly' =
    row.plan === 'trial' || row.status === 'trialing' ? 'trial' : 'monthly';
  const endsAt = row.current_period_end ?? null;
  if (endsAt && new Date(endsAt).getTime() <= Date.now()) return null;
  return {
    active: true,
    plan,
    planLabel: planLabel(plan),
    startedAt: row.created_at ?? null,
    endsAt,
    dateLabel: plan === 'trial' ? 'Access ends' : 'Next renewal',
    canManage: Boolean(row.stripe_customer_id?.startsWith('cus_')),
  };
}

function fromCookie(cookie: SubscriberSession): ProfileSubscription {
  const plan = cookie.plan === 'monthly' ? 'monthly' : 'trial';
  const endsAt = new Date(cookie.exp).toISOString();
  const startedAt =
    plan === 'trial'
      ? new Date(cookie.exp - PLAN_AMOUNTS.trialDays * 24 * 60 * 60 * 1000).toISOString()
      : null;
  return {
    active: true,
    plan,
    planLabel: planLabel(plan),
    startedAt,
    endsAt,
    dateLabel: plan === 'trial' ? 'Access ends' : 'Next renewal',
    canManage: false,
  };
}

/** Active plan, dates, and whether the Stripe customer portal can be opened. */
export async function loadProfileSubscription(
  session: SupabaseClient,
  userId: string,
  email: string
): Promise<ProfileSubscription> {
  const normalized = email.trim().toLowerCase();
  const row = await readSubscriptionRow(session, userId, normalized);
  const { sub, customerId } = await stripeSubscriptionFor(row, normalized);
  if (sub && (sub.status === 'trialing' || sub.status === 'active')) {
    return fromStripe(sub, customerId, row);
  }
  if (sub && (sub.status === 'canceled' || sub.status === 'incomplete_expired')) {
    return INACTIVE;
  }

  const fromDatabase = row ? fromRow(row) : null;
  if (fromDatabase) {
    return {
      ...fromDatabase,
      canManage: fromDatabase.canManage || Boolean(customerId?.startsWith('cus_')),
    };
  }

  const cookie = await getSubscriberSession();
  if (
    cookie &&
    cookie.email.trim().toLowerCase() === normalized &&
    cookie.exp > Date.now()
  ) {
    const details = fromCookie(cookie);
    return {
      ...details,
      canManage: Boolean(customerId?.startsWith('cus_')),
    };
  }

  return INACTIVE;
}

export async function loadBillingTarget(
  session: SupabaseClient,
  userId: string,
  email: string
): Promise<{ customerId: string | null; subscriptionId: string | null }> {
  const normalized = email.trim().toLowerCase();
  const row = await readSubscriptionRow(session, userId, normalized);
  const { sub, customerId } = await stripeSubscriptionFor(row, normalized);
  const resolvedCustomer =
    (row?.stripe_customer_id?.startsWith('cus_') && row.stripe_customer_id) ||
    (customerId?.startsWith('cus_') && customerId) ||
    (typeof sub?.customer === 'string' && sub.customer.startsWith('cus_')
      ? sub.customer
      : null);
  const subscriptionId = sub?.id?.startsWith('sub_')
    ? sub.id
    : row?.stripe_subscription_id?.startsWith('sub_')
      ? row.stripe_subscription_id
      : null;

  if (
    resolvedCustomer &&
    row?.stripe_customer_id !== resolvedCustomer
  ) {
    await saveStripeCustomerLink({
      email: normalized,
      authUserId: userId,
      customerId: resolvedCustomer,
      subscriptionId,
      status: sub?.status || row?.status || 'active',
      plan: row?.plan ?? null,
    });
  }

  return { customerId: resolvedCustomer || null, subscriptionId };
}
