import { NextResponse } from 'next/server';
import { sql } from '../../../../lib/db.js';
import { verifyPassword, createToken, sessionCookieHeader } from '../../../../lib/auth.js';

export async function POST(request) {
  try {
    const { email, password } = await request.json();

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email and password are required' },
        { status: 400 }
      );
    }

    const rows = await sql`
      SELECT * FROM users WHERE email = ${email.toLowerCase()}
    `;

    if (rows.length === 0) {
      return NextResponse.json(
        { error: 'Invalid email or password' },
        { status: 401 }
      );
    }

    const user = rows[0];
    const valid = await verifyPassword(password, user.password_hash);

    if (!valid) {
      return NextResponse.json(
        { error: 'Invalid email or password' },
        { status: 401 }
      );
    }

    const token = createToken(user);

    const res = NextResponse.json({
      token,
      user: { id: user.id, email: user.email, name: user.name, plan: user.plan },
    });
    res.headers.set('set-cookie', sessionCookieHeader(token));
    return res;
  } catch (err) {
    console.error('Login error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
