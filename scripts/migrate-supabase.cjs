#!/usr/bin/env node
/**
 * Apply scrapers/schema.sql using a direct Postgres connection.
 *
 * Requires one of:
 *   SUPABASE_DB_PASSWORD  (Database password from Supabase → Settings → Database)
 *   DATABASE_URL          (full postgres connection string)
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const root = path.join(__dirname, '..');
const envPath = path.join(root, '.env.local');
const schemaPath = path.join(root, 'scrapers', 'schema.sql');

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

async function probeRest(url, key) {
  const res = await fetch(`${url}/rest/v1/jobs?select=id&limit=1`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  return { status: res.status, text: (await res.text()).slice(0, 300) };
}

async function main() {
  const env = loadEnv(envPath);
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = env.SUPABASE_SECRET_KEY;
  const ref = (url || '').match(/https:\/\/([a-z0-9]+)\.supabase\.co/i)?.[1];

  if (!url || !secret) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY');
    process.exit(1);
  }

  console.log('REST probe…');
  console.log(await probeRest(url, secret));

  const sql = fs.readFileSync(schemaPath, 'utf8');
  let connectionString = env.DATABASE_URL;

  if (!connectionString) {
    const password = env.SUPABASE_DB_PASSWORD || env.POSTGRES_PASSWORD;
    if (!password || !ref) {
      console.error(`
Cannot run DDL without a database password.

Add one of these to .env.local:
  SUPABASE_DB_PASSWORD=your-database-password
  DATABASE_URL=postgresql://postgres.${ref}:PASSWORD@aws-0-us-east-1.pooler.supabase.com:6543/postgres

Find the password in Supabase Dashboard → Project Settings → Database.
Or sign in at the SQL editor and paste scrapers/schema.sql, then re-run:
  npm run scrape
`);
      process.exit(2);
    }
    connectionString = `postgresql://postgres.${ref}:${encodeURIComponent(password)}@aws-0-us-east-1.pooler.supabase.com:6543/postgres`;
  }

  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  console.log('Connected. Applying schema…');
  await client.query(sql);
  await client.end();
  console.log('Migration complete.');
  console.log('POST-MIGRATE REST', await probeRest(url, secret));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
