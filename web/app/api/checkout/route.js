import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../lib/auth.js';
import { createCheckoutSession } from '../../../lib/stripe.js';

export async function POST(request) {
  try {
    const user = await getAuthUser(request);

    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    if (user.plan === 'pro') {
      return NextResponse.json(
        { error: 'You are already on the Pro plan' },
        { status: 400 }
      );
    }

    const session = await createCheckoutSession(user.id, user.email);

    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error('Checkout error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
