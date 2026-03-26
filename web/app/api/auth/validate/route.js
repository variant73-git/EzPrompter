import { NextResponse } from 'next/server';
import { sql } from '../../../../lib/db.js';
import { getAuthUser } from '../../../../lib/auth.js';
import { PLANS } from '../../../../lib/stripe.js';

export async function GET(request) {
  try {
    const user = await getAuthUser(request);

    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Check if captures should be reset (older than 30 days)
    const resetAt = new Date(user.captures_reset_at);
    const now = new Date();
    const daysSinceReset = (now - resetAt) / (1000 * 60 * 60 * 24);

    if (daysSinceReset >= 30) {
      await sql`
        UPDATE users
        SET captures_this_month = 0, captures_reset_at = NOW()
        WHERE id = ${user.id}
      `;
      user.captures_this_month = 0;
    }

    const plan = PLANS[user.plan] || PLANS.free;

    return NextResponse.json({
      user: {
        email: user.email,
        name: user.name,
        plan: user.plan,
        capturesUsed: user.captures_this_month,
        capturesLimit: plan.captures,
      },
    });
  } catch (err) {
    console.error('Validate error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
