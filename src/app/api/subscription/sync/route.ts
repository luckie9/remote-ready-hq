import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  applySubscriberCookie,
  lookupDbEntitlement,
} from '@/lib/subscription';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * After sign-in, mint the unlock cookie from Supabase subscription /
 * active_subscriber so paid users are unlocked across browsers/devices.
 */
export async function POST() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user?.email) {
      return NextResponse.json({ unlocked: false, reason: 'not_signed_in' });
    }

    const entitlement = await lookupDbEntitlement(user.email);
    if (!entitlement) {
      return NextResponse.json({ unlocked: false, reason: 'no_entitlement' });
    }

    const response = NextResponse.json({
      unlocked: true,
      plan: entitlement.plan,
      status: entitlement.status,
      exp: entitlement.exp,
    });
    applySubscriberCookie(response, entitlement);
    return response;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'sync failed';
    return NextResponse.json({ unlocked: false, error: message }, { status: 500 });
  }
}

export async function GET() {
  return POST();
}
