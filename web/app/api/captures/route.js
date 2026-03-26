import { NextResponse } from 'next/server';
import { sql } from '../../../lib/db.js';
import { getAuthUser } from '../../../lib/auth.js';
import { storeCapture } from '../../../lib/redis.js';
import { PLANS } from '../../../lib/stripe.js';

export async function POST(request) {
  try {
    const user = await getAuthUser(request);

    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const plan = PLANS[user.plan] || PLANS.free;

    // Check captures remaining (pro has unlimited: -1)
    if (plan.captures !== -1 && user.captures_this_month >= plan.captures) {
      return NextResponse.json(
        { error: 'Monthly capture limit reached. Upgrade to Pro for unlimited captures.' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const id = crypto.randomUUID();
    const ttl = 1800; // 30 minutes

    await storeCapture(`capture:${id}`, body, ttl);

    await sql`
      UPDATE users
      SET captures_this_month = captures_this_month + 1
      WHERE id = ${user.id}
    `;

    const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();

    return NextResponse.json({ id, expiresAt });
  } catch (err) {
    console.error('Capture store error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
