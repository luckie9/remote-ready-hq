import { NextResponse } from 'next/server';
import { openBillingPortal } from '@/lib/billing-portal';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Cancel via the Stripe Customer Portal for the signed-in user's email. */
export async function POST(request: Request) {
  try {
    return await openBillingPortal(request, true);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unable to cancel subscription';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
