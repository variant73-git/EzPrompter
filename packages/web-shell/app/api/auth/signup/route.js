import { NextResponse } from 'next/server';
import { sql } from '../../../../lib/db.js';
import { hashPassword, createToken, sessionCookieHeader } from '../../../../lib/auth.js';
import { grantWelcomeIfEligible } from '../../../../lib/billing/welcome.js';

export async function POST(request) {
  try {
    const { email, password, name, deviceHash } = await request.json();

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email and password are required' },
        { status: 400 }
      );
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { error: 'Invalid email format' },
        { status: 400 }
      );
    }

    if (password.length < 8) {
      return NextResponse.json(
        { error: 'Password must be at least 8 characters' },
        { status: 400 }
      );
    }

    const passwordHash = await hashPassword(password);

    // First hop of x-forwarded-for = client IP (spec §7 identity gates).
    const signupIp = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || null;
    const signupDevice = typeof deviceHash === 'string' && deviceHash ? deviceHash.slice(0, 128) : null;

    let rows;
    try {
      rows = await sql`
        INSERT INTO users (email, password_hash, name, signup_ip, signup_device_hash)
        VALUES (${email.toLowerCase()}, ${passwordHash}, ${name || null}, ${signupIp}, ${signupDevice})
        RETURNING id, email, name, plan
      `;
    } catch (err) {
      if (err.message && err.message.includes('unique')) {
        return NextResponse.json(
          { error: 'An account with this email already exists' },
          { status: 409 }
        );
      }
      throw err;
    }

    const user = rows[0];
    const token = createToken(user);

    // Welcome pack — identity-gated, never blocks the signup itself.
    let welcome = { granted: false, credits: 0 };
    try {
      welcome = await grantWelcomeIfEligible({
        sql, userId: user.id, email: user.email, ip: signupIp, deviceHash: signupDevice,
      });
    } catch (e) {
      console.error('welcome grant failed', e);
    }

    const res = NextResponse.json({
      token,
      user: { id: user.id, email: user.email, name: user.name, plan: user.plan },
      welcome: { granted: welcome.granted, credits: welcome.credits },
    });
    res.headers.set('set-cookie', sessionCookieHeader(token));
    return res;
  } catch (err) {
    console.error('Signup error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
