import { beforeEach, describe, expect, it, vi } from 'vitest';

const getAuthUserMock = vi.fn();
const dbMock = vi.fn();

vi.mock('next/headers', () => ({
  headers: async () => new Headers({ cookie: 'uncraft_sess=test' }),
}));
vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
  notFound: vi.fn(),
}));
vi.mock('../../../lib/auth.js', () => ({
  getAuthUser: (...args) => getAuthUserMock(...args),
}));
vi.mock('../../../lib/db.js', () => ({
  db: (...args) => dbMock(...args),
}));

const { default: CanvasBoardPage } = await import('./page.jsx');

function fakeSql() {
  const results = [
    [{ id: 'board-1', name: 'Test board' }],
    [{ id: 'node-1', board_id: 'board-1', kind: 'site' }],
    [],
  ];
  let index = 0;
  return () => Promise.resolve(results[index++] || []);
}

beforeEach(() => {
  getAuthUserMock.mockReset();
  dbMock.mockReset();
  getAuthUserMock.mockResolvedValue({
    id: 7,
    email: 'admin@example.com',
    name: 'Admin',
    plan: 'pro',
    role: 'admin',
  });
  dbMock.mockResolvedValue(fakeSql());
});

describe('Canvas board diagnostic navigation', () => {
  it('passes the authorized affected node to the canvas for selection and framing', async () => {
    const element = await CanvasBoardPage({
      params: Promise.resolve({ boardId: 'board-1' }),
      searchParams: Promise.resolve({ focusNode: 'node-1' }),
    });

    expect(element.props.initialFocusNodeId).toBe('node-1');
    expect(element.props.user.role).toBe('admin');
  });
});
