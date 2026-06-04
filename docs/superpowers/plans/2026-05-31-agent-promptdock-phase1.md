# Agent PromptDock — Phase 1 Implementation Plan (chat shell + agent engine + safe tools)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a conversational agent in PromptDock that uses Claude to create, connect, read, and query nodes on the user's board through 6 safe tools. End of Phase 1: user types "crie 3 nodes website e me mostra os outputs" and the agent does it end-to-end.

**Architecture:** Single-loop tool-use against Anthropic SDK. POST `/api/chat` returns SSE. Agent driver streams assistant tokens + tool calls; tools execute server-side against existing Uncraft APIs; results loop back into the LLM until it stops emitting calls. Persistence in three new Postgres tables (`chat_threads`, `chat_messages`, `agent_runs`). UI is a new `ChatPanel` that PromptDock expands into when there's history.

**Tech Stack:** Next.js 15 App Router (Node.js runtime), `@anthropic-ai/sdk` (already installed), `@neondatabase/serverless` (already installed) tagged-template SQL, React 18, Vitest for unit tests, React Testing Library + jsdom for component tests.

**Out of scope for Phase 1 (covered by Phase 2-5 plans, not yet written):**
- Destructive tools (deleteNode, runFlow, editSite, createImage)
- Tool confirm chip + pause/resume flow
- Soft-pause / hard-kill / retry budget / wall timeout (just use a hardcoded `maxIterations=10` cap)
- Image generation route + provider routing
- Smart Edit chat dock wire-up
- OpenAI / Gemini / Kimi LLM adapters (Phase 1 is Claude-only)
- Cost tracking

**Working directory:** `/Users/adilsonporto/Desktop/IA/Uncraft`. Branch: `feat/canvas`.

**Source-of-truth files:** Spec at `docs/superpowers/specs/2026-05-31-agent-promptdock-design.md`. Always cross-reference if a step's intent is unclear.

---

## Phase 0 — Test infrastructure setup

### Task 0.1: Install Vitest + RTL

**Files:**
- Modify: `packages/web-shell/package.json`
- Create: `packages/web-shell/vitest.config.js`
- Create: `packages/web-shell/vitest.setup.js`

- [ ] **Step 1: Add devDependencies**

Run in `/Users/adilsonporto/Desktop/IA/Uncraft/packages/web-shell`:

```bash
npm install --save-dev vitest @vitest/ui @testing-library/react @testing-library/jest-dom @testing-library/user-event jsdom
```

Expected: deps added to `devDependencies` in package.json.

- [ ] **Step 2: Create `vitest.config.js`**

```js
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.js'],
    globals: true,
    include: ['**/*.test.{js,jsx}'],
    exclude: ['node_modules', '.next'],
  },
  resolve: {
    alias: {
      '@': '/Users/adilsonporto/Desktop/IA/Uncraft/packages/web-shell',
    },
  },
});
```

Also install the React plugin:
```bash
npm install --save-dev @vitejs/plugin-react
```

- [ ] **Step 3: Create `vitest.setup.js`**

```js
import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

// Polyfill EventSource in jsdom (used by chat-client.js tests)
class MockEventSource {
  constructor(url) { this.url = url; this.listeners = {}; this.readyState = 0; }
  addEventListener(type, cb) { (this.listeners[type] ||= []).push(cb); }
  removeEventListener(type, cb) {
    if (!this.listeners[type]) return;
    this.listeners[type] = this.listeners[type].filter((x) => x !== cb);
  }
  dispatch(type, data) { (this.listeners[type] || []).forEach((cb) => cb({ data: JSON.stringify(data), type })); }
  close() { this.readyState = 2; }
}
globalThis.MockEventSource = MockEventSource;
```

- [ ] **Step 4: Add npm scripts**

In `packages/web-shell/package.json`, add to `"scripts"`:
```json
"test": "vitest run",
"test:watch": "vitest",
"test:ui": "vitest --ui"
```

- [ ] **Step 5: Verify Vitest runs (no tests yet)**

Run: `cd packages/web-shell && npm test`
Expected: `No test files found, exiting with code 1` — that's the "no tests" success signal.

- [ ] **Step 6: Commit**

```bash
git add packages/web-shell/package.json packages/web-shell/package-lock.json packages/web-shell/vitest.config.js packages/web-shell/vitest.setup.js
git commit -m "chore(web-shell): vitest + RTL + jsdom for agent feature tests"
```

---

## Phase 1 — DB schema + chat persistence layer

### Task 1.1: Add chat tables to schema.sql

**Files:**
- Modify: `packages/web-shell/schema.sql`

- [ ] **Step 1: Append to schema.sql**

Open `packages/web-shell/schema.sql` and append at the end (after last existing table):

```sql

-- ============================================================================
-- Chat agent (Phase 1 of agent-promptdock feature).
-- See docs/superpowers/specs/2026-05-31-agent-promptdock-design.md §9.
-- ============================================================================

CREATE TABLE IF NOT EXISTS chat_threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope VARCHAR(10) NOT NULL DEFAULT 'board' CHECK (scope IN ('board','asset')),
  asset_id UUID REFERENCES assets(id) ON DELETE CASCADE,
  title TEXT,
  status VARCHAR(10) NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  archived_at TIMESTAMPTZ,
  CHECK ((scope = 'board' AND asset_id IS NULL) OR (scope = 'asset' AND asset_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS chat_threads_one_active_per_board
  ON chat_threads(board_id) WHERE status = 'active' AND scope = 'board';
CREATE UNIQUE INDEX IF NOT EXISTS chat_threads_one_active_per_asset
  ON chat_threads(asset_id) WHERE status = 'active' AND scope = 'asset';

CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
  role VARCHAR(10) NOT NULL CHECK (role IN ('user','assistant','tool','system')),
  content TEXT,
  tool_calls JSONB,
  tool_call_id TEXT,
  model VARCHAR(60),
  agent_run_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS chat_messages_thread_ts ON chat_messages(thread_id, created_at);

CREATE TABLE IF NOT EXISTS agent_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL CHECK (status IN (
    'running','paused_confirm','paused_choice','paused_softlimit',
    'completed','failed','cancelled','hard_limited'
  )),
  iterations INT NOT NULL DEFAULT 0,
  tool_call_counts JSONB NOT NULL DEFAULT '{}'::jsonb,
  err TEXT,
  tokens_in INT,
  tokens_out INT,
  cost_cents INT,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS agent_runs_thread_status ON agent_runs(thread_id, status);
```

- [ ] **Step 2: Apply schema by triggering initDB**

Schema is idempotent (CREATE TABLE IF NOT EXISTS). Cold-start of the dev server applies it. Verify:

Restart dev server (`/Users/adilsonporto/Desktop/IA/Uncraft/packages/web-shell`):
```bash
# Kill current dev (background task bo1s8gaax in this session) then:
npm run dev
```

Expected: server boots, no SQL errors in logs (`Detected additional lockfiles` warning is fine).

- [ ] **Step 3: Verify tables exist via psql**

```bash
psql "$DATABASE_URL" -c "\d chat_threads" 2>&1 | head -20
psql "$DATABASE_URL" -c "\d chat_messages" 2>&1 | head -20
psql "$DATABASE_URL" -c "\d agent_runs" 2>&1 | head -20
```

Expected: each prints the table schema. If psql isn't available, the next task's API tests will verify functionally.

- [ ] **Step 4: Commit**

```bash
git add packages/web-shell/schema.sql
git commit -m "feat(db): chat_threads, chat_messages, agent_runs tables"
```

---

### Task 1.2: lib/chat-persistence.js — load + create thread, append message

**Files:**
- Create: `packages/web-shell/lib/chat-persistence.js`
- Create: `packages/web-shell/lib/chat-persistence.test.js`

- [ ] **Step 1: Write the failing test**

Create `packages/web-shell/lib/chat-persistence.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getOrCreateActiveThread,
  appendMessage,
  loadMessages,
  archiveActiveThread,
} from './chat-persistence.js';

// Mock the sql tagged template
vi.mock('./db.js', () => {
  const sqlCalls = [];
  const sql = vi.fn((strings, ...values) => {
    sqlCalls.push({ query: strings.join('?'), values });
    return Promise.resolve(sql._nextResult || []);
  });
  sql._nextResult = null;
  sql._reset = () => { sqlCalls.length = 0; sql._nextResult = null; };
  sql._calls = sqlCalls;
  return { sql, db: async () => sql };
});

const { sql } = await import('./db.js');

beforeEach(() => sql._reset());

describe('getOrCreateActiveThread', () => {
  it('returns existing active board-scope thread when one exists', async () => {
    sql._nextResult = [{ id: 'thread-1', board_id: 'b1', scope: 'board', status: 'active' }];
    const t = await getOrCreateActiveThread({ boardId: 'b1', userId: 42, scope: 'board' });
    expect(t.id).toBe('thread-1');
    expect(sql).toHaveBeenCalled();
  });

  it('creates a new thread when none exists', async () => {
    // First call: select returns empty. Second call: insert returns new.
    let n = 0;
    sql.mockImplementation(() => {
      n++;
      return Promise.resolve(n === 1 ? [] : [{ id: 'thread-new', board_id: 'b1', scope: 'board' }]);
    });
    const t = await getOrCreateActiveThread({ boardId: 'b1', userId: 42, scope: 'board' });
    expect(t.id).toBe('thread-new');
    expect(sql).toHaveBeenCalledTimes(2);
  });
});

describe('appendMessage', () => {
  it('inserts a user message with content', async () => {
    sql._nextResult = [{ id: 'msg-1', thread_id: 't1', role: 'user', content: 'hi' }];
    const m = await appendMessage({ threadId: 't1', role: 'user', content: 'hi' });
    expect(m.id).toBe('msg-1');
  });

  it('inserts an assistant message with tool_calls JSONB', async () => {
    sql._nextResult = [{ id: 'msg-2', thread_id: 't1', role: 'assistant', tool_calls: [{ name: 'createNode' }] }];
    const m = await appendMessage({
      threadId: 't1',
      role: 'assistant',
      content: 'doing it',
      toolCalls: [{ name: 'createNode' }],
      model: 'claude-sonnet-4-6',
      agentRunId: 'run-1',
    });
    expect(m.id).toBe('msg-2');
  });
});

describe('loadMessages', () => {
  it('returns messages ordered by created_at ascending', async () => {
    sql._nextResult = [
      { id: 'm1', role: 'user', created_at: '2026-01-01T00:00:00Z' },
      { id: 'm2', role: 'assistant', created_at: '2026-01-01T00:00:01Z' },
    ];
    const msgs = await loadMessages({ threadId: 't1', limit: 50 });
    expect(msgs).toHaveLength(2);
    expect(msgs[0].id).toBe('m1');
  });
});

describe('archiveActiveThread', () => {
  it('marks active thread of given board+scope as archived', async () => {
    sql._nextResult = [{ id: 't1', status: 'archived' }];
    const r = await archiveActiveThread({ boardId: 'b1', scope: 'board' });
    expect(r?.status).toBe('archived');
  });
});
```

- [ ] **Step 2: Run test to verify failure**

```bash
cd packages/web-shell && npm test -- lib/chat-persistence.test.js
```

Expected: FAIL with `Cannot find module './chat-persistence.js'`.

- [ ] **Step 3: Implement `lib/chat-persistence.js`**

Create:

```js
/**
 * chat-persistence.js — DB layer for chat threads + messages.
 *
 * One active board-scope thread per board (enforced by unique index).
 * One active asset-scope thread per asset (same).
 * Messages are append-only — never edit or delete (chat history is a log).
 */
import { sql } from './db.js';

/**
 * Find the active thread for (boardId, scope[, assetId]) or create one.
 * scope='board' → asset must be null.
 * scope='asset' → assetId required.
 */
export async function getOrCreateActiveThread({ boardId, userId, scope = 'board', assetId = null }) {
  if (scope === 'asset' && !assetId) throw new Error('assetId required when scope=asset');
  const existing = scope === 'board'
    ? await sql`
        SELECT * FROM chat_threads
        WHERE board_id = ${boardId} AND scope = 'board' AND status = 'active'
        LIMIT 1
      `
    : await sql`
        SELECT * FROM chat_threads
        WHERE asset_id = ${assetId} AND scope = 'asset' AND status = 'active'
        LIMIT 1
      `;
  if (existing.length) return existing[0];

  const [created] = await sql`
    INSERT INTO chat_threads (board_id, user_id, scope, asset_id, status)
    VALUES (${boardId}, ${userId}, ${scope}, ${assetId}, 'active')
    RETURNING *
  `;
  return created;
}

/**
 * Append a message to a thread. Returns the created row.
 * - role='user'      → content required
 * - role='assistant' → content + optional toolCalls + model + agentRunId
 * - role='tool'      → content (= tool result) + toolCallId required
 * - role='system'    → reserved (rarely used; system prompt is sent as message, not persisted)
 */
export async function appendMessage({
  threadId, role, content = null, toolCalls = null, toolCallId = null, model = null, agentRunId = null,
}) {
  if (!['user', 'assistant', 'tool', 'system'].includes(role)) throw new Error(`bad role: ${role}`);
  if (role === 'user' && !content) throw new Error('user role requires content');
  if (role === 'tool' && !toolCallId) throw new Error('tool role requires toolCallId');

  const [created] = await sql`
    INSERT INTO chat_messages (thread_id, role, content, tool_calls, tool_call_id, model, agent_run_id)
    VALUES (
      ${threadId}, ${role}, ${content},
      ${toolCalls ? JSON.stringify(toolCalls) : null}::jsonb,
      ${toolCallId}, ${model}, ${agentRunId}
    )
    RETURNING *
  `;
  return created;
}

/**
 * Load the last N messages for a thread, oldest first.
 * Frontend reverses for display if it wants newest-at-bottom semantics.
 */
export async function loadMessages({ threadId, limit = 50, before = null }) {
  const rows = before
    ? await sql`
        SELECT * FROM chat_messages
        WHERE thread_id = ${threadId} AND created_at < (SELECT created_at FROM chat_messages WHERE id = ${before})
        ORDER BY created_at DESC LIMIT ${limit}
      `
    : await sql`
        SELECT * FROM chat_messages
        WHERE thread_id = ${threadId}
        ORDER BY created_at DESC LIMIT ${limit}
      `;
  return rows.reverse();
}

/**
 * Archive the current active thread for (boardId, scope[, assetId]).
 * Returns the archived thread row or null if none was active.
 */
export async function archiveActiveThread({ boardId, scope = 'board', assetId = null }) {
  if (scope === 'asset' && !assetId) throw new Error('assetId required when scope=asset');
  const rows = scope === 'board'
    ? await sql`
        UPDATE chat_threads SET status = 'archived', archived_at = NOW()
        WHERE board_id = ${boardId} AND scope = 'board' AND status = 'active'
        RETURNING *
      `
    : await sql`
        UPDATE chat_threads SET status = 'archived', archived_at = NOW()
        WHERE asset_id = ${assetId} AND scope = 'asset' AND status = 'active'
        RETURNING *
      `;
  return rows[0] || null;
}
```

- [ ] **Step 4: Run test to verify pass**

```bash
cd packages/web-shell && npm test -- lib/chat-persistence.test.js
```

Expected: all tests PASS (4-6 tests, depending on exact split).

- [ ] **Step 5: Commit**

```bash
git add packages/web-shell/lib/chat-persistence.js packages/web-shell/lib/chat-persistence.test.js
git commit -m "feat(chat): persistence layer for threads + messages"
```

---

## Phase 2 — Chat client (frontend SSE wrapper, mocked end-to-end)

### Task 2.1: lib/chat-client.js — EventSource wrapper

**Files:**
- Create: `packages/web-shell/lib/chat-client.js`
- Create: `packages/web-shell/lib/chat-client.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createChatStream } from './chat-client.js';

let lastEs;
beforeEach(() => {
  lastEs = null;
  globalThis.EventSource = class {
    constructor(url) { this.url = url; this.listeners = {}; lastEs = this; }
    addEventListener(type, cb) { (this.listeners[type] ||= []).push(cb); }
    removeEventListener(type, cb) { this.listeners[type] = (this.listeners[type] || []).filter((x) => x !== cb); }
    dispatch(type, data) { (this.listeners[type] || []).forEach((cb) => cb({ data: typeof data === 'string' ? data : JSON.stringify(data) })); }
    close() { this.readyState = 2; }
  };
});

describe('createChatStream', () => {
  it('subscribes to typed events and parses JSON payloads', () => {
    const stream = createChatStream({ url: '/api/chat?runId=abc' });
    const onToken = vi.fn();
    stream.on('assistant_token', onToken);
    lastEs.dispatch('assistant_token', { delta: 'hello' });
    expect(onToken).toHaveBeenCalledWith({ delta: 'hello' });
  });

  it('handles malformed JSON gracefully', () => {
    const stream = createChatStream({ url: '/api/chat?runId=abc' });
    const onErr = vi.fn();
    stream.on('error', onErr);
    lastEs.dispatch('assistant_token', 'not json');
    expect(onErr).toHaveBeenCalled();
  });

  it('close() shuts down the EventSource', () => {
    const stream = createChatStream({ url: '/api/chat?runId=abc' });
    stream.close();
    expect(lastEs.readyState).toBe(2);
  });
});
```

- [ ] **Step 2: Run test (FAIL — module missing)**

```bash
npm test -- lib/chat-client.test.js
```

Expected: FAIL.

- [ ] **Step 3: Implement chat-client.js**

```js
/**
 * chat-client.js — typed event-source wrapper for the chat SSE endpoint.
 *
 * Usage:
 *   const stream = createChatStream({ url: '/api/chat?runId=...' });
 *   stream.on('assistant_token', (p) => append(p.delta));
 *   stream.on('tool_call', (p) => renderChip(p));
 *   stream.on('run_status', (p) => { if (p.status === 'completed') stream.close(); });
 *
 * Event payloads are JSON-parsed automatically. Parse errors emit on 'error'.
 */
const EVENT_TYPES = [
  'thread_id', 'run_id',
  'assistant_token', 'tool_call', 'tool_status',
  'needs_confirm', 'needs_choice', 'needs_softlimit_continue',
  'run_status',
];

export function createChatStream({ url }) {
  const es = new EventSource(url, { withCredentials: true });
  const handlers = new Map(); // type → Set<callback>
  const wrappers = new Map(); // type → DOM listener fn we registered

  function on(type, cb) {
    if (!handlers.has(type)) handlers.set(type, new Set());
    handlers.get(type).add(cb);
    if (!wrappers.has(type)) {
      const w = (ev) => {
        let payload;
        try { payload = JSON.parse(ev.data); }
        catch (err) {
          handlers.get('error')?.forEach((h) => h({ err, raw: ev.data }));
          return;
        }
        handlers.get(type)?.forEach((h) => h(payload));
      };
      wrappers.set(type, w);
      es.addEventListener(type, w);
    }
  }

  function off(type, cb) {
    handlers.get(type)?.delete(cb);
  }

  function close() { es.close(); }

  return { on, off, close, knownEvents: EVENT_TYPES };
}
```

- [ ] **Step 4: Run test (PASS)**

```bash
npm test -- lib/chat-client.test.js
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/web-shell/lib/chat-client.js packages/web-shell/lib/chat-client.test.js
git commit -m "feat(chat): client-side SSE wrapper with typed events"
```

---

### Task 2.2: ChatBubble component

**Files:**
- Create: `packages/web-shell/components/chat/ChatBubble.jsx`
- Create: `packages/web-shell/components/chat/ChatBubble.test.jsx`
- Create: `packages/web-shell/components/chat/chat.css` (Phase 1 CSS goes here)

- [ ] **Step 1: Write failing test**

```jsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ChatBubble from './ChatBubble.jsx';

describe('ChatBubble', () => {
  it('renders user message right-aligned', () => {
    render(<ChatBubble role="user" content="hello" />);
    const el = screen.getByText('hello');
    expect(el.closest('.chat-bubble')).toHaveClass('chat-bubble-user');
  });

  it('renders assistant message left-aligned', () => {
    render(<ChatBubble role="assistant" content="hi" />);
    expect(screen.getByText('hi').closest('.chat-bubble')).toHaveClass('chat-bubble-assistant');
  });

  it('renders children alongside content (used for inline tool chips)', () => {
    render(
      <ChatBubble role="assistant" content="working...">
        <div data-testid="chip">[chip]</div>
      </ChatBubble>
    );
    expect(screen.getByText('working...')).toBeInTheDocument();
    expect(screen.getByTestId('chip')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test (FAIL)**

```bash
npm test -- components/chat/ChatBubble.test.jsx
```

Expected: FAIL — component missing.

- [ ] **Step 3: Implement ChatBubble.jsx**

```jsx
'use client';

export default function ChatBubble({ role, content, children }) {
  const cls = role === 'user' ? 'chat-bubble chat-bubble-user' : 'chat-bubble chat-bubble-assistant';
  return (
    <div className={cls}>
      {content && <div className="chat-bubble-content">{content}</div>}
      {children && <div className="chat-bubble-children">{children}</div>}
    </div>
  );
}
```

- [ ] **Step 4: Implement minimal CSS (chat.css)**

```css
/* components/chat/chat.css — minimal Phase 1 styles. Visual polish in Phase 5+. */
.chat-bubble {
  max-width: 80%;
  margin: 6px 0;
  padding: 8px 12px;
  border-radius: 12px;
  font-family: var(--popup-font-sans, system-ui);
  font-size: 13px;
  line-height: 1.45;
  word-wrap: break-word;
}
.chat-bubble-user {
  align-self: flex-end;
  background: rgba(255, 255, 255, 0.08);
  color: var(--text-primary, #f5f5f5);
  margin-left: auto;
}
.chat-bubble-assistant {
  align-self: flex-start;
  background: transparent;
  color: var(--text-primary, #f5f5f5);
}
.chat-bubble-content { white-space: pre-wrap; }
.chat-bubble-children { margin-top: 6px; display: flex; flex-direction: column; gap: 4px; }
```

- [ ] **Step 5: Run test (PASS)**

```bash
npm test -- components/chat/ChatBubble.test.jsx
```

Expected: 3 tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/web-shell/components/chat/
git commit -m "feat(chat): ChatBubble component + base CSS"
```

---

### Task 2.3: ToolChip component (skeleton — only `done` and `running` states for Phase 1)

**Files:**
- Create: `packages/web-shell/components/chat/ToolChip.jsx`
- Create: `packages/web-shell/components/chat/ToolChip.test.jsx`
- Modify: `packages/web-shell/components/chat/chat.css`

- [ ] **Step 1: Write failing test**

```jsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ToolChip from './ToolChip.jsx';

describe('ToolChip', () => {
  it('renders pending state with spinner', () => {
    render(<ToolChip toolName="createNode" status="pending" args={{ kind: 'site' }} />);
    expect(screen.getByText('createNode')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument(); // spinner has role=status
  });

  it('renders done state with check and short result', () => {
    render(<ToolChip toolName="createNode" status="done" args={{}} result={{ id: 'node-1' }} />);
    expect(screen.getByText(/createNode/)).toBeInTheDocument();
    expect(screen.getByText(/✓/)).toBeInTheDocument();
    expect(screen.getByText(/node-1/)).toBeInTheDocument();
  });

  it('renders error state with ✕ and message', () => {
    render(<ToolChip toolName="createNode" status="error" args={{}} error="invalid kind" />);
    expect(screen.getByText(/✕/)).toBeInTheDocument();
    expect(screen.getByText(/invalid kind/)).toBeInTheDocument();
  });

  it('omits confirm UI for safe tools (Phase 1 has no destructive)', () => {
    render(<ToolChip toolName="createNode" status="pending" args={{}} />);
    expect(screen.queryByRole('button', { name: /confirm/i })).toBeNull();
  });
});
```

- [ ] **Step 2: Run test (FAIL)**

```bash
npm test -- components/chat/ToolChip.test.jsx
```

Expected: FAIL.

- [ ] **Step 3: Implement ToolChip.jsx**

```jsx
'use client';

// Phase 1: only handles `pending | running | done | error` states for safe tools.
// `awaiting_confirm`, `awaiting_choice`, `skipped` will be added in Phase 2.
export default function ToolChip({ toolName, status, args, result, error }) {
  const isWorking = status === 'pending' || status === 'running';
  const icon = status === 'done' ? '✓' : status === 'error' ? '✕' : null;
  const cls = `tool-chip tool-chip-${status}`;

  // Render a short, human-friendly summary of result if present.
  const summary = result && summarizeResult(toolName, result);

  return (
    <div className={cls} data-tool={toolName} data-status={status}>
      <span className="tool-chip-icon">
        {icon || <span role="status" className="tool-chip-spinner" aria-label="working" />}
      </span>
      <span className="tool-chip-name">{toolName}</span>
      {summary && <span className="tool-chip-summary"> — {summary}</span>}
      {error && <span className="tool-chip-error"> — {error}</span>}
    </div>
  );
}

function summarizeResult(toolName, result) {
  if (!result) return null;
  switch (toolName) {
    case 'createNode': return result.id ? `created ${result.id.slice(0, 8)}` : 'created';
    case 'addEdge':    return result.id ? `edge ${result.id.slice(0, 8)}` : 'connected';
    case 'updateNode': return 'updated';
    case 'queryNodes': return `${Array.isArray(result) ? result.length : '?'} nodes`;
    case 'listAssets': return `${Array.isArray(result) ? result.length : '?'} assets`;
    case 'getNodeOutput': return result.truncated ? 'output (truncated)' : 'output';
    default: return null;
  }
}
```

- [ ] **Step 4: Append CSS for ToolChip**

Append to `packages/web-shell/components/chat/chat.css`:

```css
.tool-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 999px;
  font-family: var(--popup-font-sans, system-ui);
  font-size: 11px;
  border: 1px solid transparent;
}
.tool-chip-pending, .tool-chip-running {
  background: rgba(56, 189, 248, 0.08);
  border-color: rgba(56, 189, 248, 0.18);
  color: rgba(186, 230, 253, 0.95);
}
.tool-chip-done {
  background: rgba(74, 222, 128, 0.08);
  border-color: rgba(74, 222, 128, 0.20);
  color: rgba(187, 247, 208, 0.95);
}
.tool-chip-error {
  background: rgba(248, 113, 113, 0.10);
  border-color: rgba(248, 113, 113, 0.20);
  color: rgba(252, 165, 165, 0.95);
}
.tool-chip-name { font-weight: 500; }
.tool-chip-summary { opacity: 0.75; }
.tool-chip-icon { display: inline-flex; }
.tool-chip-spinner {
  width: 10px; height: 10px;
  border-radius: 50%;
  border: 1.5px solid rgba(255, 255, 255, 0.2);
  border-top-color: rgba(56, 189, 248, 0.85);
  animation: tool-chip-spin 0.8s linear infinite;
}
@keyframes tool-chip-spin { to { transform: rotate(360deg); } }
```

- [ ] **Step 5: Run test (PASS)**

```bash
npm test -- components/chat/ToolChip.test.jsx
```

Expected: 4 tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/web-shell/components/chat/
git commit -m "feat(chat): ToolChip — pending/running/done/error states"
```

---

### Task 2.4: ChatPanel component (assembles bubbles + chips)

**Files:**
- Create: `packages/web-shell/components/chat/ChatPanel.jsx`
- Create: `packages/web-shell/components/chat/ChatPanel.test.jsx`
- Modify: `packages/web-shell/components/chat/chat.css`

- [ ] **Step 1: Write failing test**

```jsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ChatPanel from './ChatPanel.jsx';

const sampleMessages = [
  { id: 'm1', role: 'user', content: 'olá' },
  { id: 'm2', role: 'assistant', content: 'oi', tool_calls: null },
  { id: 'm3', role: 'assistant', content: '', tool_calls: [
    { id: 'tc1', name: 'createNode', status: 'done', args: {}, result: { id: 'node-aaa' } },
  ] },
];

describe('ChatPanel', () => {
  it('renders user and assistant bubbles in order', () => {
    render(<ChatPanel messages={sampleMessages} activeToolCalls={[]} />);
    const bubbles = document.querySelectorAll('.chat-bubble');
    expect(bubbles).toHaveLength(3);
    expect(bubbles[0]).toHaveClass('chat-bubble-user');
    expect(bubbles[1]).toHaveClass('chat-bubble-assistant');
  });

  it('renders tool chips inside the assistant bubble that has tool_calls', () => {
    render(<ChatPanel messages={sampleMessages} activeToolCalls={[]} />);
    expect(screen.getByText(/createNode/)).toBeInTheDocument();
    expect(screen.getByText(/node-aaa/)).toBeInTheDocument();
  });

  it('renders active (in-flight) tool calls in the most recent assistant bubble', () => {
    render(<ChatPanel
      messages={sampleMessages.slice(0, 2)}
      activeToolCalls={[{ id: 'tc-live', name: 'queryNodes', status: 'running', args: {} }]}
    />);
    expect(screen.getByText(/queryNodes/)).toBeInTheDocument();
  });

  it('shows empty state when no messages', () => {
    render(<ChatPanel messages={[]} activeToolCalls={[]} />);
    expect(screen.getByText(/start a conversation/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test (FAIL)**

```bash
npm test -- components/chat/ChatPanel.test.jsx
```

Expected: FAIL.

- [ ] **Step 3: Implement ChatPanel.jsx**

```jsx
'use client';

import ChatBubble from './ChatBubble.jsx';
import ToolChip from './ToolChip.jsx';
import './chat.css';

export default function ChatPanel({ messages, activeToolCalls }) {
  if (!messages.length && !activeToolCalls.length) {
    return (
      <div className="chat-panel chat-panel-empty">
        <p className="chat-empty-hint">Start a conversation with the agent below.</p>
      </div>
    );
  }

  // Find the last assistant message (we attach live activeToolCalls under it).
  const lastAssistantIdx = (() => {
    for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === 'assistant') return i;
    return -1;
  })();

  return (
    <div className="chat-panel">
      {messages.map((m, idx) => (
        <ChatBubble key={m.id} role={m.role} content={m.content}>
          {m.tool_calls?.map((tc) => (
            <ToolChip
              key={tc.id}
              toolName={tc.name}
              status={tc.status || 'done'}
              args={tc.args}
              result={tc.result}
              error={tc.error}
            />
          ))}
          {idx === lastAssistantIdx && activeToolCalls.map((tc) => (
            <ToolChip
              key={tc.id}
              toolName={tc.name}
              status={tc.status || 'running'}
              args={tc.args}
              result={tc.result}
              error={tc.error}
            />
          ))}
        </ChatBubble>
      ))}
      {/* If there's no assistant message yet but tools are running, render a fresh bubble */}
      {lastAssistantIdx === -1 && activeToolCalls.length > 0 && (
        <ChatBubble role="assistant" content="">
          {activeToolCalls.map((tc) => (
            <ToolChip key={tc.id} toolName={tc.name} status={tc.status || 'running'} args={tc.args} />
          ))}
        </ChatBubble>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Append CSS**

Append to `packages/web-shell/components/chat/chat.css`:

```css
.chat-panel {
  display: flex;
  flex-direction: column;
  padding: 12px 16px;
  max-height: 60vh;
  overflow-y: auto;
  scroll-behavior: smooth;
  font-family: var(--popup-font-sans, system-ui);
}
.chat-panel-empty {
  padding: 24px 16px;
  text-align: center;
}
.chat-empty-hint {
  color: var(--text-muted, rgba(245, 245, 245, 0.5));
  font-family: var(--popup-font-serif, Georgia, serif);
  font-style: italic;
  font-size: 13px;
}
```

- [ ] **Step 5: Run test (PASS)**

```bash
npm test -- components/chat/ChatPanel.test.jsx
```

Expected: 4 tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/web-shell/components/chat/
git commit -m "feat(chat): ChatPanel assembling bubbles + live tool chips"
```

---

## Phase 3 — GET /api/chat (thread load) + agent foundation

### Task 3.1: GET `/api/chat` route — return thread + messages

**Files:**
- Create: `packages/web-shell/app/api/chat/route.js`
- Create: `packages/web-shell/app/api/chat/route.test.js` (integration test with mocked auth + DB)

- [ ] **Step 1: Write failing test**

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../lib/auth.js', () => ({
  requireUser: vi.fn(async () => ({ user: { id: 42 } })),
}));
vi.mock('../../../lib/chat-persistence.js', () => ({
  getOrCreateActiveThread: vi.fn(async () => ({ id: 'thread-1', board_id: 'b1', scope: 'board' })),
  loadMessages: vi.fn(async () => [
    { id: 'm1', role: 'user', content: 'hi', created_at: '2026-01-01T00:00:00Z' },
  ]),
}));

const { GET } = await import('./route.js');

describe('GET /api/chat', () => {
  it('returns 400 when boardId missing', async () => {
    const req = new Request('http://test/api/chat');
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it('returns thread + messages when boardId present', async () => {
    const req = new Request('http://test/api/chat?boardId=b1');
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.thread.id).toBe('thread-1');
    expect(body.messages).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run (FAIL)**

```bash
npm test -- app/api/chat/route.test.js
```

Expected: FAIL.

- [ ] **Step 3: Implement `app/api/chat/route.js` (GET only — POST comes in Phase 4)**

```js
import { NextResponse } from 'next/server';
import { requireUser } from '../../../lib/auth.js';
import { getOrCreateActiveThread, loadMessages } from '../../../lib/chat-persistence.js';

export const runtime = 'nodejs';

export async function GET(request) {
  const { user, error } = await requireUser(request);
  if (error) return error;

  const url = new URL(request.url);
  const boardId = url.searchParams.get('boardId');
  const scope = url.searchParams.get('scope') || 'board';
  const assetId = url.searchParams.get('assetId');
  const before = url.searchParams.get('before');
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 200);

  if (!boardId) return NextResponse.json({ error: 'boardId required' }, { status: 400 });
  if (scope === 'asset' && !assetId) return NextResponse.json({ error: 'assetId required for scope=asset' }, { status: 400 });

  try {
    const thread = await getOrCreateActiveThread({ boardId, userId: user.id, scope, assetId });
    const messages = await loadMessages({ threadId: thread.id, limit, before });
    return NextResponse.json({ thread, messages });
  } catch (e) {
    console.error('[GET /api/chat] error', e);
    return NextResponse.json({ error: e.message || 'failed' }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run (PASS)**

```bash
npm test -- app/api/chat/route.test.js
```

Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/web-shell/app/api/chat/route.js packages/web-shell/app/api/chat/route.test.js
git commit -m "feat(api): GET /api/chat — thread + messages"
```

---

### Task 3.2: lib/agent/registry.js — tool registry skeleton (no tools yet)

**Files:**
- Create: `packages/web-shell/lib/agent/registry.js`
- Create: `packages/web-shell/lib/agent/registry.test.js`

- [ ] **Step 1: Write failing test**

```js
import { describe, it, expect } from 'vitest';
import { Registry } from './registry.js';

describe('Registry', () => {
  it('registers a tool and returns it by name', () => {
    const r = new Registry();
    const tool = {
      name: 'foo',
      description: 'demo',
      classification: 'safe',
      inputSchema: { type: 'object', properties: {} },
      async execute() { return { ok: true }; },
    };
    r.register(tool);
    expect(r.get('foo')).toBe(tool);
  });

  it('throws on duplicate name', () => {
    const r = new Registry();
    r.register({ name: 'x', classification: 'safe', execute: async () => ({}) });
    expect(() => r.register({ name: 'x', classification: 'safe', execute: async () => ({}) })).toThrow();
  });

  it('throws on invalid classification', () => {
    const r = new Registry();
    expect(() => r.register({ name: 'y', classification: 'wat', execute: async () => ({}) })).toThrow();
  });

  it('toAnthropicSpec() emits the Anthropic tools[] array shape', () => {
    const r = new Registry();
    r.register({
      name: 'foo',
      description: 'demo',
      classification: 'safe',
      inputSchema: { type: 'object', properties: { x: { type: 'string' } }, required: ['x'] },
      execute: async () => ({}),
    });
    const spec = r.toAnthropicSpec();
    expect(spec).toEqual([{
      name: 'foo',
      description: 'demo',
      input_schema: { type: 'object', properties: { x: { type: 'string' } }, required: ['x'] },
    }]);
  });

  it('toAnthropicSpec() respects allowlist', () => {
    const r = new Registry();
    r.register({ name: 'foo', description: 'd', classification: 'safe', inputSchema: { type: 'object' }, execute: async () => ({}) });
    r.register({ name: 'bar', description: 'd', classification: 'safe', inputSchema: { type: 'object' }, execute: async () => ({}) });
    const spec = r.toAnthropicSpec(['foo']);
    expect(spec).toHaveLength(1);
    expect(spec[0].name).toBe('foo');
  });
});
```

- [ ] **Step 2: Run (FAIL)**

```bash
npm test -- lib/agent/registry.test.js
```

Expected: FAIL.

- [ ] **Step 3: Implement registry.js**

```js
/**
 * Tool registry. A tool is:
 *   {
 *     name: string                      // LLM-visible identifier
 *     description: string               // shown to LLM in tool spec
 *     classification: 'safe'|'destructive'|'needs_choice'
 *     inputSchema: JSON Schema          // Anthropic + OpenAI + Gemini all accept this
 *     execute: async (args, ctx) => { ... }   // server-side runner
 *   }
 *
 * The driver instantiates one Registry per board+user request and registers
 * the tools from the canonical exports in lib/agent/tools/index.js.
 */
const VALID_CLASS = new Set(['safe', 'destructive', 'needs_choice']);

export class Registry {
  constructor() {
    this._tools = new Map();
  }

  register(tool) {
    if (!tool?.name) throw new Error('tool.name required');
    if (this._tools.has(tool.name)) throw new Error(`duplicate tool: ${tool.name}`);
    if (!VALID_CLASS.has(tool.classification)) {
      throw new Error(`invalid classification: ${tool.classification}`);
    }
    if (typeof tool.execute !== 'function') throw new Error('tool.execute required');
    this._tools.set(tool.name, tool);
  }

  get(name) { return this._tools.get(name); }
  all() { return Array.from(this._tools.values()); }

  /**
   * Emit the Anthropic tool spec list (POST /v1/messages tools field).
   * `allowlist` (optional array of names) filters which tools are exposed
   * to the LLM for this run — used by Smart Edit chat to scope down.
   */
  toAnthropicSpec(allowlist = null) {
    return this.all()
      .filter((t) => !allowlist || allowlist.includes(t.name))
      .map((t) => ({
        name: t.name,
        description: t.description || '',
        input_schema: t.inputSchema || { type: 'object', properties: {} },
      }));
  }
}
```

- [ ] **Step 4: Run (PASS)**

```bash
npm test -- lib/agent/registry.test.js
```

Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/web-shell/lib/agent/registry.js packages/web-shell/lib/agent/registry.test.js
git commit -m "feat(agent): tool registry skeleton + Anthropic spec emitter"
```

---

### Task 3.3: lib/agent/prompts.js — system prompts

**Files:**
- Create: `packages/web-shell/lib/agent/prompts.js`

- [ ] **Step 1: Implement (no test — pure string export)**

```js
/**
 * System prompts for each agent persona.
 * Tune these via real conversation traces (slice 2+); Phase 1 is first draft.
 */

export const BOARD_AGENT = `You are Uncraft's canvas agent. The user is working in a visual node graph composed of websites (snapshots of real URLs), prompts, design.md files, and assets. You can read and modify this graph through tools.

Be brief. Show your work via tool calls — don't narrate every step in prose. When the user is ambiguous, ask ONE clarifying question before taking action that can't be undone (delete, run a flow, edit a site, generate an image).

Use ${'\\`'}queryNodes${'\\`'} to see what's already on the board before creating new things. Use ${'\\`'}getNodeOutput${'\\`'} to read a snapshot's actual content when you need to make a decision based on it.

When you've completed the user's request — or have no more tool calls to make — respond with a short summary of what changed.`;

export const EDIT_IMAGE_SYSTEM = `You are editing a single image asset. Your tools are limited: you can only generate a new image and read other node outputs. Do NOT try to create or modify graph nodes from this conversation — that's not in scope here.

When the user describes a change to the image, pass their plain-language instruction into ${'\\`'}createImage${'\\`'}'s prompt argument. Preserve the original aspect ratio unless they specifically ask otherwise.`;

export const EDIT_SITE_SYSTEM = `Internal prompt used by the editSite tool's wrapper. Receives current snapshot HTML + the user's plain-language instruction. Produce the modified HTML in full, preserving structure, classes, and unaffected text. Return ONLY the HTML, no prose, no markdown fences.`;
```

- [ ] **Step 2: Commit**

```bash
git add packages/web-shell/lib/agent/prompts.js
git commit -m "feat(agent): system prompts for BOARD_AGENT / EDIT_IMAGE / EDIT_SITE"
```

---

### Task 3.4: lib/agent/llm-anthropic.js — Anthropic adapter (streaming + tool-use)

**Files:**
- Create: `packages/web-shell/lib/agent/llm-anthropic.js`
- Create: `packages/web-shell/lib/agent/llm-anthropic.test.js`

- [ ] **Step 1: Write failing test (with SDK mocked)**

```js
import { describe, it, expect, vi } from 'vitest';

vi.mock('@anthropic-ai/sdk', () => {
  class MockClient {
    constructor() {
      this.messages = {
        stream: vi.fn(() => mockStream),
      };
    }
  }
  const mockStream = {
    async *[Symbol.asyncIterator]() {
      yield { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } };
      yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hi' } };
      yield { type: 'content_block_stop', index: 0 };
      yield {
        type: 'content_block_start',
        index: 1,
        content_block: { type: 'tool_use', id: 'toolu_1', name: 'queryNodes', input: {} },
      };
      yield { type: 'content_block_stop', index: 1 };
      yield { type: 'message_stop', usage: { input_tokens: 10, output_tokens: 5 } };
    },
    finalMessage: async () => ({
      content: [
        { type: 'text', text: 'hi' },
        { type: 'tool_use', id: 'toolu_1', name: 'queryNodes', input: {} },
      ],
      usage: { input_tokens: 10, output_tokens: 5 },
      stop_reason: 'tool_use',
    }),
  };
  return { default: MockClient };
});

const { callAnthropic } = await import('./llm-anthropic.js');

describe('callAnthropic', () => {
  it('streams text deltas and emits tool_use events', async () => {
    const events = [];
    const final = await callAnthropic({
      model: 'claude-sonnet-4-6',
      system: 'sys',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [{ name: 'queryNodes', description: 'd', input_schema: { type: 'object' } }],
      apiKey: 'fake',
      onEvent: (ev) => events.push(ev),
    });

    expect(events.some((e) => e.type === 'text_delta' && e.text === 'hi')).toBe(true);
    expect(events.some((e) => e.type === 'tool_use' && e.name === 'queryNodes' && e.id === 'toolu_1')).toBe(true);
    expect(final.stop_reason).toBe('tool_use');
    expect(final.usage.input_tokens).toBe(10);
  });
});
```

- [ ] **Step 2: Run (FAIL)**

```bash
npm test -- lib/agent/llm-anthropic.test.js
```

Expected: FAIL.

- [ ] **Step 3: Implement llm-anthropic.js**

```js
/**
 * Anthropic adapter. Wraps the SDK's streaming + tool-use API into the
 * normalized event shape the driver consumes:
 *   { type: 'text_delta', text }
 *   { type: 'tool_use',  id, name, input }
 *   { type: 'message_complete', stop_reason, usage }
 */
import Anthropic from '@anthropic-ai/sdk';

const MAX_TOKENS = 8000;

/**
 * @param {object} opts
 * @param {string} opts.model        — provider model id (already resolved via MODEL_ALIAS upstream)
 * @param {string} opts.system       — system prompt
 * @param {Array}  opts.messages     — Anthropic-format messages
 * @param {Array}  opts.tools        — Anthropic tools[] spec
 * @param {string} opts.apiKey       — Anthropic API key
 * @param {(ev) => void} opts.onEvent
 * @returns {Promise<{content, stop_reason, usage}>}
 */
export async function callAnthropic({ model, system, messages, tools, apiKey, onEvent }) {
  const client = new Anthropic({ apiKey });
  const stream = client.messages.stream({
    model,
    max_tokens: MAX_TOKENS,
    system,
    messages,
    tools,
  });

  // Accumulator for tool_use input (the SDK emits input deltas as partial JSON strings)
  const toolInputBuf = new Map(); // index → string

  for await (const ev of stream) {
    switch (ev.type) {
      case 'content_block_start':
        if (ev.content_block?.type === 'text') {
          // text block starts — nothing to emit yet
        } else if (ev.content_block?.type === 'tool_use') {
          toolInputBuf.set(ev.index, '');
        }
        break;
      case 'content_block_delta':
        if (ev.delta?.type === 'text_delta') {
          onEvent({ type: 'text_delta', text: ev.delta.text });
        } else if (ev.delta?.type === 'input_json_delta') {
          const buf = toolInputBuf.get(ev.index) || '';
          toolInputBuf.set(ev.index, buf + ev.delta.partial_json);
        }
        break;
      case 'content_block_stop': {
        // If this was a tool_use block, emit the assembled tool_use event.
        // We need the final block info from finalMessage() to get id/name.
        // For now, we rely on finalMessage() below for the consolidated view.
        break;
      }
      case 'message_stop':
        // usage attached
        break;
    }
  }

  const final = await stream.finalMessage();

  // Emit one tool_use event per tool_use content block (driver matches by id).
  for (const block of final.content || []) {
    if (block.type === 'tool_use') {
      onEvent({ type: 'tool_use', id: block.id, name: block.name, input: block.input });
    }
  }
  onEvent({ type: 'message_complete', stop_reason: final.stop_reason, usage: final.usage });

  return final;
}
```

- [ ] **Step 4: Run (PASS)**

```bash
npm test -- lib/agent/llm-anthropic.test.js
```

Expected: 1 test passes.

- [ ] **Step 5: Commit**

```bash
git add packages/web-shell/lib/agent/llm-anthropic.js packages/web-shell/lib/agent/llm-anthropic.test.js
git commit -m "feat(agent): Anthropic streaming + tool-use adapter"
```

---

### Task 3.5: lib/agent/driver.js — the agent loop (Claude-only, no tools yet)

**Files:**
- Create: `packages/web-shell/lib/agent/driver.js`
- Create: `packages/web-shell/lib/agent/driver.test.js`

- [ ] **Step 1: Write failing test**

```js
import { describe, it, expect, vi } from 'vitest';
import { runAgentLoop } from './driver.js';
import { Registry } from './registry.js';

const reg = new Registry();
reg.register({
  name: 'noop',
  description: 'no-op',
  classification: 'safe',
  inputSchema: { type: 'object' },
  async execute() { return { ok: true }; },
});

describe('runAgentLoop', () => {
  it('completes in one iteration when LLM returns no tool calls', async () => {
    const events = [];
    const llm = vi.fn(async ({ onEvent }) => {
      onEvent({ type: 'text_delta', text: 'done' });
      onEvent({ type: 'message_complete', stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } });
      return { content: [{ type: 'text', text: 'done' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } };
    });

    const result = await runAgentLoop({
      llm,
      registry: reg,
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'hi' }],
      modelId: 'claude-sonnet-4-6',
      apiKey: 'fake',
      ctx: {},
      onEvent: (e) => events.push(e),
      maxIterations: 10,
    });

    expect(result.iterations).toBe(1);
    expect(result.stop_reason).toBe('end_turn');
    expect(events.some((e) => e.type === 'text_delta')).toBe(true);
  });

  it('iterates when LLM returns tool calls, executes them, and resends to LLM', async () => {
    let call = 0;
    const llm = vi.fn(async ({ onEvent }) => {
      call++;
      if (call === 1) {
        onEvent({ type: 'tool_use', id: 'tc1', name: 'noop', input: {} });
        onEvent({ type: 'message_complete', stop_reason: 'tool_use', usage: { input_tokens: 1, output_tokens: 1 } });
        return { content: [{ type: 'tool_use', id: 'tc1', name: 'noop', input: {} }], stop_reason: 'tool_use' };
      }
      onEvent({ type: 'message_complete', stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } });
      return { content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' };
    });

    const events = [];
    const result = await runAgentLoop({
      llm, registry: reg, systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'do it' }],
      modelId: 'claude-sonnet-4-6', apiKey: 'fake',
      ctx: {}, onEvent: (e) => events.push(e), maxIterations: 10,
    });

    expect(result.iterations).toBe(2);
    expect(events.some((e) => e.type === 'tool_status' && e.status === 'done')).toBe(true);
  });

  it('stops at maxIterations (hard kill)', async () => {
    const llm = vi.fn(async ({ onEvent }) => {
      onEvent({ type: 'tool_use', id: `tc-${Math.random()}`, name: 'noop', input: {} });
      onEvent({ type: 'message_complete', stop_reason: 'tool_use', usage: { input_tokens: 1, output_tokens: 1 } });
      return { content: [{ type: 'tool_use', id: 'x', name: 'noop', input: {} }], stop_reason: 'tool_use' };
    });
    const result = await runAgentLoop({
      llm, registry: reg, systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'loop' }],
      modelId: 'claude-sonnet-4-6', apiKey: 'fake',
      ctx: {}, onEvent: () => {}, maxIterations: 3,
    });
    expect(result.stop_reason).toBe('hard_limited');
    expect(result.iterations).toBe(3);
  });
});
```

- [ ] **Step 2: Run (FAIL)**

```bash
npm test -- lib/agent/driver.test.js
```

Expected: FAIL.

- [ ] **Step 3: Implement driver.js**

```js
/**
 * Agent loop driver. Generic over LLM adapter (Claude only in Phase 1).
 *
 *   while not done:
 *     1. Call LLM with current message history + tool spec.
 *     2. Stream text deltas + tool_use events out via onEvent.
 *     3. If stop_reason='tool_use', execute each tool call (safe = run immediately,
 *        Phase 1 has no destructive yet), append tool results to history, loop.
 *     4. If stop_reason='end_turn', exit loop.
 *     5. Hard cap at maxIterations (default 10 for Phase 1).
 *
 * Phase 2 adds: pause for destructive tool confirmation, soft-pause, retry budget,
 * wall-clock timeout, tool error recovery.
 */
export async function runAgentLoop({
  llm,                       // LLM adapter fn ({model, system, messages, tools, apiKey, onEvent}) → Promise<final>
  registry,                  // Registry instance
  systemPrompt,              // string
  messages,                  // initial messages (just the user msg in fresh run)
  modelId,                   // 'claude-sonnet-4-6' etc — already aliased
  apiKey,
  ctx,                       // { boardId, userId, db, conversationModel, ... } passed to tool executors
  onEvent,                   // ({type, ...payload}) => void  (caller emits SSE)
  maxIterations = 10,
  toolAllowlist = null,
}) {
  const tools = registry.toAnthropicSpec(toolAllowlist);
  const history = [...messages];
  const totalUsage = { input_tokens: 0, output_tokens: 0 };
  let iterations = 0;

  while (true) {
    if (iterations >= maxIterations) {
      onEvent({ type: 'run_status', status: 'hard_limited' });
      return { stop_reason: 'hard_limited', iterations, usage: totalUsage };
    }
    iterations++;

    // Track tool_use events from this iteration so we can execute them after.
    const toolCalls = [];
    const finalMsg = await llm({
      model: modelId,
      system: systemPrompt,
      messages: history,
      tools,
      apiKey,
      onEvent: (ev) => {
        if (ev.type === 'tool_use') toolCalls.push(ev);
        if (ev.type === 'message_complete') {
          totalUsage.input_tokens += ev.usage?.input_tokens || 0;
          totalUsage.output_tokens += ev.usage?.output_tokens || 0;
        }
        onEvent(ev);
      },
    });

    // Push the assistant message into history (Anthropic format: content blocks).
    history.push({ role: 'assistant', content: finalMsg.content });

    if (finalMsg.stop_reason === 'end_turn' || finalMsg.stop_reason === 'stop_sequence') {
      onEvent({ type: 'run_status', status: 'completed' });
      return { stop_reason: 'end_turn', iterations, usage: totalUsage };
    }

    if (finalMsg.stop_reason !== 'tool_use') {
      onEvent({ type: 'run_status', status: 'failed', err: `unexpected stop_reason: ${finalMsg.stop_reason}` });
      return { stop_reason: 'failed', iterations, usage: totalUsage };
    }

    // Execute each tool_use the model emitted.
    const toolResultsForHistory = [];
    for (const call of toolCalls) {
      const tool = registry.get(call.name);
      if (!tool) {
        const err = { error: 'unknown_tool', message: `no tool named ${call.name}` };
        onEvent({ type: 'tool_status', id: call.id, status: 'error', error: err.message });
        toolResultsForHistory.push({ tool_use_id: call.id, content: JSON.stringify(err), is_error: true });
        continue;
      }
      // Phase 1: classification is always 'safe' (other tools not yet registered).
      onEvent({ type: 'tool_status', id: call.id, status: 'running' });
      try {
        const result = await tool.execute(call.input, ctx);
        onEvent({ type: 'tool_status', id: call.id, status: 'done', result });
        toolResultsForHistory.push({ tool_use_id: call.id, content: JSON.stringify(result) });
      } catch (e) {
        const errPayload = { error: 'execution_failed', message: String(e?.message || e) };
        onEvent({ type: 'tool_status', id: call.id, status: 'error', error: errPayload.message });
        toolResultsForHistory.push({ tool_use_id: call.id, content: JSON.stringify(errPayload), is_error: true });
      }
    }

    // Append tool results as a 'user' role message (Anthropic convention).
    history.push({
      role: 'user',
      content: toolResultsForHistory.map((r) => ({
        type: 'tool_result',
        tool_use_id: r.tool_use_id,
        content: r.content,
        ...(r.is_error ? { is_error: true } : {}),
      })),
    });

    // Loop continues with appended results.
  }
}
```

- [ ] **Step 4: Run (PASS)**

```bash
npm test -- lib/agent/driver.test.js
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/web-shell/lib/agent/driver.js packages/web-shell/lib/agent/driver.test.js
git commit -m "feat(agent): driver loop — safe tools only, hard-cap iterations"
```

---

## Phase 4 — The 6 safe tools

> Each tool is its own file under `packages/web-shell/lib/agent/tools/`. Tools share a uniform shape (see registry.js). Tests live next to each tool file.

### Task 4.1: createNode tool

**Files:**
- Create: `packages/web-shell/lib/agent/tools/create-node.js`
- Create: `packages/web-shell/lib/agent/tools/create-node.test.js`

- [ ] **Step 1: Write failing test**

```js
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../db.js', () => {
  const sql = vi.fn();
  sql._reset = () => sql.mockReset();
  return { sql };
});

const { sql } = await import('../../db.js');
const { createNodeTool } = await import('./create-node.js');

describe('createNode tool', () => {
  it('inserts a node and returns the row', async () => {
    sql.mockResolvedValueOnce([{ id: 'board-1' }]);              // SELECT board
    sql.mockResolvedValueOnce([{ id: 'node-1', kind: 'prompt' }]); // INSERT node
    const result = await createNodeTool.execute(
      { kind: 'prompt', name: 'idea 1' },
      { boardId: 'board-1', userId: 42 },
    );
    expect(result.id).toBe('node-1');
  });

  it('returns invalid_args for missing kind', async () => {
    const result = await createNodeTool.execute({}, { boardId: 'b1', userId: 42 });
    expect(result.error).toBe('invalid_args');
  });

  it('returns invalid_args for unknown kind', async () => {
    const result = await createNodeTool.execute({ kind: 'wat' }, { boardId: 'b1', userId: 42 });
    expect(result.error).toBe('invalid_args');
  });

  it('returns forbidden when board not owned by user', async () => {
    sql.mockResolvedValueOnce([]); // SELECT board → empty
    const result = await createNodeTool.execute(
      { kind: 'prompt' }, { boardId: 'b1', userId: 42 },
    );
    expect(result.error).toBe('forbidden');
  });
});
```

- [ ] **Step 2: Run (FAIL)**

```bash
npm test -- lib/agent/tools/create-node.test.js
```

Expected: FAIL.

- [ ] **Step 3: Implement create-node.js**

```js
import { sql } from '../../db.js';

const VALID_KINDS = ['site', 'template', 'designmd', 'chunk', 'prompt', 'skill', 'asset'];

export const createNodeTool = {
  name: 'createNode',
  description: 'Create a new node on the user\'s current board. Use kind="prompt" for a writable text prompt node, "site" for a website snapshot placeholder (use updateNode meta.url later), "designmd" for a design.md container, "asset" for an image/asset slot.',
  classification: 'safe',
  inputSchema: {
    type: 'object',
    properties: {
      kind: { type: 'string', enum: VALID_KINDS, description: 'Node kind' },
      name: { type: 'string', description: 'Optional display name' },
      meta: { type: 'object', description: 'Arbitrary metadata' },
      posX: { type: 'number', description: 'Canvas X position (optional, auto-placed if omitted)' },
      posY: { type: 'number', description: 'Canvas Y position' },
    },
    required: ['kind'],
  },
  async execute(args, ctx) {
    const { kind, name = null, meta = {}, posX = 0, posY = 0 } = args || {};
    if (!kind) return { error: 'invalid_args', message: 'kind is required' };
    if (!VALID_KINDS.includes(kind)) return { error: 'invalid_args', message: `kind must be one of: ${VALID_KINDS.join(', ')}` };

    const owned = await sql`SELECT id FROM boards WHERE id = ${ctx.boardId} AND user_id = ${ctx.userId}`;
    if (!owned.length) return { error: 'forbidden', message: 'board not found or not owned' };

    const enrichedMeta = name ? { ...meta, name } : meta;

    const [node] = await sql`
      INSERT INTO nodes (board_id, kind, pos_x, pos_y, meta)
      VALUES (${ctx.boardId}, ${kind}, ${posX}, ${posY}, ${enrichedMeta}::jsonb)
      RETURNING id, kind, pos_x, pos_y, meta, created_at
    `;
    return { id: node.id, kind: node.kind, posX: node.pos_x, posY: node.pos_y, meta: node.meta };
  },
};
```

- [ ] **Step 4: Run (PASS)**

```bash
npm test -- lib/agent/tools/create-node.test.js
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/web-shell/lib/agent/tools/create-node.js packages/web-shell/lib/agent/tools/create-node.test.js
git commit -m "feat(agent): createNode tool"
```

---

### Task 4.2: addEdge tool

**Files:**
- Create: `packages/web-shell/lib/agent/tools/add-edge.js`
- Create: `packages/web-shell/lib/agent/tools/add-edge.test.js`

- [ ] **Step 1: Test**

```js
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../db.js', () => {
  const sql = vi.fn();
  return { sql };
});
const { sql } = await import('../../db.js');
const { addEdgeTool } = await import('./add-edge.js');

describe('addEdge tool', () => {
  it('creates edge between two nodes in the board', async () => {
    sql.mockResolvedValueOnce([{ id: 'n1' }, { id: 'n2' }]); // both nodes belong to board
    sql.mockResolvedValueOnce([{ id: 'edge-1', from_node_id: 'n1', to_node_id: 'n2' }]);
    const r = await addEdgeTool.execute(
      { fromNodeId: 'n1', toNodeId: 'n2' },
      { boardId: 'b1', userId: 42 },
    );
    expect(r.id).toBe('edge-1');
  });

  it('returns invalid_args when ids missing', async () => {
    const r = await addEdgeTool.execute({}, { boardId: 'b1', userId: 42 });
    expect(r.error).toBe('invalid_args');
  });

  it('returns target_not_found when a node is not in board', async () => {
    sql.mockResolvedValueOnce([{ id: 'n1' }]); // only one returned
    const r = await addEdgeTool.execute(
      { fromNodeId: 'n1', toNodeId: 'n-missing' },
      { boardId: 'b1', userId: 42 },
    );
    expect(r.error).toBe('target_not_found');
  });
});
```

- [ ] **Step 2: Run (FAIL)**

```bash
npm test -- lib/agent/tools/add-edge.test.js
```

- [ ] **Step 3: Implement add-edge.js**

```js
import { sql } from '../../db.js';

export const addEdgeTool = {
  name: 'addEdge',
  description: 'Create a directed edge from one node to another. Used to wire a source node into a target so the target can read from the source when run.',
  classification: 'safe',
  inputSchema: {
    type: 'object',
    properties: {
      fromNodeId: { type: 'string', description: 'Source node id' },
      toNodeId:   { type: 'string', description: 'Target node id' },
      kind:       { type: 'string', description: 'Optional edge kind (default "generic")' },
    },
    required: ['fromNodeId', 'toNodeId'],
  },
  async execute(args, ctx) {
    const { fromNodeId, toNodeId, kind = 'generic' } = args || {};
    if (!fromNodeId || !toNodeId) return { error: 'invalid_args', message: 'fromNodeId and toNodeId are required' };
    if (fromNodeId === toNodeId) return { error: 'invalid_args', message: 'cannot connect a node to itself' };

    const found = await sql`
      SELECT id FROM nodes WHERE board_id = ${ctx.boardId} AND id IN (${fromNodeId}, ${toNodeId})
    `;
    if (found.length !== 2) return { error: 'target_not_found', message: 'one or both nodes not on this board' };

    const [edge] = await sql`
      INSERT INTO edges (board_id, from_node_id, to_node_id, kind)
      VALUES (${ctx.boardId}, ${fromNodeId}, ${toNodeId}, ${kind})
      RETURNING id, from_node_id, to_node_id, kind, created_at
    `;
    return { id: edge.id, fromNodeId: edge.from_node_id, toNodeId: edge.to_node_id, kind: edge.kind };
  },
};
```

- [ ] **Step 4: Run (PASS)**

- [ ] **Step 5: Commit**

```bash
git add packages/web-shell/lib/agent/tools/add-edge.js packages/web-shell/lib/agent/tools/add-edge.test.js
git commit -m "feat(agent): addEdge tool"
```

---

### Task 4.3: updateNode tool

**Files:**
- Create: `packages/web-shell/lib/agent/tools/update-node.js`
- Create: `packages/web-shell/lib/agent/tools/update-node.test.js`

- [ ] **Step 1: Test**

```js
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../db.js', () => ({ sql: vi.fn() }));
const { sql } = await import('../../db.js');
const { updateNodeTool } = await import('./update-node.js');

describe('updateNode tool', () => {
  it('updates pos_x, pos_y, meta when provided', async () => {
    sql.mockResolvedValueOnce([{ id: 'n1', board_id: 'b1' }]); // SELECT (ownership check)
    sql.mockResolvedValueOnce([{ id: 'n1', pos_x: 100, pos_y: 200, meta: { name: 'updated' } }]);
    const r = await updateNodeTool.execute(
      { id: 'n1', posX: 100, posY: 200, name: 'updated' },
      { boardId: 'b1', userId: 42 },
    );
    expect(r.id).toBe('n1');
    expect(r.posX).toBe(100);
  });

  it('returns target_not_found when node missing', async () => {
    sql.mockResolvedValueOnce([]); // ownership query empty
    const r = await updateNodeTool.execute({ id: 'missing' }, { boardId: 'b1', userId: 42 });
    expect(r.error).toBe('target_not_found');
  });

  it('returns invalid_args when nothing to update', async () => {
    sql.mockResolvedValueOnce([{ id: 'n1', board_id: 'b1' }]);
    const r = await updateNodeTool.execute({ id: 'n1' }, { boardId: 'b1', userId: 42 });
    expect(r.error).toBe('invalid_args');
  });
});
```

- [ ] **Step 2: Run (FAIL)**

- [ ] **Step 3: Implement update-node.js**

```js
import { sql } from '../../db.js';

export const updateNodeTool = {
  name: 'updateNode',
  description: 'Update a node\'s display name, position, or metadata. Pass only the fields you want changed.',
  classification: 'safe',
  inputSchema: {
    type: 'object',
    properties: {
      id:   { type: 'string', description: 'Node id' },
      name: { type: 'string', description: 'New display name (stored in meta.name)' },
      meta: { type: 'object', description: 'Replace meta entirely (rare — usually use name instead)' },
      posX: { type: 'number' },
      posY: { type: 'number' },
    },
    required: ['id'],
  },
  async execute(args, ctx) {
    const { id, name, meta, posX, posY } = args || {};
    if (!id) return { error: 'invalid_args', message: 'id required' };
    if (name === undefined && meta === undefined && posX === undefined && posY === undefined) {
      return { error: 'invalid_args', message: 'at least one of name/meta/posX/posY required' };
    }

    const owned = await sql`
      SELECT n.id, n.meta FROM nodes n
      JOIN boards b ON b.id = n.board_id
      WHERE n.id = ${id} AND b.id = ${ctx.boardId} AND b.user_id = ${ctx.userId}
    `;
    if (!owned.length) return { error: 'target_not_found', message: 'node not found on this board' };

    // Compute next meta if name or meta provided
    let nextMeta = null;
    if (meta !== undefined) {
      nextMeta = meta;
    } else if (name !== undefined) {
      nextMeta = { ...(owned[0].meta || {}), name };
    }

    const [updated] = await sql`
      UPDATE nodes SET
        pos_x = COALESCE(${posX ?? null}, pos_x),
        pos_y = COALESCE(${posY ?? null}, pos_y),
        meta  = COALESCE(${nextMeta ? JSON.stringify(nextMeta) : null}::jsonb, meta)
      WHERE id = ${id}
      RETURNING id, kind, pos_x, pos_y, meta
    `;
    return { id: updated.id, kind: updated.kind, posX: updated.pos_x, posY: updated.pos_y, meta: updated.meta };
  },
};
```

- [ ] **Step 4: Run (PASS)**

- [ ] **Step 5: Commit**

```bash
git add packages/web-shell/lib/agent/tools/update-node.js packages/web-shell/lib/agent/tools/update-node.test.js
git commit -m "feat(agent): updateNode tool"
```

---

### Task 4.4: queryNodes tool

**Files:**
- Create: `packages/web-shell/lib/agent/tools/query-nodes.js`
- Create: `packages/web-shell/lib/agent/tools/query-nodes.test.js`

- [ ] **Step 1: Test**

```js
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../db.js', () => ({ sql: vi.fn() }));
const { sql } = await import('../../db.js');
const { queryNodesTool } = await import('./query-nodes.js');

describe('queryNodes tool', () => {
  it('returns nodes filtered by kind', async () => {
    sql.mockResolvedValueOnce([
      { id: 'n1', kind: 'site', meta: { name: 'foo' } },
      { id: 'n2', kind: 'site', meta: {} },
    ]);
    const r = await queryNodesTool.execute({ kind: 'site' }, { boardId: 'b1', userId: 42 });
    expect(r).toHaveLength(2);
  });

  it('caps results at limit (default 30)', async () => {
    sql.mockResolvedValueOnce(Array.from({ length: 30 }, (_, i) => ({ id: `n${i}`, kind: 'prompt' })));
    const r = await queryNodesTool.execute({}, { boardId: 'b1', userId: 42 });
    expect(r).toHaveLength(30);
  });
});
```

- [ ] **Step 2: Run (FAIL)**

- [ ] **Step 3: Implement query-nodes.js**

```js
import { sql } from '../../db.js';

export const queryNodesTool = {
  name: 'queryNodes',
  description: 'List nodes on the current board, optionally filtered by kind and/or a name substring. Returns up to 30 nodes by default.',
  classification: 'safe',
  inputSchema: {
    type: 'object',
    properties: {
      kind:        { type: 'string', description: 'Filter by node kind (e.g. "site", "prompt")' },
      namePattern: { type: 'string', description: 'Case-insensitive substring match against meta.name' },
      limit:       { type: 'number', description: 'Max results, default 30, hard cap 100' },
    },
  },
  async execute(args, ctx) {
    const { kind = null, namePattern = null } = args || {};
    const limit = Math.min(Math.max(parseInt(args?.limit ?? 30, 10) || 30, 1), 100);

    const rows = await sql`
      SELECT id, kind, pos_x, pos_y, meta, current_snapshot_id, created_at
      FROM nodes
      WHERE board_id = ${ctx.boardId}
        AND (${kind}::text IS NULL OR kind = ${kind})
        AND (${namePattern}::text IS NULL OR (meta->>'name') ILIKE '%' || ${namePattern} || '%')
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;
    return rows.map((r) => ({
      id: r.id, kind: r.kind, posX: r.pos_x, posY: r.pos_y, meta: r.meta,
      hasSnapshot: !!r.current_snapshot_id, createdAt: r.created_at,
    }));
  },
};
```

- [ ] **Step 4: Run (PASS)**

- [ ] **Step 5: Commit**

```bash
git add packages/web-shell/lib/agent/tools/query-nodes.js packages/web-shell/lib/agent/tools/query-nodes.test.js
git commit -m "feat(agent): queryNodes tool"
```

---

### Task 4.5: getNodeOutput tool

**Files:**
- Create: `packages/web-shell/lib/agent/tools/get-node-output.js`
- Create: `packages/web-shell/lib/agent/tools/get-node-output.test.js`

- [ ] **Step 1: Test**

```js
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../db.js', () => ({ sql: vi.fn() }));
const { sql } = await import('../../db.js');
const { getNodeOutputTool } = await import('./get-node-output.js');

describe('getNodeOutput tool', () => {
  it('returns truncated html when length exceeds maxChars', async () => {
    sql.mockResolvedValueOnce([{
      id: 'snap-1',
      html: 'x'.repeat(5000),
      design_md: null,
    }]);
    const r = await getNodeOutputTool.execute({ nodeId: 'n1', maxChars: 100 }, { boardId: 'b1', userId: 42 });
    expect(r.content.length).toBeLessThanOrEqual(100 + 50); // truncation marker
    expect(r.truncated).toBe(true);
  });

  it('returns full content when within maxChars', async () => {
    sql.mockResolvedValueOnce([{ id: 'snap-1', html: '<p>short</p>', design_md: null }]);
    const r = await getNodeOutputTool.execute({ nodeId: 'n1', maxChars: 4000 }, { boardId: 'b1', userId: 42 });
    expect(r.truncated).toBe(false);
  });

  it('returns target_not_found when snapshot missing', async () => {
    sql.mockResolvedValueOnce([]);
    const r = await getNodeOutputTool.execute({ nodeId: 'missing' }, { boardId: 'b1', userId: 42 });
    expect(r.error).toBe('target_not_found');
  });
});
```

- [ ] **Step 2: Run (FAIL)**

- [ ] **Step 3: Implement get-node-output.js**

```js
import { sql } from '../../db.js';

export const getNodeOutputTool = {
  name: 'getNodeOutput',
  description: 'Read the current snapshot content (HTML and/or design.md) of a node. The content is truncated to maxChars (default 4000) so the LLM context window doesn\'t blow up. Use this to inspect what a node actually contains before making decisions.',
  classification: 'safe',
  inputSchema: {
    type: 'object',
    properties: {
      nodeId:   { type: 'string', description: 'Node id to read' },
      maxChars: { type: 'number', description: 'Truncate combined output to this many chars (default 4000, cap 16000)' },
    },
    required: ['nodeId'],
  },
  async execute(args, ctx) {
    const { nodeId } = args || {};
    if (!nodeId) return { error: 'invalid_args', message: 'nodeId required' };
    const maxChars = Math.min(Math.max(parseInt(args?.maxChars ?? 4000, 10) || 4000, 100), 16000);

    const rows = await sql`
      SELECT s.id, s.html, s.design_md
      FROM nodes n
      JOIN boards b ON b.id = n.board_id
      LEFT JOIN snapshots s ON s.id = n.current_snapshot_id
      WHERE n.id = ${nodeId} AND b.id = ${ctx.boardId} AND b.user_id = ${ctx.userId}
    `;
    if (!rows.length) return { error: 'target_not_found', message: 'node not found' };
    const snap = rows[0];
    if (!snap.id) return { error: 'no_snapshot', message: 'node has no current snapshot' };

    const parts = [];
    if (snap.html) parts.push(`# HTML\n${snap.html}`);
    if (snap.design_md) parts.push(`# design.md\n${snap.design_md}`);
    let content = parts.join('\n\n---\n\n');
    let truncated = false;
    if (content.length > maxChars) {
      content = content.slice(0, maxChars) + `\n\n[...truncated ${content.length - maxChars} chars]`;
      truncated = true;
    }
    return { kind: 'snapshot', content, truncated };
  },
};
```

- [ ] **Step 4: Run (PASS)**

- [ ] **Step 5: Commit**

```bash
git add packages/web-shell/lib/agent/tools/get-node-output.js packages/web-shell/lib/agent/tools/get-node-output.test.js
git commit -m "feat(agent): getNodeOutput tool with truncation"
```

---

### Task 4.6: listAssets tool

**Files:**
- Create: `packages/web-shell/lib/agent/tools/list-assets.js`
- Create: `packages/web-shell/lib/agent/tools/list-assets.test.js`

- [ ] **Step 1: Test**

```js
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../db.js', () => ({ sql: vi.fn() }));
const { sql } = await import('../../db.js');
const { listAssetsTool } = await import('./list-assets.js');

describe('listAssets tool', () => {
  it('lists library-scope assets (project_id IS NULL)', async () => {
    sql.mockResolvedValueOnce([
      { id: 'a1', type: 'image', source_url: 'http://x/a.png', thumb_url: 'http://x/a-thumb.png' },
    ]);
    const r = await listAssetsTool.execute({ scope: 'library' }, { boardId: 'b1', userId: 42 });
    expect(r).toHaveLength(1);
  });

  it('lists project-scope assets when scope=project', async () => {
    sql.mockResolvedValueOnce([]);
    await listAssetsTool.execute({ scope: 'project' }, { boardId: 'b1', userId: 42 });
    expect(sql).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run (FAIL)**

- [ ] **Step 3: Implement list-assets.js**

```js
import { sql } from '../../db.js';

export const listAssetsTool = {
  name: 'listAssets',
  description: 'List the user\'s collected assets. scope="library" returns assets not tied to any project. scope="project" returns assets tied to the current board\'s project.',
  classification: 'safe',
  inputSchema: {
    type: 'object',
    properties: {
      scope: { type: 'string', enum: ['library', 'project'], description: 'library (default) or project' },
      type:  { type: 'string', description: 'Optional filter: image, icon, background, font' },
      limit: { type: 'number', description: 'Max results, default 20, cap 100' },
    },
  },
  async execute(args, ctx) {
    const scope = args?.scope === 'project' ? 'project' : 'library';
    const type = args?.type || null;
    const limit = Math.min(Math.max(parseInt(args?.limit ?? 20, 10) || 20, 1), 100);

    const rows = scope === 'library'
      ? await sql`
          SELECT id, type, source_url, thumb_url, created_at
          FROM assets
          WHERE user_id = ${ctx.userId} AND project_id IS NULL
            AND (${type}::text IS NULL OR type = ${type})
          ORDER BY created_at DESC LIMIT ${limit}
        `
      : await sql`
          SELECT id, type, source_url, thumb_url, created_at
          FROM assets
          WHERE user_id = ${ctx.userId} AND project_id = ${ctx.boardId}
            AND (${type}::text IS NULL OR type = ${type})
          ORDER BY created_at DESC LIMIT ${limit}
        `;
    return rows.map((r) => ({
      id: r.id, type: r.type,
      sourceUrl: r.source_url, thumbUrl: r.thumb_url,
      createdAt: r.created_at,
    }));
  },
};
```

- [ ] **Step 4: Run (PASS)**

- [ ] **Step 5: Commit**

```bash
git add packages/web-shell/lib/agent/tools/list-assets.js packages/web-shell/lib/agent/tools/list-assets.test.js
git commit -m "feat(agent): listAssets tool"
```

---

### Task 4.7: tools index — register all 6 safe tools

**Files:**
- Create: `packages/web-shell/lib/agent/tools/index.js`
- Create: `packages/web-shell/lib/agent/tools/index.test.js`

- [ ] **Step 1: Test**

```js
import { describe, it, expect } from 'vitest';
import { buildSafeRegistry } from './index.js';

describe('buildSafeRegistry', () => {
  it('registers the 6 Phase-1 safe tools', () => {
    const r = buildSafeRegistry();
    expect(r.get('createNode')).toBeDefined();
    expect(r.get('addEdge')).toBeDefined();
    expect(r.get('updateNode')).toBeDefined();
    expect(r.get('queryNodes')).toBeDefined();
    expect(r.get('getNodeOutput')).toBeDefined();
    expect(r.get('listAssets')).toBeDefined();
    expect(r.all()).toHaveLength(6);
  });
});
```

- [ ] **Step 2: Run (FAIL)**

- [ ] **Step 3: Implement index.js**

```js
import { Registry } from '../registry.js';
import { createNodeTool }    from './create-node.js';
import { addEdgeTool }       from './add-edge.js';
import { updateNodeTool }    from './update-node.js';
import { queryNodesTool }    from './query-nodes.js';
import { getNodeOutputTool } from './get-node-output.js';
import { listAssetsTool }    from './list-assets.js';

/**
 * Build a Registry pre-populated with the 6 safe tools available in Phase 1.
 * Phase 2 adds: deleteNode, runFlow, editSite, createImage.
 */
export function buildSafeRegistry() {
  const r = new Registry();
  r.register(createNodeTool);
  r.register(addEdgeTool);
  r.register(updateNodeTool);
  r.register(queryNodesTool);
  r.register(getNodeOutputTool);
  r.register(listAssetsTool);
  return r;
}
```

- [ ] **Step 4: Run (PASS)**

- [ ] **Step 5: Commit**

```bash
git add packages/web-shell/lib/agent/tools/index.js packages/web-shell/lib/agent/tools/index.test.js
git commit -m "feat(agent): tools/index — buildSafeRegistry() with the 6 Phase-1 tools"
```

---

## Phase 5 — POST /api/chat: wire driver + tools + SSE

### Task 5.1: lib/agent/sse-bridge.js — write helper

**Files:**
- Create: `packages/web-shell/lib/agent/sse-bridge.js`
- Create: `packages/web-shell/lib/agent/sse-bridge.test.js`

- [ ] **Step 1: Test**

```js
import { describe, it, expect } from 'vitest';
import { createSseStream } from './sse-bridge.js';

describe('createSseStream', () => {
  it('produces a ReadableStream emitting SSE-formatted events', async () => {
    const { stream, send, close } = createSseStream();
    const reader = stream.getReader();
    const decoder = new TextDecoder();

    send('hello', { foo: 1 });
    close();

    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value);
    }
    expect(buf).toContain('event: hello');
    expect(buf).toContain('data: {"foo":1}');
  });
});
```

- [ ] **Step 2: Run (FAIL)**

- [ ] **Step 3: Implement sse-bridge.js**

```js
/**
 * SSE writer over a Web ReadableStream.
 *
 *   const { stream, send, close } = createSseStream();
 *   return new Response(stream, { headers: SSE_HEADERS });
 *   ...
 *   send('assistant_token', { delta: 'hi' });
 *   close();
 */
export const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache, no-transform',
  'Connection': 'keep-alive',
  'X-Accel-Buffering': 'no',
};

export function createSseStream() {
  let controllerRef;
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) { controllerRef = controller; },
    cancel() { /* client disconnected */ },
  });

  function send(event, dataObj) {
    if (!controllerRef) return;
    const payload = `event: ${event}\ndata: ${JSON.stringify(dataObj)}\n\n`;
    try { controllerRef.enqueue(encoder.encode(payload)); } catch (_) {}
  }

  function close() {
    if (controllerRef) {
      try { controllerRef.close(); } catch (_) {}
      controllerRef = null;
    }
  }

  return { stream, send, close };
}
```

- [ ] **Step 4: Run (PASS)**

- [ ] **Step 5: Commit**

```bash
git add packages/web-shell/lib/agent/sse-bridge.js packages/web-shell/lib/agent/sse-bridge.test.js
git commit -m "feat(agent): SSE bridge with headers + writer helper"
```

---

### Task 5.2: POST /api/chat — wire driver to SSE response

**Files:**
- Modify: `packages/web-shell/app/api/chat/route.js`
- Create: `packages/web-shell/app/api/chat/route.post.test.js`

- [ ] **Step 1: Add the failing POST test**

Create `packages/web-shell/app/api/chat/route.post.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../lib/auth.js', () => ({
  requireUser: vi.fn(async () => ({ user: { id: 42 } })),
}));
vi.mock('../../../lib/chat-persistence.js', () => ({
  getOrCreateActiveThread: vi.fn(async () => ({ id: 'thread-1' })),
  appendMessage: vi.fn(async (m) => ({ id: 'msg-x', ...m })),
  loadMessages: vi.fn(async () => []),
}));
vi.mock('../../../lib/agent/tools/index.js', () => ({
  buildSafeRegistry: () => ({
    get: () => ({ name: 'noop', classification: 'safe' }),
    all: () => [],
    toAnthropicSpec: () => [],
  }),
}));
vi.mock('../../../lib/agent/driver.js', () => ({
  runAgentLoop: vi.fn(async ({ onEvent }) => {
    onEvent({ type: 'text_delta', text: 'hi' });
    onEvent({ type: 'message_complete', stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } });
    onEvent({ type: 'run_status', status: 'completed' });
    return { stop_reason: 'end_turn', iterations: 1, usage: { input_tokens: 1, output_tokens: 1 } };
  }),
}));

const { POST } = await import('./route.js');

describe('POST /api/chat', () => {
  it('returns SSE response with events', async () => {
    const req = new Request('http://test/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ boardId: 'b1', message: 'hi', modelId: 'claude-sonnet-4-6' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/event-stream');

    // Consume the stream
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value);
    }
    expect(buf).toContain('event: assistant_token');
    expect(buf).toContain('event: run_status');
  });

  it('returns 400 when boardId missing', async () => {
    const req = new Request('http://test/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'hi' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run (FAIL — POST not implemented)**

```bash
npm test -- app/api/chat/route.post.test.js
```

- [ ] **Step 3: Implement POST in route.js**

Append to `packages/web-shell/app/api/chat/route.js` (after the existing GET handler):

```js
import { appendMessage } from '../../../lib/chat-persistence.js';
import { buildSafeRegistry } from '../../../lib/agent/tools/index.js';
import { runAgentLoop } from '../../../lib/agent/driver.js';
import { callAnthropic } from '../../../lib/agent/llm-anthropic.js';
import { BOARD_AGENT, EDIT_IMAGE_SYSTEM } from '../../../lib/agent/prompts.js';
import { createSseStream, SSE_HEADERS } from '../../../lib/agent/sse-bridge.js';

// Picker IDs → SDK-friendly model strings (mirror MODEL_ALIAS in run-flow.js).
const MODEL_ALIAS = {
  'claude-4.6-opus':   'claude-opus-4-6',
  'claude-4.7-opus':   'claude-opus-4-7',
  'claude-sonnet-4-6': 'claude-sonnet-4-6',
  // Phase 1 is Claude-only; non-Claude picker IDs error below.
};

const PROMPT_KEYS = {
  BOARD_AGENT,
  EDIT_IMAGE_SYSTEM,
};

export async function POST(request) {
  const { user, error } = await requireUser(request);
  if (error) return error;

  const body = await request.json().catch(() => ({}));
  const {
    boardId,
    threadScope = 'board',
    assetId = null,
    message,
    modelId = 'claude-sonnet-4-6',
    tools: toolAllowlist = null,
    systemPromptKey = 'BOARD_AGENT',
  } = body || {};

  if (!boardId) return NextResponse.json({ error: 'boardId required' }, { status: 400 });
  if (!message?.trim()) return NextResponse.json({ error: 'message required' }, { status: 400 });

  // Phase 1: Claude-only.
  const resolvedModel = MODEL_ALIAS[modelId];
  if (!resolvedModel) {
    return NextResponse.json({ error: `Phase 1 supports Claude models only. Got: ${modelId}` }, { status: 400 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured on server' }, { status: 500 });
  }

  const thread = await getOrCreateActiveThread({ boardId, userId: user.id, scope: threadScope, assetId });

  // Persist the user message immediately so it's visible on reload even if the run errors out.
  await appendMessage({ threadId: thread.id, role: 'user', content: message });

  const registry = buildSafeRegistry();
  const systemPrompt = PROMPT_KEYS[systemPromptKey] || PROMPT_KEYS.BOARD_AGENT;

  // Build the message history for the LLM from persisted messages + the new user msg.
  // (Cheap path for Phase 1: just the current user message; richer history support in Phase 5.)
  const initialMessages = [{ role: 'user', content: message }];

  const { stream, send, close } = createSseStream();

  // Fire and forget: run the agent, stream events as they happen.
  (async () => {
    send('thread_id', { threadId: thread.id });
    try {
      const result = await runAgentLoop({
        llm: callAnthropic,
        registry,
        systemPrompt,
        messages: initialMessages,
        modelId: resolvedModel,
        apiKey,
        ctx: { boardId, userId: user.id },
        toolAllowlist,
        onEvent: (ev) => {
          // Normalize driver events to SSE event names per spec §5.
          switch (ev.type) {
            case 'text_delta':
              send('assistant_token', { delta: ev.text });
              break;
            case 'tool_use':
              send('tool_call', {
                id: ev.id, name: ev.name, args: ev.input,
                classification: registry.get(ev.name)?.classification || 'safe',
              });
              break;
            case 'tool_status':
              send('tool_status', { id: ev.id, status: ev.status, result: ev.result, error: ev.error });
              break;
            case 'message_complete':
              // Not surfaced as a dedicated SSE event in Phase 1; usage rolled up at run_status.
              break;
            case 'run_status':
              send('run_status', { status: ev.status, err: ev.err });
              break;
          }
        },
      });

      // Persist final assistant message (text+toolCalls) for chat history.
      // (Phase 1: minimal — store the run summary; Phase 5 will reconstruct per-iteration messages.)
      await appendMessage({
        threadId: thread.id,
        role: 'assistant',
        content: '', // text was streamed; final transcript reassembly in Phase 5
        model: resolvedModel,
        agentRunId: null,
      });
    } catch (e) {
      console.error('[POST /api/chat] agent error', e);
      send('run_status', { status: 'failed', err: String(e?.message || e) });
    } finally {
      close();
    }
  })();

  return new Response(stream, { headers: SSE_HEADERS });
}
```

- [ ] **Step 4: Run (PASS)**

```bash
npm test -- app/api/chat/route.post.test.js
```

Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/web-shell/app/api/chat/route.js packages/web-shell/app/api/chat/route.post.test.js
git commit -m "feat(api): POST /api/chat — SSE agent loop with safe tools"
```

---

## Phase 6 — PromptDock integration: render chat + send messages

### Task 6.1: Hook PromptDock into the chat client

**Files:**
- Modify: `packages/web-shell/components/PromptDock.jsx`

> **Note to executor:** PromptDock.jsx is large (~717 lines). The integration touches only the submit handler and adds a chat-panel render block above the existing input. Do NOT refactor unrelated parts.

- [ ] **Step 1: Read current PromptDock.jsx top-to-bottom to understand the props + submit flow**

```bash
wc -l packages/web-shell/components/PromptDock.jsx
# locate the submit function (likely named handleSubmit or onSubmit)
grep -n "function handleSubmit\|onSubmit\|handleSend\|function submit" packages/web-shell/components/PromptDock.jsx
```

- [ ] **Step 2: Add chat state + load thread on mount**

Near the top of the PromptDock component function (after existing useState calls), add:

```jsx
import { useEffect, useReducer } from 'react';
import { createChatStream } from '../lib/chat-client.js';
import ChatPanel from './chat/ChatPanel.jsx';

const initialChat = {
  threadId: null,
  messages: [],
  activeToolCalls: [],
  streaming: false,
};

function chatReducer(state, action) {
  switch (action.type) {
    case 'THREAD_LOADED':
      return { ...state, threadId: action.threadId, messages: action.messages };
    case 'USER_MSG_OPTIMISTIC':
      return {
        ...state,
        messages: [...state.messages, { id: `tmp-${Date.now()}`, role: 'user', content: action.content }],
        streaming: true,
        activeToolCalls: [],
      };
    case 'ASSISTANT_TOKEN':
      // Phase 1 minimal: append/append to a "currentAssistantBuffer" stored in state.
      // Render as a transient assistant bubble.
      return {
        ...state,
        messages: lastIsTransientAssistant(state.messages)
          ? state.messages.map((m, i) => i === state.messages.length - 1
              ? { ...m, content: (m.content || '') + action.delta }
              : m)
          : [...state.messages, { id: `tmp-asst-${Date.now()}`, role: 'assistant', content: action.delta, tool_calls: null }],
      };
    case 'TOOL_CALL_STARTED':
      return {
        ...state,
        activeToolCalls: [...state.activeToolCalls, { id: action.id, name: action.name, args: action.args, status: 'running' }],
      };
    case 'TOOL_CALL_STATUS': {
      const updated = state.activeToolCalls.map((tc) => tc.id === action.id
        ? { ...tc, status: action.status, result: action.result, error: action.error }
        : tc);
      return { ...state, activeToolCalls: updated };
    }
    case 'RUN_FINISHED':
      return { ...state, streaming: false, activeToolCalls: [] };
    default:
      return state;
  }
}
function lastIsTransientAssistant(messages) {
  const last = messages[messages.length - 1];
  return last?.role === 'assistant' && last?.id?.startsWith('tmp-asst-');
}
```

- [ ] **Step 3: Load thread when boardId becomes available**

Inside the PromptDock function body:

```jsx
const [chat, dispatchChat] = useReducer(chatReducer, initialChat);

useEffect(() => {
  if (!boardId) return;
  let aborted = false;
  (async () => {
    try {
      const res = await fetch(`/api/chat?boardId=${encodeURIComponent(boardId)}`, { credentials: 'include' });
      if (!res.ok || aborted) return;
      const { thread, messages } = await res.json();
      dispatchChat({ type: 'THREAD_LOADED', threadId: thread.id, messages });
    } catch (e) {
      console.warn('[PromptDock] failed to load chat thread', e);
    }
  })();
  return () => { aborted = true; };
}, [boardId]);
```

- [ ] **Step 4: Replace (or add to) submit handler with a chat-send path**

Locate the existing submit function. Add a new branch that sends the message to /api/chat when the input is plain text (not a URL, not a file). Keep the existing run-flow path for now (Phase 1 doesn't replace it — both coexist; chat takes precedence when user typed text and didn't reference any node).

```jsx
async function sendChatMessage(content) {
  if (!boardId || !content?.trim()) return;
  dispatchChat({ type: 'USER_MSG_OPTIMISTIC', content });

  // Open the POST as a fetch w/ readable body to drive the SSE.
  // Note: native EventSource doesn't support POST bodies; we use fetch + reader.
  const res = await fetch('/api/chat', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
    body: JSON.stringify({
      boardId,
      message: content,
      modelId: currentModelId,   // existing model picker state
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    console.error('[chat] POST failed', err);
    dispatchChat({ type: 'RUN_FINISHED' });
    return;
  }

  // Stream-parse SSE manually (we'd use createChatStream's EventSource path only for GET; POST needs fetch+reader).
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const evBlock = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const lines = evBlock.split('\n');
      let evName = null, dataStr = '';
      for (const ln of lines) {
        if (ln.startsWith('event: ')) evName = ln.slice(7).trim();
        else if (ln.startsWith('data: ')) dataStr += ln.slice(6);
      }
      if (!evName) continue;
      let data;
      try { data = JSON.parse(dataStr); } catch { continue; }
      handleSseEvent(evName, data);
    }
  }
  dispatchChat({ type: 'RUN_FINISHED' });
}

function handleSseEvent(name, payload) {
  switch (name) {
    case 'assistant_token':
      dispatchChat({ type: 'ASSISTANT_TOKEN', delta: payload.delta });
      break;
    case 'tool_call':
      dispatchChat({ type: 'TOOL_CALL_STARTED', id: payload.id, name: payload.name, args: payload.args });
      break;
    case 'tool_status':
      dispatchChat({ type: 'TOOL_CALL_STATUS', id: payload.id, status: payload.status, result: payload.result, error: payload.error });
      break;
    case 'run_status':
      // Phase 1: nothing extra to do; the RUN_FINISHED dispatch above handles cleanup.
      break;
  }
}
```

- [ ] **Step 5: Render ChatPanel above the existing input**

In the JSX returned by PromptDock, just above the existing input row, add:

```jsx
{(chat.messages.length > 0 || chat.activeToolCalls.length > 0) && (
  <ChatPanel messages={chat.messages} activeToolCalls={chat.activeToolCalls} />
)}
```

- [ ] **Step 6: Wire the existing submit button to call sendChatMessage when input is plain text**

In the submit handler, branch on input type:

```jsx
// In whatever submit function exists today (e.g. handleSubmit or onSend):
if (looksLikeUrl(inputValue)) {
  // existing URL path
  return onAddUrl(inputValue);
}
if (inputValue.trim()) {
  await sendChatMessage(inputValue);
  setInputValue('');
  return;
}
```

- [ ] **Step 7: Manual verification (no automated test for this UI wiring — covered by E2E in Phase 7+)**

```bash
# In packages/web-shell/, restart dev server (kill background bo1s8gaax first):
npm run dev
```

Open `http://localhost:3030/canvas/<any-board-id>` in the browser. Type "olá" and press Enter. Expect:
1. The user message appears as a bubble.
2. The agent (Claude) responds with text streamed in.
3. The run completes within a few seconds.
4. Reload the page → the conversation is still there.

If the assistant text doesn't stream live, check the dev server logs for SSE errors and the browser network tab for the `/api/chat` POST.

- [ ] **Step 8: Commit**

```bash
git add packages/web-shell/components/PromptDock.jsx
git commit -m "feat(chat): wire PromptDock to chat agent via SSE"
```

---

### Task 6.2: Manual end-to-end smoke test (full Phase 1 demo)

**Files:** none (manual verification)

- [ ] **Step 1: Make sure ANTHROPIC_API_KEY is set in `.env.local`**

```bash
grep ANTHROPIC_API_KEY packages/web-shell/.env.local
```

If missing, ask the user to add: `ANTHROPIC_API_KEY=sk-ant-...`

- [ ] **Step 2: Test happy path — agent creates 3 nodes**

In the browser at `http://localhost:3030/canvas/<board-id>`:

Type: `crie 3 nodes de prompt em sequência horizontal, com nomes "idea 1", "idea 2", "idea 3"`

Expected:
- Agent responds with text + 3 tool_call chips for createNode
- Each chip transitions running → done
- Three new prompt nodes appear on the canvas (may require manual board refresh in current Phase 1)
- Agent's final text summarizes what was done

- [ ] **Step 3: Test query — agent reads board**

Type: `quantos nodes tem no board agora?`

Expected:
- Agent calls queryNodes → done chip → text summarizes count

- [ ] **Step 4: Test connect — agent adds edge**

Type: `conecta o "idea 1" no "idea 2"`

Expected:
- Agent calls queryNodes to find ids → calls addEdge → done chip
- New edge visible on canvas (after refresh in Phase 1)

- [ ] **Step 5: If everything above works, mark Phase 1 complete**

```bash
git tag phase1-chat-demo
git push origin phase1-chat-demo
```

---

## Final commit (plan complete)

After Task 6.2, the Phase 1 plan is complete. Total commits: ~25. Working software at this point:

- A user can type instructions in the PromptDock and Claude operates the canvas through 6 safe tools.
- Conversation persists per board across reloads.
- Tool calls show as inline chips with running/done/error states.

**Next plans (NOT in this document — to be written separately when this plan ships):**

- `2026-XX-XX-agent-promptdock-phase2.md` — destructive tools (deleteNode, runFlow, editSite, createImage stub) + confirm chip + SSE pause/resume + soft pause + hard kill + retry budget + wall timeout
- `2026-XX-XX-agent-promptdock-phase3.md` — createImage real implementation with Gemini/OpenAI providers + needs_choice flow for Claude conversations
- `2026-XX-XX-agent-promptdock-phase4.md` — Smart Edit chat dock wire-up + asset-scoped threads
- `2026-XX-XX-agent-promptdock-phase5.md` — OpenAI + Gemini + Kimi LLM adapters + history reconstruction in message persistence + cost tracking polish
