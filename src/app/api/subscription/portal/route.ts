import { NextResponse } from 'next/server';
import { openBillingPortal } from '@/lib/billing-portal';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { intent?: string };
    return await openBillingPortal(request, body.intent === 'cancel');
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unable to open billing portal';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
