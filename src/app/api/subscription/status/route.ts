import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { loadProfileSubscription } from '@/lib/profile-subscription';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user?.email) {
      return NextResponse.json({ active: false });
    }

    const details = await loadProfileSubscription(supabase, user.id, user.email);
    return NextResponse.json(details);
  } catch {
    return NextResponse.json({ active: false });
  }
}
