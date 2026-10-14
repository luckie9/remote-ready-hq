import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { loadBillingCustomerId } from '@/lib/profile-subscription';
import { getStripe } from '@/lib/stripe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function appOrigin(request: Request): string {
  const origin = request.headers.get('origin')?.replace(/\/$/, '');
  if (origin) return origin;
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
  if (host) {
    const proto = request.headers.get('x-forwarded-proto') || (host.includes('localhost') ? 'http' : 'https');
    return `${proto}://${host}`;
  }
  return process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') || 'http://localhost:3000';
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user?.email) {
      return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
    }

    const customerId = await loadBillingCustomerId(supabase, user.id, user.email);
    if (!customerId) {
      return NextResponse.json(
        { error: 'No Stripe customer is linked to this account yet.' },
        { status: 409 }
      );
    }

    const portal = await getStripe().billingPortal.sessions.create({
      customer: customerId,
      return_url: `${appOrigin(request)}/profile`,
    });
    if (!portal.url) {
      return NextResponse.json(
        { error: 'Stripe did not return a billing portal URL' },
        { status: 500 }
      );
    }
    return NextResponse.json({ url: portal.url });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unable to open billing portal';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
