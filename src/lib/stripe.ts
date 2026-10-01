import Stripe from 'stripe';

let stripeSingleton: Stripe | null = null;

export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error('Missing STRIPE_SECRET_KEY');
  }
  if (!stripeSingleton) {
    stripeSingleton = new Stripe(key, {
      apiVersion: '2026-08-26.dahlia',
    });
  }
  return stripeSingleton;
}

export const STRIPE_PRICES = {
  monthly: process.env.STRIPE_PRICE_ID_MONTHLY ?? '',
  trial: process.env.STRIPE_PRICE_ID_TRIAL ?? '',
} as const;

/** Display + checkout amounts */
export const PLAN_AMOUNTS = {
  trialCents: 197,
  monthlyCents: 1397,
  trialLabel: '$1.97 3-Day All-Access Trial',
  monthlyLabel: '$13.97/month',
  trialDays: 3,
} as const;
