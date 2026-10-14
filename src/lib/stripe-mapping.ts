import type { SupabaseClient } from '@supabase/supabase-js';
import type Stripe from 'stripe';
import { getStripe } from '@/lib/stripe';
import { createAdminSupabase, isMissingRelationError } from '@/lib/supabase';

export type StripeCustomerMatch = {
  customerId: string;
  subscriptionId: string | null;
  status: string | null;
};

type WriteError = { code?: string; message?: string } | null;

function columnFromError(error: WriteError): string | null {
  const message = error?.message ?? '';
  const quoted = message.match(/'([^']+)' column/i);
  if (quoted?.[1]) return quoted[1];
  const missing = message.match(/column [\w."]+\.(\w+) does not exist/i);
  return missing?.[1] ?? null;
}

function foreignKeyUser(error: WriteError): boolean {
  return /foreign key|user_id/i.test(error?.message ?? '');
}

function adminClient(): SupabaseClient | null {
  try {
    return createAdminSupabase();
  } catch {
    return null;
  }
}

async function findAuthUserId(
  client: SupabaseClient,
  email: string
): Promise<string | null> {
  try {
    for (let page = 1; page <= 10; page += 1) {
      const { data, error } = await client.auth.admin.listUsers({
        page,
        perPage: 200,
      });
      if (error || !data?.users?.length) return null;
      const match = data.users.find(
        (user) => user.email?.trim().toLowerCase() === email
      );
      if (match?.id) return match.id;
      if (data.users.length < 200) return null;
    }
  } catch {
    return null;
  }
  return null;
}

async function rememberOnUsersTable(
  client: SupabaseClient,
  email: string,
  customerId: string | null
): Promise<string | null> {
  const payload: Record<string, string | null> = {
    email,
    stripe_customer_id: customerId,
  };
  const existing = await client
    .from('users')
    .select('id')
    .eq('email', email)
    .maybeSingle();
  if (existing.error) {
    if (isMissingRelationError(existing.error)) return null;
    return null;
  }
  if (existing.data?.id) {
    await client.from('users').update(payload).eq('id', existing.data.id);
    return existing.data.id as string;
  }
  const created = await client.from('users').insert(payload).select('id').maybeSingle();
  return (created.data?.id as string | undefined) ?? null;
}

async function writeSubscriptionRow(
  client: SupabaseClient,
  payload: Record<string, string | null>,
  subscriptionId: string | null,
  userId: string | null
): Promise<boolean> {
  const body = { ...payload };
  for (let attempt = 0; attempt < 8; attempt += 1) {
    let targetId: string | null = null;
    if (subscriptionId && body.stripe_subscription_id) {
      const existing = await client
        .from('subscriptions')
        .select('id')
        .eq('stripe_subscription_id', subscriptionId)
        .maybeSingle();
      if (!existing.error && existing.data?.id) targetId = existing.data.id as string;
    }
    if (!targetId && userId && body.user_id) {
      const existing = await client
        .from('subscriptions')
        .select('id')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(1);
      if (!existing.error && existing.data?.[0]?.id) {
        targetId = existing.data[0].id as string;
      }
    }

    const result = targetId
      ? await client.from('subscriptions').update(body).eq('id', targetId)
      : await client.from('subscriptions').insert(body);
    if (!result.error) return true;

    const missing = columnFromError(result.error);
    if (missing && missing in body) {
      delete body[missing];
      continue;
    }
    const nullColumn = (result.error.message ?? '').match(
      /null value in column "(\w+)"/i
    );
    if (nullColumn?.[1] && nullColumn[1] in body) {
      delete body[nullColumn[1]];
      continue;
    }
    if (foreignKeyUser(result.error) && 'user_id' in body) {
      delete body.user_id;
      continue;
    }
    return false;
  }
  return false;
}

/** Store the Stripe customer and subscription on the Supabase row for this email. */
export async function saveStripeCustomerLink(input: {
  email: string;
  authUserId?: string | null;
  customerId: string | null;
  subscriptionId?: string | null;
  status?: string | null;
  plan?: string | null;
  priceId?: string | null;
  currentPeriodEnd?: string | null;
}): Promise<boolean> {
  const email = input.email.trim().toLowerCase();
  const customerId = input.customerId?.startsWith('cus_') ? input.customerId : null;
  const subscriptionId = input.subscriptionId?.startsWith('sub_')
    ? input.subscriptionId
    : null;
  if (!email || !customerId) return false;

  const client = adminClient();
  if (!client) return false;

  let userId = input.authUserId ?? null;
  try {
    const profileId = await rememberOnUsersTable(client, email, customerId);
    userId = userId || profileId || (await findAuthUserId(client, email));
  } catch {
    userId = userId || (await findAuthUserId(client, email));
  }

  return writeSubscriptionRow(
    client,
    {
      user_id: userId,
      email,
      stripe_customer_id: customerId,
      stripe_subscription_id: subscriptionId,
      stripe_price_id: input.priceId ?? null,
      status: input.status || 'active',
      plan: input.plan ?? null,
      current_period_end: input.currentPeriodEnd ?? null,
      updated_at: new Date().toISOString(),
    },
    subscriptionId,
    userId
  );
}

function preferredSubscription(
  subscriptions: Stripe.Subscription[]
): Stripe.Subscription | null {
  return (
    subscriptions.find((item) => item.status === 'trialing') ||
    subscriptions.find((item) => item.status === 'active') ||
    subscriptions.find((item) => item.status === 'past_due') ||
    subscriptions[0] ||
    null
  );
}

/** Find a Stripe customer by the account email when Supabase has no customer id. */
export async function findStripeCustomerByEmail(
  email: string
): Promise<StripeCustomerMatch | null> {
  const raw = email.trim();
  const normalized = raw.toLowerCase();
  if (!normalized) return null;
  let stripe: Stripe;
  try {
    stripe = getStripe();
  } catch {
    return null;
  }

  const customers = new Map<string, Stripe.Customer>();
  const variants = raw === normalized ? [normalized] : [raw, normalized];
  for (const value of variants) {
    try {
      const listed = await stripe.customers.list({ email: value, limit: 10 });
      for (const customer of listed.data) customers.set(customer.id, customer);
    } catch {
      // Search below still covers accounts whose email casing differs.
    }
    try {
      const searched = await stripe.customers.search({
        query: `email:"${value.replace(/"/g, '')}"`,
        limit: 10,
      });
      for (const customer of searched.data) customers.set(customer.id, customer);
    } catch {
      // List result stands when search is unavailable.
    }
  }
  if (customers.size === 0) return null;

  let fallback: StripeCustomerMatch | null = null;
  for (const customer of customers.values()) {
    try {
      const subs = await stripe.subscriptions.list({
        customer: customer.id,
        status: 'all',
        limit: 5,
      });
      const chosen = preferredSubscription(subs.data);
      const match: StripeCustomerMatch = {
        customerId: customer.id,
        subscriptionId: chosen?.id ?? null,
        status: chosen?.status ?? null,
      };
      if (chosen && (chosen.status === 'active' || chosen.status === 'trialing')) {
        return match;
      }
      fallback = fallback ?? match;
    } catch {
      fallback = fallback ?? {
        customerId: customer.id,
        subscriptionId: null,
        status: null,
      };
    }
  }
  return fallback;
}
