import { beforeEach, describe, expect, it, vi } from 'vitest';

function fakeSql(results) {
  let i = 0;
  const calls = [];
  const sql = (strings, ...values) => {
    calls.push({ text: Array.isArray(strings) ? strings.join(' ') : String(strings), values });
    return Promise.resolve(results[i++] ?? []);
  };
  sql.calls = calls;
  return sql;
}

let currentSql = fakeSql([]);
const verifyPasswordMock = vi.fn();

vi.mock('../../../../lib/db.js', () => ({
  sql: (...args) => currentSql(...args),
}));

vi.mock('../../../../lib/auth.js', () => ({
  verifyPassword: (...args) => verifyPasswordMock(...args),
  createToken: () => 'token',
  sessionCookieHeader: () => 'uncraft_sess=token; Path=/',
}));

const { POST } = await import('./route.js');

const makeRequest = (body) => ({
  json: async () => body,
});

beforeEach(() => {
  currentSql = fakeSql([]);
  verifyPasswordMock.mockReset();
});

describe('POST /api/auth/login', () => {
  it('returns the explicit database role for presentation without inferring it from plan', async () => {
    currentSql = fakeSql([[
      { id: 'u1', email: 'admin@example.com', name: 'Admin', password_hash: 'hash', plan: 'free', role: 'admin' },
    ]]);
    verifyPasswordMock.mockResolvedValue(true);

    const res = await POST(makeRequest({ email: 'admin@example.com', password: 'password123' }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.user).toMatchObject({ email: 'admin@example.com', plan: 'free', role: 'admin' });
  });

  it('returns 401 when the email is unknown', async () => {
    currentSql = fakeSql([[]]);

    const res = await POST(makeRequest({ email: 'missing@example.com', password: 'password123' }));
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json).toEqual({ error: 'Invalid email or password' });
    expect(verifyPasswordMock).not.toHaveBeenCalled();
  });

  it('returns 401 when the user has no password hash', async () => {
    currentSql = fakeSql([[{ id: 'u1', email: 'oauth@example.com', password_hash: null, plan: 'free' }]]);

    const res = await POST(makeRequest({ email: 'oauth@example.com', password: 'password123' }));
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json).toEqual({ error: 'Invalid email or password' });
    expect(verifyPasswordMock).not.toHaveBeenCalled();
  });

  it('returns 401 when the password does not match', async () => {
    currentSql = fakeSql([[{ id: 'u1', email: 'user@example.com', password_hash: 'hash', plan: 'free' }]]);
    verifyPasswordMock.mockResolvedValue(false);

    const res = await POST(makeRequest({ email: 'user@example.com', password: 'wrongpass' }));
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json).toEqual({ error: 'Invalid email or password' });
  });

  it('returns 503 when the auth database cannot be reached', async () => {
    currentSql = vi.fn(async () => {
      throw Object.assign(new Error('fetch failed'), { code: 'ENOTFOUND' });
    });

    const res = await POST(makeRequest({ email: 'user@example.com', password: 'password123' }));
    const json = await res.json();

    expect(res.status).toBe(503);
    expect(json).toEqual({
      error: 'Unable to reach authentication server. Check your connection and try again.',
    });
    expect(verifyPasswordMock).not.toHaveBeenCalled();
  });
});
