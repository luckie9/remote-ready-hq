#!/usr/bin/env node
/**
 * Creates / updates RemoteReady HQ Stripe prices:
 *   - $1.97 one-time 3-day trial fee
 *   - $13.97 / month subscription
 * Writes price IDs into .env.local
 */
const fs = require('fs');
const path = require('path');
const Stripe = require('stripe');

const root = path.join(__dirname, '..');
const envPath = path.join(root, '.env.local');

const TRIAL_CENTS = 197;
const MONTHLY_CENTS = 1397;

function loadEnv(file) {
  const env = {};
  if (!fs.existsSync(file)) return env;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line || line.trim().startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i === -1) continue;
    env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return env;
}

function upsertEnv(file, updates) {
  let text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  for (const [key, value] of Object.entries(updates)) {
    const re = new RegExp(`^${key}=.*$`, 'm');
    if (re.test(text)) {
      text = text.replace(re, `${key}=${value}`);
    } else {
      text = `${text.trimEnd()}\n${key}=${value}\n`;
    }
  }
  fs.writeFileSync(file, text.endsWith('\n') ? text : `${text}\n`);
}

async function main() {
  const env = loadEnv(envPath);
  const key = env.STRIPE_SECRET_KEY;
  if (!key) {
    console.error('Missing STRIPE_SECRET_KEY in .env.local');
    process.exit(1);
  }

  const stripe = new Stripe(key);
  console.log('Creating / locating RemoteReady HQ product…');

  const products = await stripe.products.list({ limit: 100, active: true });
  let product = products.data.find((p) => p.metadata?.app === 'remote-ready-hq');
  if (!product) {
    product = await stripe.products.create({
      name: 'RemoteReady HQ Membership',
      description:
        '$1.97 3-Day All-Access Trial, then $13.97/month for direct employer apply links.',
      metadata: { app: 'remote-ready-hq' },
    });
    console.log('Created product', product.id);
  } else {
    console.log('Using existing product', product.id);
  }

  const prices = await stripe.prices.list({
    product: product.id,
    limit: 100,
    active: true,
  });

  let monthly = prices.data.find(
    (p) => p.recurring?.interval === 'month' && p.unit_amount === MONTHLY_CENTS
  );
  if (!monthly) {
    monthly = await stripe.prices.create({
      product: product.id,
      unit_amount: MONTHLY_CENTS,
      currency: 'usd',
      recurring: { interval: 'month' },
      nickname: 'RemoteReady $13.97 monthly',
      metadata: { app: 'remote-ready-hq', plan: 'monthly' },
    });
    console.log('Created monthly price', monthly.id);
  } else {
    console.log('Using monthly price', monthly.id);
  }

  let trial = prices.data.find(
    (p) => !p.recurring && p.unit_amount === TRIAL_CENTS
  );
  if (!trial) {
    trial = await stripe.prices.create({
      product: product.id,
      unit_amount: TRIAL_CENTS,
      currency: 'usd',
      nickname: 'RemoteReady $1.97 3-day trial',
      metadata: { app: 'remote-ready-hq', plan: 'trial' },
    });
    console.log('Created trial price', trial.id);
  } else {
    console.log('Using trial price', trial.id);
  }

  upsertEnv(envPath, {
    STRIPE_PRICE_ID_MONTHLY: monthly.id,
    STRIPE_PRICE_ID_TRIAL: trial.id,
  });
  console.log('Updated .env.local with Stripe price IDs ($1.97 / $13.97).');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
