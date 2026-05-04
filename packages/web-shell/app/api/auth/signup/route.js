import { NextResponse } from 'next/server';
import { sql } from '../../../../lib/db.js';
import { hashPassword, createToken, sessionCookieHeader } from '../../../../lib/auth.js';

export async function POST(request) {
  try {
    const { email, password, name } = await request.json();

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

    let rows;
    try {
      rows = await sql`
        INSERT INTO users (email, password_hash, name)
        VALUES (${email.toLowerCase()}, ${passwordHash}, ${name || null})
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

    const res = NextResponse.json({
      token,
      user: { id: user.id, email: user.email, name: user.name, plan: user.plan },
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
