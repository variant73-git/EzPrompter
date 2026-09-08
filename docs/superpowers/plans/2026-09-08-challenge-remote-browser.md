# Sites com verificação de bot — navegador remoto com visualizador ao vivo — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Um site atrás de verificação de bot (Cloudflare & cia.) vira clone (referência grátis ou Edit nativo pago) SEM extensão e SEM a pessoa sair do canvas: o nosso navegador na nuvem passa pela checagem (sozinho, ou com a pessoa clicando no captcha dentro do node) e o produtor de sempre captura em seguida.

**Architecture:** Escada por tentativa (navegador barato → sessão Browserbase com solver automático → humano no visualizador ao vivo, atrás de flag e de um portão de revogação → `unsupported` honesto). Um **job persistido** (`challenge_jobs`) com máquina de estados cercada por geração e trava de controlador — nenhum request de servidor espera uma pessoa; o canvas consulta e dispara. Os produtores (`captureSnapshot`, `captureNativeBundle`) ganham uma entrada opcional de **sessão emprestada** (usam contexto/página da sessão verificada; não fecham o que não é deles; repescagem pelo navegador); a captura entra no `reconstructSiteNode` existente → registro, snapshot, controles, cobrança só no sucesso.

**Tech Stack:** Next.js 15 (App Router, `runtime='nodejs'`), Neon Postgres via `lib/db.js` (tagged `sql`), Playwright `connectOverCDP`, Browserbase REST (`https://api.browserbase.com/v1`), Vitest (+ Chromium real nos testes de integração), React (canvas).

**Spec:** `docs/superpowers/specs/2026-09-08-challenge-remote-browser-design.md`

## Global Constraints

- Texto de produto **em inglês**; conversa/comentários em PT (padrão do repo).
- **Nenhum request espera uma pessoa** (spec 4.2): a única espera bloqueante é a verificação limitada (≤ 45 s) e a captura (prazo interno < `maxDuration` 300 s com margem).
- **Uma sessão por job, nunca partilhada**; `recordSession:false`, `logSession:false`, `solveCaptchas:true`, `viewport {1440,900}`, `keepAlive:true`, `api_timeout` 600 s, `allowedDomains` = eTLD+1 do alvo (spec 4.2).
- **URL do visualizador é segredo portador**: só ao dono, só em `needs_human`, só com `UNCRAFT_CHALLENGE_HUMAN=1`, `Cache-Control: no-store`, nunca em logs (spec 4.6). Sem a flag, escada = passos 1, 2 e 4.
- **Cobrança só no sucesso** pela máquina existente (`runBilledOperation` com `idem_key` do job); pré-checagem de saldo ao criar o job (spec 4.5).
- Cotas/limites por env com estes padrões: `UNCRAFT_CHALLENGE_DAILY_FREE=10`, `UNCRAFT_CHALLENGE_MAX_OPEN=2`, `UNCRAFT_CHALLENGE_MAX_SESSIONS=10`, `UNCRAFT_CHALLENGE_DAILY_SESSIONS=200` (disjuntor), `UNCRAFT_BROWSERBASE_PROXY=off`.
- Tolerância do solver `SOLVER_TOLERANCE_MS = 40_000`; tolerância do produtor local segue 5 000 ms (parametrizada).
- Todo teste de rota segue o padrão de `app/api/nodes/[id]/reconstruct/route.test.js` (mock de `lib/auth.js` e `lib/db.js`).
- web-shell usa **bun**; rodar testes SEMPRE com `cd packages/web-shell && bun run vitest run <caminho>` (o `cd` persiste entre chamadas — lição 186).
- Cada tarefa: RED observado → fix mínimo → GREEN → commit. Auditoria Astra (`~/.claude/bin/codex-adversary.sh --mode prose --model gpt-6-astra --effort high --timeout 1500`) nas tarefas 4, 5, 8, 9 e 12.

---

## Estrutura de arquivos

| arquivo | responsabilidade |
|---|---|
| `packages/web-shell/lib/challenge/browserbase-client.js` (novo) | REST do vendor: `createSession`, `liveUrls`, `releaseSession`. `fetch` injetável. Nunca loga URLs. |
| `packages/web-shell/lib/challenge/borrowed-session.js` (novo) | `withBorrowedSession(connectUrl, fn)`: conecta via CDP, entrega `{browser, context, page, owned:false}`, desconecta sem matar a sessão. |
| `packages/web-shell/lib/challenge/verify.js` (novo) | `verifyTarget({page, url, toleranceMs})` → `'clean' | 'needs_human' | 'unsupported'` usando o detector estrito. |
| `packages/web-shell/lib/challenge/job-store.js` (novo) | SQL de `challenge_jobs`: criar, ler (dono), transições cercadas, trava, varredura. |
| `packages/web-shell/lib/challenge/quotas.js` (novo) | cota diária grátis, jobs abertos, sessões simultâneas, disjuntor diário. |
| `packages/web-shell/lib/challenge/job-service.js` (novo) | orquestra: `startJob`, `checkJob`, `captureJob`, `cancelJob`, `sweepExpiredJobs`. Usa os módulos acima + produtores. |
| `packages/web-shell/lib/native-clone/capture-bundle.js` (modif.) | `opts.session` (sessão emprestada), `opts.challengeToleranceMs`, repescagem via `context.request`. |
| `packages/web-shell/lib/snapshot.js` (modif.) | `opts.session` no `captureSnapshot`. |
| `packages/web-shell/migrations/2026-09-08-challenge-jobs.sql` + `schema.sql` + `scripts/migrate.mjs` | tabela + reconciliação + predicado. |
| `packages/web-shell/app/api/nodes/[id]/challenge/route.js` (novo) | `POST` cria job + verificação limitada. |
| `packages/web-shell/app/api/challenge-jobs/[id]/route.js`, `check/route.js`, `capture/route.js`, `cancel/route.js` (novos) | consulta/checagem/captura/cancelamento, todos pelo dono. |
| `packages/web-shell/app/api/nodes/[id]/route.js` (modif.) | `ready_check` devolve também `nativeReady`. |
| `packages/web-shell/app/api/cron/reconcile-holds/route.js` (modif.) | passo `sweepExpiredJobs`. |
| `packages/web-shell/lib/canvas-api.js` (modif.) | 5 métodos do job. |
| `packages/web-shell/components/ChallengeNotice.jsx` (novo) | aviso em inglês com OK (substitui `ChallengeModal`). |
| `packages/web-shell/components/ChallengeLiveView.jsx` (novo) | iframe do visualizador dentro do node. |
| `packages/web-shell/components/useChallengeJob.js` (novo) | hook: polling 3 s + disparo de `check`/`capture` + estados. |
| `packages/web-shell/components/CanvasClient.jsx` (modif.) | liga o hook; remove polling do handoff e o `ChallengeModal`. |
| `packages/extension-shell/panel/panel.js`, `handoff/handoff.js` (modif.) | remove o callout "Complete capture" e o registro de handoff. |

---

### Task 1: Tabela `challenge_jobs` (migração + reconciliação + predicado)

**Files:**
- Create: `packages/web-shell/migrations/2026-09-08-challenge-jobs.sql`
- Modify: `packages/web-shell/schema.sql` (fim do arquivo)
- Modify: `packages/web-shell/scripts/migrate.mjs` (lista de migrações, ~L27–60)
- Test: `packages/web-shell/lib/sql-statements.test.js` já cobre o divisor; teste novo: `packages/web-shell/migrations/challenge-jobs.migration.test.js`

**Interfaces:**
- Produces: tabela `challenge_jobs` com as colunas da spec 4.2 e `CHECK` de status.

- [ ] **Step 1: Teste que a migração declara tudo que a spec exige**

```js
// packages/web-shell/migrations/challenge-jobs.migration.test.js
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(new URL('./2026-09-08-challenge-jobs.sql', import.meta.url), 'utf8');

describe('challenge_jobs migration', () => {
  it('creates the table with every column and status the spec names', () => {
    for (const col of ['user_id', 'board_id', 'node_id', 'purpose', 'target_url', 'generation', 'status',
      'bb_session_id', 'bb_page_id', 'idem_key', 'human_deadline_at', 'session_expires_at',
      'lease_until', 'lease_owner', 'error_code']) {
      expect(sql, col).toContain(col);
    }
    for (const st of ['verifying', 'needs_human', 'ready', 'capturing', 'committing', 'succeeded',
      'failed', 'expired', 'cancelled', 'unsupported']) {
      expect(sql, st).toContain(`'${st}'`);
    }
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS challenge_jobs/);
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS .*challenge_jobs.*user_id/);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd packages/web-shell && bun run vitest run migrations/challenge-jobs.migration.test.js`
Expected: FAIL (arquivo não existe).

- [ ] **Step 3: Escrever a migração**

```sql
-- packages/web-shell/migrations/2026-09-08-challenge-jobs.sql
-- Spec 2026-09-08-challenge-remote-browser-design §4.2: job persistido para
-- sites com verificação de bot. NENHUM request espera uma pessoa — o estado
-- vive aqui. Tudo ADITIVO.
CREATE TABLE IF NOT EXISTS challenge_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  board_id UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  node_id UUID NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  purpose VARCHAR(12) NOT NULL CHECK (purpose IN ('reference','edit')),
  target_url TEXT NOT NULL,                       -- imutável desde a criação
  generation INTEGER NOT NULL DEFAULT 1,          -- cerca: commit só com a geração corrente
  status VARCHAR(16) NOT NULL DEFAULT 'verifying' CHECK (status IN (
    'verifying','needs_human','ready','capturing','committing','succeeded',
    'failed','expired','cancelled','unsupported')),
  bb_session_id TEXT,                             -- id do vendor; NUNCA connectUrl/URLs de visualizador
  bb_page_id TEXT,
  idem_key TEXT,                                  -- etiqueta de idempotência do Edit
  human_deadline_at TIMESTAMPTZ,
  session_expires_at TIMESTAMPTZ,
  lease_until TIMESTAMPTZ,                        -- trava curta de controlador
  lease_owner TEXT,
  error_code VARCHAR(40),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_challenge_jobs_user_id_status ON challenge_jobs(user_id, status);
CREATE INDEX IF NOT EXISTS idx_challenge_jobs_open ON challenge_jobs(status) WHERE status IN ('verifying','needs_human','ready','capturing','committing');
```

Acrescentar o MESMO bloco ao fim de `schema.sql` (o schema roda em todo boot; `IF NOT EXISTS` é idempotente). Em `scripts/migrate.mjs`, adicionar à lista:

```js
{
  arquivo: '2026-09-08-challenge-jobs.sql',
  falta: (r) => ({ tabelas: ['challenge_jobs'].filter((t) => !r.tabelas.has(t)) }),
},
```

(seguir o formato exato dos itens vizinhos — o predicado devolve o que FALTA; vazio = já aplicada).

- [ ] **Step 4: Rodar e ver passar**

Run: `cd packages/web-shell && bun run vitest run migrations/challenge-jobs.migration.test.js scripts` (se existir teste do migrate) 
Expected: PASS.

- [ ] **Step 5: Aplicar no banco de dev e commitar**

Run: `cd packages/web-shell && node scripts/migrate.mjs --list` → deve listar só `2026-09-08-challenge-jobs.sql`; depois `node scripts/migrate.mjs` (aplica). Conferir `--list` vazio.

```bash
git add packages/web-shell/migrations/2026-09-08-challenge-jobs.sql packages/web-shell/migrations/challenge-jobs.migration.test.js packages/web-shell/schema.sql packages/web-shell/scripts/migrate.mjs
git commit -m "feat(challenge): challenge_jobs table — persisted state so no request waits for a person"
```

---

### Task 2: Cliente REST do Browserbase

**Files:**
- Create: `packages/web-shell/lib/challenge/browserbase-client.js`
- Test: `packages/web-shell/lib/challenge/browserbase-client.test.js`

**Interfaces:**
- Produces: `createBrowserbaseClient({ apiKey, projectId, fetchImpl }) → { createSession({targetUrl, proxy}) → {id, connectUrl, expiresAt}, liveUrls(sessionId) → {pages:[{id,url,debuggerFullscreenUrl}]}, releaseSession(sessionId) → void }`; `allowedDomainsFor(url) → string[]`; `BrowserbaseError` com `code` (`vendor_unavailable`, `vendor_rejected`).

- [ ] **Step 1: Teste**

```js
// packages/web-shell/lib/challenge/browserbase-client.test.js
import { describe, expect, it, vi } from 'vitest';
import { allowedDomainsFor, createBrowserbaseClient } from './browserbase-client.js';

function fakeFetch(handler) {
  return vi.fn(async (url, init) => {
    const { status = 200, body = {} } = handler(String(url), init) || {};
    return { ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) };
  });
}

describe('browserbase client', () => {
  it('creates a session with the spec settings and never logs the connectUrl', async () => {
    const calls = [];
    const fetchImpl = fakeFetch((url, init) => {
      calls.push({ url, init });
      return { body: { id: 'sess_1', connectUrl: 'wss://connect.browserbase.com?apiKey=SECRET&sessionId=sess_1', expiresAt: '2026-09-08T10:00:00Z' } };
    });
    const client = createBrowserbaseClient({ apiKey: 'k', projectId: 'p', fetchImpl });
    const s = await client.createSession({ targetUrl: 'https://www.example.com/promo' });
    expect(s).toEqual({ id: 'sess_1', connectUrl: expect.stringContaining('sess_1'), expiresAt: '2026-09-08T10:00:00Z' });
    const body = JSON.parse(calls[0].init.body);
    expect(calls[0].url).toBe('https://api.browserbase.com/v1/sessions');
    expect(calls[0].init.headers['x-bb-api-key']).toBe('k');
    expect(body).toMatchObject({
      projectId: 'p', keepAlive: true, timeout: 600,
      browserSettings: { solveCaptchas: true, recordSession: false, logSession: false, viewport: { width: 1440, height: 900 }, allowedDomains: ['example.com'] },
      userMetadata: expect.any(Object),
    });
    expect(body.proxies).toBeUndefined();
  });

  it('sends proxies only when asked', async () => {
    const calls = [];
    const client = createBrowserbaseClient({ apiKey: 'k', projectId: 'p', fetchImpl: fakeFetch((url, init) => { calls.push(init); return { body: { id: 's', connectUrl: 'wss://x', expiresAt: 'e' } }; }) });
    await client.createSession({ targetUrl: 'https://a.b.c.example.org/', proxy: true });
    expect(JSON.parse(calls[0].body).proxies).toBe(true);
  });

  it('returns only page live URLs, and releases with REQUEST_RELEASE', async () => {
    const calls = [];
    const client = createBrowserbaseClient({ apiKey: 'k', projectId: 'p', fetchImpl: fakeFetch((url, init) => {
      calls.push({ url, init });
      if (url.endsWith('/debug')) return { body: { debuggerUrl: 'https://all', wsUrl: 'wss://cdp', pages: [{ id: 'pg', url: 'https://example.com/', debuggerFullscreenUrl: 'https://live/pg', debuggerUrl: 'https://live/pg?nav', title: 't' }] } };
      return { body: {} };
    }) });
    const live = await client.liveUrls('sess_1');
    expect(live).toEqual({ pages: [{ id: 'pg', url: 'https://example.com/', debuggerFullscreenUrl: 'https://live/pg' }] });
    await client.releaseSession('sess_1');
    const rel = calls.find((c) => c.url.endsWith('/sessions/sess_1') && c.init.method === 'POST');
    expect(JSON.parse(rel.init.body)).toEqual({ projectId: 'p', status: 'REQUEST_RELEASE' });
  });

  it('maps vendor failures to typed errors', async () => {
    const client = createBrowserbaseClient({ apiKey: 'k', projectId: 'p', fetchImpl: fakeFetch(() => ({ status: 503, body: { message: 'down' } })) });
    await expect(client.createSession({ targetUrl: 'https://example.com' })).rejects.toMatchObject({ code: 'vendor_unavailable' });
    const client2 = createBrowserbaseClient({ apiKey: 'k', projectId: 'p', fetchImpl: fakeFetch(() => ({ status: 400, body: { message: 'bad' } })) });
    await expect(client2.createSession({ targetUrl: 'https://example.com' })).rejects.toMatchObject({ code: 'vendor_rejected' });
  });

  it('allowedDomainsFor uses the registrable domain', () => {
    expect(allowedDomainsFor('https://www.farmminerals.com/promo')).toEqual(['farmminerals.com']);
    expect(allowedDomainsFor('https://amigosecreto.curriculum.com.br/')).toEqual(['curriculum.com.br']);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** — `bun run vitest run lib/challenge/browserbase-client.test.js` → FAIL (módulo não existe).

- [ ] **Step 3: Implementar**

```js
// packages/web-shell/lib/challenge/browserbase-client.js
// REST do Browserbase (sem SDK no repo). Spec §4.2/§4.6: uma sessão por job,
// solver ligado, gravação/log desligados, domínio de navegação restrito, e a
// connectUrl / URLs de visualizador NUNCA entram em log — são segredos portadores.
const API = 'https://api.browserbase.com/v1';
const SESSION_TIMEOUT_S = 600; // humano (≤5 min) + partida + captura (~3 min)

export class BrowserbaseError extends Error {
  constructor(code, status) { super(`browserbase_${code}`); this.name = 'BrowserbaseError'; this.code = code; this.status = status; }
}

// eTLD+1 simplificado: sufixos de 2 níveis conhecidos (com.br, co.uk, …)
// mantêm 3 rótulos; o resto, 2. Suficiente para restringir navegação principal
// (o vendor já libera subdomínios sozinho).
const TWO_LEVEL = new Set(['com.br', 'co.uk', 'com.au', 'co.jp', 'com.mx', 'com.ar', 'co.nz', 'org.uk', 'net.br', 'org.br']);
export function allowedDomainsFor(url) {
  const host = new URL(url).hostname.toLowerCase();
  const parts = host.split('.');
  const last2 = parts.slice(-2).join('.');
  const keep = TWO_LEVEL.has(last2) ? 3 : 2;
  return [parts.slice(-keep).join('.')];
}

export function createBrowserbaseClient({ apiKey, projectId, fetchImpl = fetch } = {}) {
  if (!apiKey || !projectId) throw new BrowserbaseError('not_configured');
  const headers = { 'x-bb-api-key': apiKey, 'content-type': 'application/json' };
  async function call(path, init) {
    let res;
    try { res = await fetchImpl(`${API}${path}`, { ...init, headers }); }
    catch { throw new BrowserbaseError('vendor_unavailable'); }
    if (res.status >= 500 || res.status === 429) throw new BrowserbaseError('vendor_unavailable', res.status);
    if (!res.ok) throw new BrowserbaseError('vendor_rejected', res.status);
    return res.json();
  }
  return {
    async createSession({ targetUrl, proxy = false, jobId = null }) {
      const body = {
        projectId, keepAlive: true, timeout: SESSION_TIMEOUT_S,
        browserSettings: {
          solveCaptchas: true, recordSession: false, logSession: false,
          viewport: { width: 1440, height: 900 },
          allowedDomains: allowedDomainsFor(targetUrl),
        },
        userMetadata: { uncraft: 'challenge-job', jobId },
        ...(proxy ? { proxies: true } : {}),
      };
      const j = await call('/sessions', { method: 'POST', body: JSON.stringify(body) });
      return { id: j.id, connectUrl: j.connectUrl, expiresAt: j.expiresAt };
    },
    async liveUrls(sessionId) {
      const j = await call(`/sessions/${encodeURIComponent(sessionId)}/debug`, { method: 'GET' });
      // Só o necessário por página — nunca wsUrl/debuggerUrl da sessão inteira.
      return { pages: (j.pages || []).map((p) => ({ id: p.id, url: p.url, debuggerFullscreenUrl: p.debuggerFullscreenUrl })) };
    },
    async releaseSession(sessionId) {
      await call(`/sessions/${encodeURIComponent(sessionId)}`, { method: 'POST', body: JSON.stringify({ projectId, status: 'REQUEST_RELEASE' }) });
    },
  };
}

export function browserbaseFromEnv(env = process.env) {
  if (!env.BROWSERBASE_API_KEY || !env.BROWSERBASE_PROJECT_ID) return null;
  return createBrowserbaseClient({ apiKey: env.BROWSERBASE_API_KEY, projectId: env.BROWSERBASE_PROJECT_ID });
}
```

- [ ] **Step 4: Rodar e ver passar** — mesmo comando → PASS (5 testes).

- [ ] **Step 5: Commit**

```bash
git add packages/web-shell/lib/challenge/browserbase-client.js packages/web-shell/lib/challenge/browserbase-client.test.js
git commit -m "feat(challenge): Browserbase REST client — one session per job, solver on, recording off, live URLs are secrets"
```

---

### Task 3: Sessão emprestada + verificação do alvo

**Files:**
- Create: `packages/web-shell/lib/challenge/borrowed-session.js`
- Create: `packages/web-shell/lib/challenge/verify.js`
- Test: `packages/web-shell/lib/challenge/verify.integration.test.js` (Chromium real, servidor local)

**Interfaces:**
- Consumes: `detectChallengePage(page, {strict:true})` de `lib/snapshot.js`.
- Produces: `withBorrowedSession(connectUrl, fn, {chromium}) → fn({browser, context, page, owned:false})` (desconecta em `finally`, nunca `REQUEST_RELEASE`); `verifyTarget({page, url, toleranceMs, cancelled}) → {verdict:'clean'|'needs_human'|'unsupported', kind?, signals?}`.

- [ ] **Step 1: Teste de integração (sem vendor: `connectOverCDP` num Chromium local lançado com `--remote-debugging-port`)**

```js
// packages/web-shell/lib/challenge/verify.integration.test.js
import { createServer } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium } from 'playwright-core';
import { withBorrowedSession } from './borrowed-session.js';
import { verifyTarget } from './verify.js';

let server, origin, browserServer, hits = { gate: 0 };
const CLEAN = '<!doctype html><title>real</title><body><h1>Real page with enough text to be real and not an interstitial</h1><p>Lorem ipsum dolor sit amet consectetur.</p></body>';
const GATE = '<!doctype html><title>Just a moment...</title><body><div id="challenge-running">x</div><script>setTimeout(()=>location.reload(),300)</script></body>';
const DENIED = '<!doctype html><title>Access denied</title><body>Access denied — reference #123</body>';

beforeAll(async () => {
  server = createServer((req, res) => {
    const p = req.url.split('?')[0];
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    if (p === '/clean') return res.end(CLEAN);
    if (p === '/gate-clears') { hits.gate += 1; return res.end(hits.gate < 3 ? GATE : CLEAN); }
    if (p === '/gate-forever') return res.end(GATE);
    if (p === '/denied') return res.end(DENIED);
    res.end(CLEAN);
  });
  await new Promise((d) => server.listen(0, '127.0.0.1', d));
  origin = `http://127.0.0.1:${server.address().port}`;
  browserServer = await chromium.launchServer({ headless: true });
});
afterAll(async () => { await browserServer.close(); await new Promise((d) => server.close(d)); });

describe('borrowed session + verifyTarget', () => {
  it('uses the session page, and does not kill the browser on return', async () => {
    const r = await withBorrowedSession(browserServer.wsEndpoint(), async ({ page, owned }) => {
      expect(owned).toBe(false);
      await page.goto(`${origin}/clean`);
      return page.title();
    }, { connect: (ws) => chromium.connect(ws) });
    expect(r).toBe('real');
    // the browser server is still alive: a second borrow works
    const again = await withBorrowedSession(browserServer.wsEndpoint(), async ({ page }) => { await page.goto(`${origin}/clean`); return page.title(); }, { connect: (ws) => chromium.connect(ws) });
    expect(again).toBe('real');
  });

  it('clean page → clean; self-clearing interstitial within tolerance → clean', async () => {
    await withBorrowedSession(browserServer.wsEndpoint(), async ({ page }) => {
      expect((await verifyTarget({ page, url: `${origin}/clean`, toleranceMs: 3000 })).verdict).toBe('clean');
      expect((await verifyTarget({ page, url: `${origin}/gate-clears`, toleranceMs: 6000 })).verdict).toBe('clean');
    }, { connect: (ws) => chromium.connect(ws) });
  }, 40_000);

  it('interstitial that never clears → needs_human; hard denial → unsupported', async () => {
    await withBorrowedSession(browserServer.wsEndpoint(), async ({ page }) => {
      const v = await verifyTarget({ page, url: `${origin}/gate-forever`, toleranceMs: 2500 });
      expect(v).toMatchObject({ verdict: 'needs_human', kind: 'cloudflare' });
      expect((await verifyTarget({ page, url: `${origin}/denied`, toleranceMs: 1500 })).verdict).toBe('unsupported');
    }, { connect: (ws) => chromium.connect(ws) });
  }, 30_000);
});
```

- [ ] **Step 2: Rodar e ver falhar** — `bun run vitest run lib/challenge/verify.integration.test.js` → FAIL (módulos não existem).

- [ ] **Step 3: Implementar**

```js
// packages/web-shell/lib/challenge/borrowed-session.js
import { chromium as chromiumPadrao } from 'playwright-core';

// Sessão EMPRESTADA: quem chama recebe o contexto/página onde a liberação da
// verificação vive (contexto novo a descartaria — Astra, advise 2026-09-08).
// Ao sair, só DESCONECTA: liberar a sessão no vendor é responsabilidade do job.
export async function withBorrowedSession(connectUrl, fn, { connect } = {}) {
  const conectar = connect || ((ws) => chromiumPadrao.connectOverCDP(ws));
  const browser = await conectar(connectUrl);
  try {
    const context = browser.contexts()[0] || await browser.newContext();
    const page = context.pages()[0] || await context.newPage();
    return await fn({ browser, context, page, owned: false });
  } finally {
    // Playwright: close() num navegador CONECTADO só desconecta o cliente.
    await browser.close().catch(() => {});
  }
}
```

```js
// packages/web-shell/lib/challenge/verify.js
import { detectChallengePage } from '../snapshot.js';

// Veredito sobre o alvo numa página já aberta (spec §4.1). Modo estrito do
// detector: null = olhei e está limpo; undefined = não consegui olhar (não libera).
export async function verifyTarget({ page, url, toleranceMs = 40_000, cancelled = () => false }) {
  await page.goto(url, { waitUntil: 'load', timeout: 60_000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const limite = Date.now() + toleranceMs;
  let ultimo = null;
  for (;;) {
    const carregou = await page.waitForLoadState('load', { timeout: 2000 }).then(() => true, () => false);
    const v = carregou ? await detectChallengePage(page, { strict: true }) : undefined;
    if (v === null) return { verdict: 'clean' };
    if (v) ultimo = v;
    if (Date.now() >= limite || cancelled()) break;
    await page.waitForTimeout(500);
  }
  const kind = ultimo?.kind || 'generic_challenge';
  const signals = ultimo?.signals || ['uninspectable'];
  // Bloqueio duro: não há captcha para resolver — 'Access denied', Akamai/PX
  // sem widget. O que sobra é challenge acionável → humano.
  const hard = signals.some((s) => /^title:(Access denied|Attention Required)/i.test(s)) || kind === 'akamai' || kind === 'perimeterx';
  return { verdict: hard ? 'unsupported' : 'needs_human', kind, signals };
}
```

- [ ] **Step 4: Rodar e ver passar** — PASS (3 testes).

- [ ] **Step 5: Commit**

```bash
git add packages/web-shell/lib/challenge/borrowed-session.js packages/web-shell/lib/challenge/verify.js packages/web-shell/lib/challenge/verify.integration.test.js
git commit -m "feat(challenge): borrowed session (disconnect, never kill) + strict verdict clean/needs_human/unsupported"
```

---

### Task 4: Produtores com sessão emprestada (`captureNativeBundle`, `captureSnapshot`)

**Files:**
- Modify: `packages/web-shell/lib/native-clone/capture-bundle.js` (`captureNativeBundle` início/`finally`; `buscarUmaVez`; constante `CHALLENGE_TOLERANCIA_MS`)
- Modify: `packages/web-shell/lib/snapshot.js` (`captureSnapshot` L476–507 e `finally` L799–800)
- Test: `packages/web-shell/lib/native-clone/capture-borrowed.integration.test.js`

**Interfaces:**
- Consumes: `withBorrowedSession` (Task 3).
- Produces: `captureNativeBundle(url, { session?: {browser,context,page,owned:false}, challengeToleranceMs? })`; `captureSnapshot(url, { session? })`. Contrato de saída INALTERADO.

- [ ] **Step 1: Teste (Chromium real via `launchServer`, servidor local com cookie)**

```js
// packages/web-shell/lib/native-clone/capture-borrowed.integration.test.js
import { createServer } from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { chromium } from 'playwright-core';

vi.mock('node:dns/promises', async (importOriginal) => {
  const actual = await importOriginal();
  const lookup = async () => [{ address: '93.184.216.34', family: 4 }];
  return { ...actual, default: { ...(actual.default || {}), lookup }, lookup };
});
const { captureNativeBundle } = await import('./capture-bundle.js');
const { captureSnapshot } = await import('../snapshot.js');
const { withBorrowedSession } = await import('../challenge/borrowed-session.js');

let server, origin, browserServer;
const seen = { cookieOnImage: null, hits: 0 };
const HTML = '<!doctype html><html><head><title>site</title></head><body><h1>Real site with text enough to be real and not an interstitial</h1><p>lorem ipsum dolor sit amet</p><img src="/late.png" width="8" height="8"></body></html>';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

beforeAll(async () => {
  server = createServer((req, res) => {
    const p = req.url.split('?')[0];
    if (p === '/') { res.writeHead(200, { 'content-type': 'text/html', 'set-cookie': 'clearance=yes; Path=/' }); return res.end(HTML); }
    if (p === '/late.png') {
      seen.hits += 1;
      // 1º pedido (navegador): resposta que nunca termina → vai para a repescagem.
      if (seen.hits === 1) { res.writeHead(200, { 'content-type': 'image/png' }); res.flushHeaders(); return; }
      seen.cookieOnImage = req.headers.cookie || null;
      res.writeHead(200, { 'content-type': 'image/png', 'content-length': PNG.length }); return res.end(PNG);
    }
    res.writeHead(404); res.end();
  });
  await new Promise((d) => server.listen(0, '127.0.0.1', d));
  origin = `http://localhost:${server.address().port}`;
  browserServer = await chromium.launchServer({ headless: true });
});
afterAll(async () => { await browserServer.close(); await new Promise((d) => server.close(d)); });

describe('producers with a borrowed session', () => {
  it('captureNativeBundle uses the given page, retries THROUGH the browser (cookie present), and does not kill the browser', async () => {
    process.env.UNCRAFT_CAPTURE_COLLECT_CAP_MS = '700';
    const out = await withBorrowedSession(browserServer.wsEndpoint(), (session) =>
      captureNativeBundle(`${origin}/`, { session, onProgress: () => {} }), { connect: (ws) => chromium.connect(ws) });
    expect(out.bundle.entryPath).toMatch(/index\.html$/);
    // presos: o pedido do navegador ficou em voo → NÃO é re-pedido pela repescagem.
    // (o teste de hazards cobre isso). Aqui o que importa: o navegador segue vivo.
    const alive = await withBorrowedSession(browserServer.wsEndpoint(), async ({ page }) => { await page.goto(`${origin}/`); return page.title(); }, { connect: (ws) => chromium.connect(ws) });
    expect(alive).toBe('site');
  }, 60_000);

  it('retry lane goes through context.request when a session is borrowed (session cookie reaches the server)', async () => {
    // Página cujo asset falha no navegador mas é recuperável: força a repescagem.
    seen.hits = 0; seen.cookieOnImage = null;
    process.env.UNCRAFT_CAPTURE_COLLECT_CAP_MS = '20000';
    const out = await withBorrowedSession(browserServer.wsEndpoint(), async (session) => {
      // Pré-aquece o cookie no contexto emprestado
      await session.page.goto(`${origin}/`);
      return captureNativeBundle(`${origin}/?v=2`, { session, onProgress: () => {} });
    }, { connect: (ws) => chromium.connect(ws) });
    // A 1ª resposta nunca termina; a coleta com teto 20s não a espera além do teto;
    // como ela está "presa", não vai à repescagem — então a prova do cookie vem do
    // caminho de repescagem explícito abaixo.
    expect(out.relatorio.totalDescartados).toBeGreaterThanOrEqual(1);
  }, 60_000);

  it('captureSnapshot uses the borrowed page and leaves the browser alive', async () => {
    const snap = await withBorrowedSession(browserServer.wsEndpoint(), (session) =>
      captureSnapshot(`${origin}/`, { session }), { connect: (ws) => chromium.connect(ws) });
    expect(snap.html).toContain('Real site');
    const alive = await withBorrowedSession(browserServer.wsEndpoint(), async ({ page }) => { await page.goto(`${origin}/`); return page.title(); }, { connect: (ws) => chromium.connect(ws) });
    expect(alive).toBe('site');
  }, 60_000);
});
```

> Nota de honestidade: a prova do **cookie na repescagem** exige um asset que o navegador NÃO consiga ler mas a repescagem consiga (ex.: resposta `206` parcial). Adicionar no Step 3 um endpoint `/partial.png` que responde `206 Content-Range: bytes 0-3/68` ao 1º pedido e `200` completo aos seguintes, e um 4º teste: `expect(seen.cookieOnImage).toContain('clearance=yes')` após a captura com sessão emprestada. Sem esse teste, a afirmação "repescagem pelo navegador" não está provada.

- [ ] **Step 2: Rodar e ver falhar** — RED (opção `session` ignorada: o produtor lança navegador próprio; `captureSnapshot` idem).

- [ ] **Step 3: Implementar**

Em `capture-bundle.js`:

```js
// assinatura
export async function captureNativeBundle(url, opts = {}) {
  const { onProgress = () => {}, viewport = { width: 1440, height: 900 }, chromium, signal, session = null,
    challengeToleranceMs = CHALLENGE_TOLERANCIA_MS } = opts;
  …
  onProgress({ etapa: 'launching' });
  // Sessão EMPRESTADA (spec §4.4): usa o navegador/contexto/página já verificados;
  // não fecha o que não é dele. Sem `session`, comportamento idêntico ao de sempre.
  const emprestada = Boolean(session && session.page);
  const browser = emprestada ? session.browser : await abrirNavegador(chromium);
  const fecharSePropria = async () => { if (!emprestada) await browser.close().catch(() => {}); };
  …
  const aoCancelar = () => { cancelado = true; fecharSePropria(); };
  if (signal) {
    if (signal.aborted) { await fecharSePropria(); throw Object.assign(new Error('native_bundle_aborted'), { code: 'aborted' }); }
    signal.addEventListener('abort', aoCancelar, { once: true });
  }
  try {
    const context = emprestada ? session.context : await browser.newContext({ viewport });
    const page = emprestada ? session.page : await context.newPage();
    if (emprestada) await page.setViewportSize(viewport).catch(() => {});
    …
```

- substituir os dois `CHALLENGE_TOLERANCIA_MS` do loop de tolerância por `challengeToleranceMs`;
- no `finally` do fim: `await fecharSePropria();` em vez de `await browser.close().catch(() => {})`; o `await context.close()` antes de `finalizing` vira `if (!emprestada) await context.close();`;
- `measureBundleSimilarity({ browser, … })` recebe `browser` só quando `!emprestada` (senão `null` → similarity `null`, fail-open já existente);
- em `buscarUmaVez`, dentro do laço de saltos, trocar o `fetch` do Node por um adaptador:

```js
// Com sessão emprestada a repescagem passa pelo NAVEGADOR (mesmo jar de cookies
// e mesmo IP da verificação — o fetch do Node não tem nem um nem outro; Astra).
// Sem streaming aqui: `body()` bufferiza — o teto de tamanho vale ANTES (content-length)
// e DEPOIS (byteLength); resíduo nomeado: pico de memória de UM corpo mentiroso.
const pedir = emprestada
  ? async (alvo, sinal) => {
      const r = await context.request.fetch(alvo, { maxRedirects: 0, timeout: 12000 });
      const h = r.headers();
      return {
        status: r.status(),
        headers: { get: (k) => h[k.toLowerCase()] ?? null },
        ok: r.ok(),
        body: r.ok() ? { getReader: () => { let done = false; return { read: async () => { if (done) return { done: true }; done = true; const b = await r.body(); return { done: false, value: new Uint8Array(b) }; }, cancel: async () => {} }; } } : null,
      };
    }
  : (alvo, sinal) => fetch(alvo, { redirect: 'manual', signal: sinal });
const resposta = await pedir(alvo, parada.signal);
```

(o restante do laço — leitura por `getReader`, reservas, tetos — fica igual; o adaptador expõe a mesma forma.)

Em `snapshot.js`, `captureSnapshot`:

```js
export async function captureSnapshot(url, opts = {}) {
  const viewport = opts.viewport || { width: 1280, height: 800 };
  const { onProgress = () => {}, session = null } = opts;
  const emprestada = Boolean(session && session.page);
  let browser, context, page;
  try {
    if (emprestada) {
      browser = session.browser; context = session.context; page = session.page;
      await page.setViewportSize(viewport).catch(() => {});
    } else {
      browser = await launchBrowser();
      context = await browser.newContext({ viewport, userAgent: REAL_UA, locale: 'en-US', timezoneId: 'America/Sao_Paulo' });
      … (route de publicNetworkOnly como hoje)
      page = await context.newPage();
    }
    …
  } finally {
    if (!emprestada) {
      if (context) await context.close().catch(() => {});
      if (browser) await browser.close().catch(() => {});
    }
  }
}
```

(`publicNetworkOnly` com sessão emprestada: aplicar `context.route` igualmente — o contexto é o da sessão; remover a rota no `finally` com `context.unroute('**/*')` quando emprestada.)

- [ ] **Step 4: Rodar e ver passar** — os testes novos + `bun run vitest run lib/native-clone lib/snapshot.test.js` → todos PASS (o caminho sem `session` é byte-idêntico: os testes de hazards/closure continuam verdes).

- [ ] **Step 5: Auditoria Astra + commit**

```bash
cd /Users/adilsonporto/Desktop/IA/Uncraft && { echo "# Producers with a BORROWED session (spec §4.4). Verify: close/cancel ownership, retry lane through context.request (redirect per hop, size caps without streaming), viewport, similarity fail-open, unchanged behaviour without session."; git diff -- packages/web-shell/lib/native-clone/capture-bundle.js packages/web-shell/lib/snapshot.js; cat packages/web-shell/lib/native-clone/capture-borrowed.integration.test.js; } | ~/.claude/bin/codex-adversary.sh --mode prose --model gpt-6-astra --effort high --timeout 1500 --focus "ownership/close paths and the retry adapter"
git add packages/web-shell/lib/native-clone/capture-bundle.js packages/web-shell/lib/snapshot.js packages/web-shell/lib/native-clone/capture-borrowed.integration.test.js
git commit -m "feat(native-clone): producers accept a borrowed (verified) session — reuse context/page, never close what they don't own, retry through the browser"
```

---

### Task 5: Job store (SQL) — transições cercadas, trava, varredura

**Files:**
- Create: `packages/web-shell/lib/challenge/job-store.js`
- Test: `packages/web-shell/lib/challenge/job-store.test.js`

**Interfaces:**
- Produces: `createJob({sql, userId, boardId, nodeId, purpose, targetUrl, idemKey}) → row`; `getOwnedJob({sql, userId, jobId}) → row|null`; `transition({sql, jobId, from, to, generation, patch}) → row|null` (UPDATE … WHERE status=from AND generation=generation — devolve null se a cerca falhar); `acquireLease({sql, jobId, owner, ttlMs}) → boolean`; `releaseLease({sql, jobId, owner})`; `bumpGeneration({sql, jobId}) → row`; `listExpired({sql, now}) → rows` (não-terminais com `session_expires_at < now` ou `human_deadline_at < now` em `needs_human`, ou `lease_until < now` em `capturing`/`committing`); `TERMINAL = new Set([...])`.

- [ ] **Step 1: Teste (sql falso que grava queries e devolve linhas programadas)**

```js
// packages/web-shell/lib/challenge/job-store.test.js
import { describe, expect, it } from 'vitest';
import { TERMINAL, acquireLease, createJob, getOwnedJob, transition } from './job-store.js';

function fakeSql(rowsByCall = []) {
  const calls = [];
  const sql = (strings, ...values) => {
    const text = strings.join('?');
    calls.push({ text, values });
    const next = rowsByCall.shift();
    return Promise.resolve(next ?? []);
  };
  sql._calls = calls;
  return sql;
}

describe('challenge job store', () => {
  it('createJob inserts with purpose, immutable target and generation 1', async () => {
    const sql = fakeSql([[{ id: 'j1', status: 'verifying', generation: 1 }]]);
    const row = await createJob({ sql, userId: 42, boardId: 'b', nodeId: 'n', purpose: 'edit', targetUrl: 'https://x.com/', idemKey: 'k' });
    expect(row.id).toBe('j1');
    expect(sql._calls[0].text).toMatch(/INSERT INTO challenge_jobs/);
    expect(sql._calls[0].values).toEqual(expect.arrayContaining([42, 'b', 'n', 'edit', 'https://x.com/', 'k']));
  });

  it('getOwnedJob filters by user_id (never by id alone)', async () => {
    const sql = fakeSql([[]]);
    expect(await getOwnedJob({ sql, userId: 42, jobId: 'j1' })).toBeNull();
    expect(sql._calls[0].text).toMatch(/WHERE id = \? AND user_id = \?/);
  });

  it('transition is fenced by status AND generation; a lost fence returns null', async () => {
    const sql = fakeSql([[{ id: 'j1', status: 'capturing', generation: 1 }], []]);
    const ok = await transition({ sql, jobId: 'j1', from: 'ready', to: 'capturing', generation: 1, patch: { lease_owner: 'w1' } });
    expect(ok.status).toBe('capturing');
    expect(sql._calls[0].text).toMatch(/WHERE id = \? AND status = \? AND generation = \?/);
    const lost = await transition({ sql, jobId: 'j1', from: 'ready', to: 'capturing', generation: 1 });
    expect(lost).toBeNull();
  });

  it('acquireLease only wins when the previous lease is gone', async () => {
    const sql = fakeSql([[{ id: 'j1' }], []]);
    expect(await acquireLease({ sql, jobId: 'j1', owner: 'w1', ttlMs: 30000 })).toBe(true);
    expect(sql._calls[0].text).toMatch(/lease_until IS NULL OR lease_until < NOW\(\)/);
    expect(await acquireLease({ sql, jobId: 'j1', owner: 'w2', ttlMs: 30000 })).toBe(false);
  });

  it('names the terminal states', () => {
    expect([...TERMINAL].sort()).toEqual(['cancelled', 'expired', 'failed', 'succeeded', 'unsupported']);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** — RED.

- [ ] **Step 3: Implementar**

```js
// packages/web-shell/lib/challenge/job-store.js
// SQL de challenge_jobs (spec §4.2). Toda leitura é pelo DONO; toda transição é
// CERCADA por status + geração (um worker vencido não publica por cima de uma
// retomada); a trava é curta e por dono (um controlador por vez no navegador).
export const TERMINAL = new Set(['succeeded', 'failed', 'expired', 'cancelled', 'unsupported']);
export const OPEN = ['verifying', 'needs_human', 'ready', 'capturing', 'committing'];

export async function createJob({ sql, userId, boardId, nodeId, purpose, targetUrl, idemKey = null }) {
  const [row] = await sql`
    INSERT INTO challenge_jobs (user_id, board_id, node_id, purpose, target_url, idem_key)
    VALUES (${userId}, ${boardId}, ${nodeId}, ${purpose}, ${targetUrl}, ${idemKey})
    RETURNING *`;
  return row;
}

export async function getOwnedJob({ sql, userId, jobId }) {
  const rows = await sql`SELECT * FROM challenge_jobs WHERE id = ${jobId} AND user_id = ${userId}`;
  return rows[0] || null;
}

const PATCHABLE = new Set(['bb_session_id', 'bb_page_id', 'human_deadline_at', 'session_expires_at', 'lease_until', 'lease_owner', 'error_code']);

export async function transition({ sql, jobId, from, to, generation, patch = {} }) {
  // Colunas do patch são de um conjunto FECHADO (nunca nome vindo do cliente).
  const p = {};
  for (const [k, v] of Object.entries(patch)) if (PATCHABLE.has(k)) p[k] = v;
  const rows = await sql`
    UPDATE challenge_jobs
       SET status = ${to},
           bb_session_id = COALESCE(${p.bb_session_id ?? null}, bb_session_id),
           bb_page_id = COALESCE(${p.bb_page_id ?? null}, bb_page_id),
           human_deadline_at = COALESCE(${p.human_deadline_at ?? null}, human_deadline_at),
           session_expires_at = COALESCE(${p.session_expires_at ?? null}, session_expires_at),
           lease_until = ${p.lease_until ?? null},
           lease_owner = ${p.lease_owner ?? null},
           error_code = COALESCE(${p.error_code ?? null}, error_code),
           updated_at = NOW()
     WHERE id = ${jobId} AND status = ${from} AND generation = ${generation}
     RETURNING *`;
  return rows[0] || null;
}

export async function acquireLease({ sql, jobId, owner, ttlMs }) {
  const rows = await sql`
    UPDATE challenge_jobs
       SET lease_owner = ${owner}, lease_until = NOW() + (${Math.ceil(ttlMs / 1000)} || ' seconds')::interval, updated_at = NOW()
     WHERE id = ${jobId} AND (lease_until IS NULL OR lease_until < NOW())
     RETURNING id`;
  return rows.length === 1;
}

export async function releaseLease({ sql, jobId, owner }) {
  await sql`UPDATE challenge_jobs SET lease_until = NULL, lease_owner = NULL, updated_at = NOW() WHERE id = ${jobId} AND lease_owner = ${owner}`;
}

export async function bumpGeneration({ sql, jobId }) {
  const rows = await sql`UPDATE challenge_jobs SET generation = generation + 1, updated_at = NOW() WHERE id = ${jobId} RETURNING *`;
  return rows[0] || null;
}

export async function listExpired({ sql, limit = 50 }) {
  return sql`
    SELECT * FROM challenge_jobs
     WHERE status IN ('verifying','needs_human','ready','capturing','committing')
       AND (session_expires_at < NOW()
            OR (status = 'needs_human' AND human_deadline_at < NOW())
            OR (status IN ('capturing','committing') AND lease_until < NOW()))
     ORDER BY updated_at ASC
     LIMIT ${limit}`;
}

export async function countOpenForUser({ sql, userId }) {
  const [r] = await sql`SELECT COUNT(*)::int AS n FROM challenge_jobs WHERE user_id = ${userId} AND status IN ('verifying','needs_human','ready','capturing','committing')`;
  return r?.n || 0;
}
export async function countOpenSessions({ sql }) {
  const [r] = await sql`SELECT COUNT(*)::int AS n FROM challenge_jobs WHERE bb_session_id IS NOT NULL AND status IN ('verifying','needs_human','ready','capturing','committing')`;
  return r?.n || 0;
}
export async function countTodayForUser({ sql, userId, purpose }) {
  const [r] = await sql`SELECT COUNT(*)::int AS n FROM challenge_jobs WHERE user_id = ${userId} AND purpose = ${purpose} AND created_at > NOW() - interval '1 day'`;
  return r?.n || 0;
}
export async function countTodaySessions({ sql }) {
  const [r] = await sql`SELECT COUNT(*)::int AS n FROM challenge_jobs WHERE bb_session_id IS NOT NULL AND created_at > NOW() - interval '1 day'`;
  return r?.n || 0;
}
```

- [ ] **Step 4: Rodar e ver passar** — PASS.

- [ ] **Step 5: Auditoria Astra (cerca, trava, patch fechado) + commit**

```bash
git add packages/web-shell/lib/challenge/job-store.js packages/web-shell/lib/challenge/job-store.test.js
git commit -m "feat(challenge): job store — owner-scoped reads, status+generation fenced transitions, short controller lease, expiry listing"
```

---

### Task 6: Cotas e disjuntores

**Files:**
- Create: `packages/web-shell/lib/challenge/quotas.js`
- Test: `packages/web-shell/lib/challenge/quotas.test.js`

**Interfaces:**
- Consumes: `countOpenForUser`, `countOpenSessions`, `countTodayForUser`, `countTodaySessions` (Task 5); `getBalance` (`lib/billing/ledger.js`), `estimateOp('clone.edit')` (`lib/billing/pricing.js`).
- Produces: `checkChallengeQuota({sql, userId, purpose, env}) → {ok:true} | {ok:false, code:'daily_free_quota'|'too_many_open'|'verification_busy'|'spend_breaker'|'insufficient_credits', status:402|429, estimate?, balance?}`.

- [ ] **Step 1: Teste**

```js
// packages/web-shell/lib/challenge/quotas.test.js
import { describe, expect, it, vi } from 'vitest';
vi.mock('./job-store.js', () => ({
  countOpenForUser: vi.fn(), countOpenSessions: vi.fn(), countTodayForUser: vi.fn(), countTodaySessions: vi.fn(),
}));
vi.mock('../billing/ledger.js', () => ({ getBalance: vi.fn() }));
const store = await import('./job-store.js');
const { getBalance } = await import('../billing/ledger.js');
const { checkChallengeQuota } = await import('./quotas.js');

const env = { UNCRAFT_CHALLENGE_DAILY_FREE: '10', UNCRAFT_CHALLENGE_MAX_OPEN: '2', UNCRAFT_CHALLENGE_MAX_SESSIONS: '10', UNCRAFT_CHALLENGE_DAILY_SESSIONS: '200', UNCRAFT_CHALLENGE_EDIT_RESERVED: '3' };
function counts({ open = 0, sessions = 0, today = 0, todaySessions = 0 } = {}) {
  store.countOpenForUser.mockResolvedValue(open); store.countOpenSessions.mockResolvedValue(sessions);
  store.countTodayForUser.mockResolvedValue(today); store.countTodaySessions.mockResolvedValue(todaySessions);
}

describe('checkChallengeQuota', () => {
  it('reference: daily free quota', async () => { counts({ today: 10 }); expect(await checkChallengeQuota({ sql: {}, userId: 1, purpose: 'reference', env })).toMatchObject({ ok: false, code: 'daily_free_quota', status: 429 }); });
  it('too many open jobs', async () => { counts({ open: 2 }); expect((await checkChallengeQuota({ sql: {}, userId: 1, purpose: 'reference', env })).code).toBe('too_many_open'); });
  it('reference cannot take the sessions reserved for edit; edit can', async () => {
    counts({ sessions: 7 });
    expect((await checkChallengeQuota({ sql: {}, userId: 1, purpose: 'reference', env })).code).toBe('verification_busy');
    getBalance.mockResolvedValue(1000);
    expect((await checkChallengeQuota({ sql: {}, userId: 1, purpose: 'edit', env })).ok).toBe(true);
  });
  it('spend breaker closes the whole path', async () => { counts({ todaySessions: 200 }); expect((await checkChallengeQuota({ sql: {}, userId: 1, purpose: 'edit', env })).code).toBe('spend_breaker'); });
  it('edit pre-checks the balance against the clone.edit estimate (402)', async () => {
    counts(); getBalance.mockResolvedValue(5);
    const r = await checkChallengeQuota({ sql: {}, userId: 1, purpose: 'edit', env });
    expect(r).toMatchObject({ ok: false, code: 'insufficient_credits', status: 402, balance: 5 });
    expect(r.estimate).toBeGreaterThan(5);
  });
});
```

- [ ] **Step 2: RED.** `bun run vitest run lib/challenge/quotas.test.js`

- [ ] **Step 3: Implementar**

```js
// packages/web-shell/lib/challenge/quotas.js
// Spec §4.5: cobrar só no sucesso protege o cliente, não o nosso orçamento —
// cotas e disjuntor vêm ANTES de abrir qualquer sessão no vendor.
import { countOpenForUser, countOpenSessions, countTodayForUser, countTodaySessions } from './job-store.js';
import { getBalance } from '../billing/ledger.js';
import { estimateOp } from '../billing/pricing.js';

const num = (env, k, d) => { const n = Number(env[k]); return Number.isFinite(n) && n >= 0 ? n : d; };

export async function checkChallengeQuota({ sql, userId, purpose, env = process.env }) {
  const dailyFree = num(env, 'UNCRAFT_CHALLENGE_DAILY_FREE', 10);
  const maxOpen = num(env, 'UNCRAFT_CHALLENGE_MAX_OPEN', 2);
  const maxSessions = num(env, 'UNCRAFT_CHALLENGE_MAX_SESSIONS', 10);
  const dailySessions = num(env, 'UNCRAFT_CHALLENGE_DAILY_SESSIONS', 200);
  const reservedForEdit = num(env, 'UNCRAFT_CHALLENGE_EDIT_RESERVED', 3);

  if ((await countTodaySessions({ sql })) >= dailySessions) return { ok: false, code: 'spend_breaker', status: 429 };
  if ((await countOpenForUser({ sql, userId })) >= maxOpen) return { ok: false, code: 'too_many_open', status: 429 };
  const sessions = await countOpenSessions({ sql });
  const ceiling = purpose === 'edit' ? maxSessions : Math.max(0, maxSessions - reservedForEdit);
  if (sessions >= ceiling) return { ok: false, code: 'verification_busy', status: 429 };
  if (purpose === 'reference') {
    if ((await countTodayForUser({ sql, userId, purpose: 'reference' })) >= dailyFree) return { ok: false, code: 'daily_free_quota', status: 429 };
    return { ok: true };
  }
  const estimate = estimateOp('clone.edit');
  const balance = await getBalance({ sql, userId });
  if (balance < estimate) return { ok: false, code: 'insufficient_credits', status: 402, estimate, balance };
  return { ok: true, estimate, balance };
}
```

- [ ] **Step 4: GREEN.**

- [ ] **Step 5: Commit** — `git commit -m "feat(challenge): quotas, concurrency ceiling with edit reserve, daily spend breaker, edit balance pre-check"`

---

### Task 7: Serviço do job (orquestração)

**Files:**
- Create: `packages/web-shell/lib/challenge/job-service.js`
- Test: `packages/web-shell/lib/challenge/job-service.test.js`

**Interfaces:**
- Consumes: Tasks 2–6; `reconstructSiteNode` (`lib/deferred-reconstruction.js`, opção `producer`); `captureSnapshot`; `persist` do handoff de referência (rota `/api/snapshot/handoff` — reusar a função que grava o snapshot `source='handoff'`: extrair para `lib/snapshot-persist.js` `persistReferenceSnapshot({sql, userId, nodeId, html, screenshotDataUrl, title})` na Task 7 Step 3, movendo o código de `app/api/snapshot/handoff/route.js` L69–105 sem mudar comportamento).
- Produces:
  - `startJob({sql, userId, node, purpose, idemKey, env, deps}) → {job, status, error?}` — cota → cria job → cria sessão → verificação limitada (≤ `VERIFY_BUDGET_MS = 45_000`) → transiciona para `ready` | `needs_human` (grava `human_deadline_at = now+5min`) | `unsupported`/`failed` (libera sessão).
  - `checkJob({sql, userId, jobId, env, deps}) → {job}` — só em `needs_human`; trava; reconecta; `verifyTarget` com `toleranceMs: 3000`; `ready` ou continua; solta trava.
  - `captureJob({sql, userId, jobId, env, deps, signal}) → {job, result}` — `ready→capturing` cercado; reconecta; `purpose==='edit'` → `reconstructSiteNode({..., idemKey: job.idem_key, op:'clone.edit', reason:'edit', producer: (url, o) => captureNativeBundle(url, {...o, session, challengeToleranceMs: 40_000})})`; `purpose==='reference'` → `captureSnapshot(url, {session})` + `persistReferenceSnapshot`; `committing→succeeded`; libera sessão. Falha → `failed` com `error_code`, libera.
  - `cancelJob({sql, userId, jobId, deps})`; `liveViewFor({job, env, deps}) → {url}|null` (só `needs_human` e `UNCRAFT_CHALLENGE_HUMAN==='1'`); `sweepExpiredJobs({sql, deps}) → {expired}`.
  - `deps = { browserbase, withSession, verify, captureNative, captureSnap, reconstruct, persistReference, now }` — todos injetáveis (testes sem vendor).

- [ ] **Step 1: Teste (tudo injetado; sql falso por chamada como na Task 5)**

```js
// packages/web-shell/lib/challenge/job-service.test.js
import { describe, expect, it, vi } from 'vitest';
vi.mock('./quotas.js', () => ({ checkChallengeQuota: vi.fn(async () => ({ ok: true })) }));
vi.mock('./job-store.js', async (orig) => {
  const actual = await orig();
  return { ...actual, createJob: vi.fn(), getOwnedJob: vi.fn(), transition: vi.fn(), acquireLease: vi.fn(async () => true), releaseLease: vi.fn(), listExpired: vi.fn(async () => []) };
});
const store = await import('./job-store.js');
const { startJob, captureJob, checkJob, liveViewFor, sweepExpiredJobs } = await import('./job-service.js');

const node = { id: 'n1', board_id: 'b1', origin_url: 'https://site.example/' };
function deps(over = {}) {
  return {
    browserbase: { createSession: vi.fn(async () => ({ id: 'sess', connectUrl: 'wss://c', expiresAt: '2030-01-01T00:00:00Z' })), releaseSession: vi.fn(async () => {}), liveUrls: vi.fn(async () => ({ pages: [{ id: 'p', url: 'https://site.example/', debuggerFullscreenUrl: 'https://live/p' }] })) },
    withSession: vi.fn(async (_ws, fn) => fn({ browser: {}, context: {}, page: { title: async () => 't' }, owned: false })),
    verify: vi.fn(async () => ({ verdict: 'clean' })),
    captureNative: vi.fn(async () => ({ kind: 'native', bundle: {}, relatorio: {} })),
    reconstruct: vi.fn(async ({ producer }) => { await producer('https://site.example/', {}); return { ok: true, kind: 'native', credits: 275 }; }),
    captureSnap: vi.fn(async () => ({ html: '<html>x</html>', screenshotDataUrl: null, title: 'T' })),
    persistReference: vi.fn(async () => ({ snapshotId: 's1' })),
    now: () => new Date('2026-09-08T12:00:00Z'),
    ...over,
  };
}

describe('job service', () => {
  it('startJob: clean → ready, session kept alive (not released)', async () => {
    store.createJob.mockResolvedValue({ id: 'j1', status: 'verifying', generation: 1, purpose: 'edit', target_url: node.origin_url });
    store.transition.mockImplementation(async ({ to }) => ({ id: 'j1', status: to, generation: 1 }));
    const d = deps();
    const r = await startJob({ sql: {}, userId: 1, node, purpose: 'edit', idemKey: 'k', env: {}, deps: d });
    expect(r.job.status).toBe('ready');
    expect(d.browserbase.createSession).toHaveBeenCalledWith(expect.objectContaining({ targetUrl: node.origin_url, jobId: 'j1' }));
    expect(d.browserbase.releaseSession).not.toHaveBeenCalled();
  });

  it('startJob: needs_human sets a 5-minute human deadline; unsupported releases the session', async () => {
    store.createJob.mockResolvedValue({ id: 'j2', status: 'verifying', generation: 1, purpose: 'reference', target_url: node.origin_url });
    const patches = [];
    store.transition.mockImplementation(async ({ to, patch }) => { patches.push({ to, patch }); return { id: 'j2', status: to, generation: 1 }; });
    const d = deps({ verify: vi.fn(async () => ({ verdict: 'needs_human', kind: 'cloudflare', signals: [] })) });
    expect((await startJob({ sql: {}, userId: 1, node, purpose: 'reference', env: {}, deps: d })).job.status).toBe('needs_human');
    expect(patches.at(-1).patch.human_deadline_at).toBe('2026-09-08T12:05:00.000Z');
    const d2 = deps({ verify: vi.fn(async () => ({ verdict: 'unsupported', kind: 'akamai', signals: [] })) });
    expect((await startJob({ sql: {}, userId: 1, node, purpose: 'reference', env: {}, deps: d2 })).job.status).toBe('unsupported');
    expect(d2.browserbase.releaseSession).toHaveBeenCalledWith('sess');
  });

  it('startJob: quota failure creates NO job and NO session', async () => {
    const { checkChallengeQuota } = await import('./quotas.js');
    checkChallengeQuota.mockResolvedValueOnce({ ok: false, code: 'verification_busy', status: 429 });
    const d = deps();
    const r = await startJob({ sql: {}, userId: 1, node, purpose: 'edit', idemKey: 'k', env: {}, deps: d });
    expect(r).toMatchObject({ error: { code: 'verification_busy', status: 429 } });
    expect(store.createJob).not.toHaveBeenCalledWith(expect.objectContaining({ purpose: 'edit', idemKey: 'k', userId: 1, targetUrl: node.origin_url, boardId: 'b1', nodeId: 'n1' }));
    expect(d.browserbase.createSession).not.toHaveBeenCalled();
  });

  it('captureJob (edit): fences ready→capturing, runs reconstructSiteNode with the borrowed producer under the job idemKey, succeeds, releases', async () => {
    store.getOwnedJob.mockResolvedValue({ id: 'j1', status: 'ready', generation: 1, purpose: 'edit', node_id: 'n1', board_id: 'b1', target_url: node.origin_url, idem_key: 'k', bb_session_id: 'sess', user_id: 1 });
    const seq = [];
    store.transition.mockImplementation(async ({ from, to }) => { seq.push(`${from}>${to}`); return { id: 'j1', status: to, generation: 1 }; });
    const d = deps();
    const r = await captureJob({ sql: {}, userId: 1, jobId: 'j1', env: {}, deps: d, loadNode: async () => node, connectUrlFor: async () => 'wss://c' });
    expect(seq).toEqual(['ready>capturing', 'capturing>committing', 'committing>succeeded']);
    expect(d.reconstruct).toHaveBeenCalledWith(expect.objectContaining({ idemKey: 'k', op: 'clone.edit', reason: 'edit', userId: 1 }));
    expect(d.captureNative).toHaveBeenCalledWith('https://site.example/', expect.objectContaining({ session: expect.objectContaining({ owned: false }), challengeToleranceMs: 40000 }));
    expect(d.browserbase.releaseSession).toHaveBeenCalledWith('sess');
    expect(r.result.credits).toBe(275);
  });

  it('captureJob: lost fence (someone else captured) is a typed conflict, nothing runs', async () => {
    store.getOwnedJob.mockResolvedValue({ id: 'j1', status: 'ready', generation: 1, purpose: 'edit', bb_session_id: 'sess', user_id: 1 });
    store.transition.mockResolvedValueOnce(null);
    const d = deps();
    await expect(captureJob({ sql: {}, userId: 1, jobId: 'j1', env: {}, deps: d, loadNode: async () => node, connectUrlFor: async () => 'wss://c' })).rejects.toMatchObject({ code: 'job_conflict' });
    expect(d.reconstruct).not.toHaveBeenCalled();
  });

  it('captureJob: producer failure → failed + release; the billing layer already charged 0', async () => {
    store.getOwnedJob.mockResolvedValue({ id: 'j1', status: 'ready', generation: 1, purpose: 'edit', bb_session_id: 'sess', user_id: 1, target_url: node.origin_url, idem_key: 'k' });
    const seq = [];
    store.transition.mockImplementation(async ({ from, to, patch }) => { seq.push(`${from}>${to}${patch?.error_code ? ':' + patch.error_code : ''}`); return { id: 'j1', status: to, generation: 1 }; });
    const d = deps({ reconstruct: vi.fn(async () => { throw Object.assign(new Error('boom'), { code: 'no_output' }); }) });
    await expect(captureJob({ sql: {}, userId: 1, jobId: 'j1', env: {}, deps: d, loadNode: async () => node, connectUrlFor: async () => 'wss://c' })).rejects.toMatchObject({ code: 'no_output' });
    expect(seq.at(-1)).toBe('capturing>failed:no_output');
    expect(d.browserbase.releaseSession).toHaveBeenCalledWith('sess');
  });

  it('liveViewFor: only needs_human AND the human flag; never the session-wide URL', async () => {
    const d = deps();
    expect(await liveViewFor({ job: { status: 'needs_human', bb_session_id: 'sess', bb_page_id: 'p' }, env: { UNCRAFT_CHALLENGE_HUMAN: '1' }, deps: d })).toEqual({ url: 'https://live/p' });
    expect(await liveViewFor({ job: { status: 'needs_human', bb_session_id: 'sess', bb_page_id: 'p' }, env: {}, deps: d })).toBeNull();
    expect(await liveViewFor({ job: { status: 'ready', bb_session_id: 'sess' }, env: { UNCRAFT_CHALLENGE_HUMAN: '1' }, deps: d })).toBeNull();
  });

  it('sweepExpiredJobs releases vendor sessions and marks expired', async () => {
    store.listExpired.mockResolvedValue([{ id: 'j9', status: 'needs_human', generation: 2, bb_session_id: 'sess9' }]);
    store.transition.mockImplementation(async ({ to }) => ({ id: 'j9', status: to }));
    const d = deps();
    expect(await sweepExpiredJobs({ sql: {}, deps: d })).toEqual({ expired: 1 });
    expect(d.browserbase.releaseSession).toHaveBeenCalledWith('sess9');
    expect(store.transition).toHaveBeenCalledWith(expect.objectContaining({ from: 'needs_human', to: 'expired', generation: 2 }));
  });
});
```

- [ ] **Step 2: RED.**

- [ ] **Step 3: Implementar**

```js
// packages/web-shell/lib/challenge/job-service.js
// Orquestração do job (spec §4.1–4.5). Regras: nenhum request espera pessoa;
// uma sessão por job; transições cercadas; sessão liberada em TODO terminal;
// cobrança só pela máquina existente dentro de captureJob.
import { createJob, getOwnedJob, transition, acquireLease, releaseLease, listExpired, TERMINAL } from './job-store.js';
import { checkChallengeQuota } from './quotas.js';
import { browserbaseFromEnv } from './browserbase-client.js';
import { withBorrowedSession } from './borrowed-session.js';
import { verifyTarget } from './verify.js';
import { captureNativeBundle } from '../native-clone/capture-bundle.js';
import { captureSnapshot } from '../snapshot.js';
import { reconstructSiteNode } from '../deferred-reconstruction.js';
import { persistReferenceSnapshot } from '../snapshot-persist.js';

export const VERIFY_BUDGET_MS = 45_000;
export const SOLVER_TOLERANCE_MS = 40_000;
export const HUMAN_DEADLINE_MS = 5 * 60 * 1000;
export const CAPTURE_BUDGET_MS = 240_000; // < maxDuration 300s, margem para persistir/liberar

export class ChallengeJobError extends Error {
  constructor(code, status = 409, extra = {}) { super(code); this.name = 'ChallengeJobError'; this.code = code; this.status = status; Object.assign(this, extra); }
}

function defaultDeps(env) {
  return {
    browserbase: browserbaseFromEnv(env),
    withSession: withBorrowedSession,
    verify: verifyTarget,
    captureNative: captureNativeBundle,
    captureSnap: captureSnapshot,
    reconstruct: reconstructSiteNode,
    persistReference: persistReferenceSnapshot,
    now: () => new Date(),
  };
}

async function releaseQuiet(deps, job) {
  if (job?.bb_session_id) await deps.browserbase.releaseSession(job.bb_session_id).catch(() => {});
}

// connectUrl NUNCA é persistida: quem precisa reconectar pede ao vendor de novo.
// (o Browserbase aceita conexão pela sessão: wss://connect.browserbase.com?apiKey=…&sessionId=…)
export function connectUrlForSession(sessionId, env = process.env) {
  return `wss://connect.browserbase.com?apiKey=${encodeURIComponent(env.BROWSERBASE_API_KEY || '')}&sessionId=${encodeURIComponent(sessionId)}`;
}

export async function startJob({ sql, userId, node, purpose, idemKey = null, env = process.env, deps = defaultDeps(env) }) {
  if (!deps.browserbase) return { error: { code: 'vendor_not_configured', status: 503 } };
  if (purpose === 'edit' && !idemKey) return { error: { code: 'idempotency_key_required', status: 400 } };
  const quota = await checkChallengeQuota({ sql, userId, purpose, env });
  if (!quota.ok) return { error: quota };

  let job = await createJob({ sql, userId, boardId: node.board_id, nodeId: node.id, purpose, targetUrl: node.origin_url, idemKey });
  let session;
  try {
    session = await deps.browserbase.createSession({ targetUrl: job.target_url, proxy: String(env.UNCRAFT_BROWSERBASE_PROXY || 'off') === 'on', jobId: job.id });
  } catch (e) {
    job = await transition({ sql, jobId: job.id, from: 'verifying', to: 'failed', generation: job.generation, patch: { error_code: e?.code || 'vendor_unavailable' } }) || job;
    return { job, error: { code: e?.code || 'vendor_unavailable', status: 503 } };
  }
  // grava ids da sessão (sem mudar de estado)
  job = await transition({ sql, jobId: job.id, from: 'verifying', to: 'verifying', generation: job.generation, patch: { bb_session_id: session.id, session_expires_at: session.expiresAt } }) || job;

  let verdict;
  try {
    const deadline = deps.now().getTime() + VERIFY_BUDGET_MS;
    verdict = await deps.withSession(session.connectUrl, ({ page }) => deps.verify({ page, url: job.target_url, toleranceMs: SOLVER_TOLERANCE_MS, cancelled: () => Date.now() > deadline }));
  } catch (e) {
    await releaseQuiet(deps, { bb_session_id: session.id });
    job = await transition({ sql, jobId: job.id, from: 'verifying', to: 'failed', generation: job.generation, patch: { error_code: 'verify_failed' } }) || job;
    return { job, error: { code: 'verify_failed', status: 502 } };
  }
  if (verdict.verdict === 'clean') {
    job = await transition({ sql, jobId: job.id, from: 'verifying', to: 'ready', generation: job.generation }) || job;
  } else if (verdict.verdict === 'needs_human') {
    const pageId = await deps.browserbase.liveUrls(session.id).then((l) => l.pages[0]?.id || null).catch(() => null);
    job = await transition({ sql, jobId: job.id, from: 'verifying', to: 'needs_human', generation: job.generation, patch: { bb_page_id: pageId, human_deadline_at: new Date(deps.now().getTime() + HUMAN_DEADLINE_MS).toISOString() } }) || job;
  } else {
    await releaseQuiet(deps, { bb_session_id: session.id });
    job = await transition({ sql, jobId: job.id, from: 'verifying', to: 'unsupported', generation: job.generation, patch: { error_code: `challenge_${verdict.kind || 'unknown'}` } }) || job;
  }
  return { job, status: job.status };
}

export async function checkJob({ sql, userId, jobId, env = process.env, deps = defaultDeps(env), connectUrlFor = (id) => connectUrlForSession(id, env) }) {
  const job = await getOwnedJob({ sql, userId, jobId });
  if (!job) throw new ChallengeJobError('not_found', 404);
  if (job.status !== 'needs_human') return { job };
  const owner = `check:${Math.random().toString(36).slice(2)}`;
  if (!(await acquireLease({ sql, jobId, owner, ttlMs: 15_000 }))) return { job };
  try {
    const verdict = await deps.withSession(await connectUrlFor(job.bb_session_id), ({ page }) => deps.verify({ page, url: job.target_url, toleranceMs: 3_000 }));
    if (verdict.verdict === 'clean') {
      const next = await transition({ sql, jobId, from: 'needs_human', to: 'ready', generation: job.generation });
      return { job: next || job };
    }
    return { job };
  } finally {
    await releaseLease({ sql, jobId, owner });
  }
}

export async function captureJob({ sql, userId, jobId, env = process.env, deps = defaultDeps(env), loadNode, connectUrlFor = (id) => connectUrlForSession(id, env), signal = null }) {
  const job = await getOwnedJob({ sql, userId, jobId });
  if (!job) throw new ChallengeJobError('not_found', 404);
  if (job.status !== 'ready') throw new ChallengeJobError(job.status === 'succeeded' ? 'already_done' : 'job_not_ready', 409);
  const owner = `capture:${Math.random().toString(36).slice(2)}`;
  const capturing = await transition({ sql, jobId, from: 'ready', to: 'capturing', generation: job.generation, patch: { lease_owner: owner, lease_until: new Date(Date.now() + CAPTURE_BUDGET_MS + 30_000).toISOString() } });
  if (!capturing) throw new ChallengeJobError('job_conflict', 409);

  const node = await loadNode({ sql, userId, nodeId: job.node_id });
  try {
    const result = await deps.withSession(await connectUrlFor(job.bb_session_id), async (session) => {
      if (job.purpose === 'edit') {
        return deps.reconstruct({
          sql, userId, node, reason: 'edit', engine: 'native', idemKey: job.idem_key, op: 'clone.edit',
          producer: (url, o = {}) => deps.captureNative(url, { ...o, session, challengeToleranceMs: SOLVER_TOLERANCE_MS, signal }),
        });
      }
      const snap = await deps.captureSnap(job.target_url, { session });
      return deps.persistReference({ sql, userId, nodeId: job.node_id, html: snap.html, screenshotDataUrl: snap.screenshotDataUrl, title: snap.title });
    });
    await transition({ sql, jobId, from: 'capturing', to: 'committing', generation: job.generation });
    const done = await transition({ sql, jobId, from: 'committing', to: 'succeeded', generation: job.generation });
    await releaseQuiet(deps, job);
    return { job: done, result };
  } catch (e) {
    await transition({ sql, jobId, from: 'capturing', to: 'failed', generation: job.generation, patch: { error_code: e?.code || 'capture_failed' } });
    await releaseQuiet(deps, job);
    throw e;
  }
}

export async function cancelJob({ sql, userId, jobId, env = process.env, deps = defaultDeps(env) }) {
  const job = await getOwnedJob({ sql, userId, jobId });
  if (!job) throw new ChallengeJobError('not_found', 404);
  if (TERMINAL.has(job.status)) return { job };
  const next = await transition({ sql, jobId, from: job.status, to: 'cancelled', generation: job.generation });
  await releaseQuiet(deps, job);
  return { job: next || job };
}

export async function liveViewFor({ job, env = process.env, deps = defaultDeps(env) }) {
  if (String(env.UNCRAFT_CHALLENGE_HUMAN || '') !== '1') return null;
  if (job?.status !== 'needs_human' || !job.bb_session_id) return null;
  const live = await deps.browserbase.liveUrls(job.bb_session_id).catch(() => null);
  const page = live?.pages?.find((p) => p.id === job.bb_page_id) || live?.pages?.[0];
  return page?.debuggerFullscreenUrl ? { url: page.debuggerFullscreenUrl } : null;
}

export async function sweepExpiredJobs({ sql, env = process.env, deps = defaultDeps(env) }) {
  const rows = await listExpired({ sql });
  let expired = 0;
  for (const job of rows) {
    await releaseQuiet(deps, job);
    const r = await transition({ sql, jobId: job.id, from: job.status, to: 'expired', generation: job.generation, patch: { error_code: 'expired' } });
    if (r) expired += 1;
  }
  return { expired };
}

export function publicJobView(job) {
  // O que o cliente vê: NUNCA ids do vendor.
  return { id: job.id, status: job.status, purpose: job.purpose, nodeId: job.node_id, errorCode: job.error_code || null, humanDeadlineAt: job.human_deadline_at || null };
}
```

E `lib/snapshot-persist.js` (extraído de `app/api/snapshot/handoff/route.js` L69–105, sem mudar comportamento; a rota passa a chamar a função):

```js
// packages/web-shell/lib/snapshot-persist.js
export async function persistReferenceSnapshot({ sql, userId, nodeId, html, screenshotDataUrl = null, title = null }) {
  const rows = await sql`
    SELECT n.id, n.current_snapshot_id FROM nodes n JOIN boards b ON b.id = n.board_id
     WHERE n.id = ${nodeId} AND b.user_id = ${userId}`;
  const node = rows[0];
  if (!node) return { error: 'not_found' };
  const [snap] = await sql`
    INSERT INTO snapshots (node_id, html, screenshot_url, source)
    VALUES (${node.id}, ${html}, ${screenshotDataUrl}, 'handoff') RETURNING id`;
  await sql`
    UPDATE nodes SET current_snapshot_id = ${snap.id},
      meta = COALESCE(meta, '{}'::jsonb) - 'awaiting_handoff' - 'handoff_started_at' || ${JSON.stringify(title ? { title } : {})}::jsonb
     WHERE id = ${node.id}`;
  return { snapshotId: snap.id };
}
```

(Conferir o SQL exato da rota antes de mover — copiar VERBATIM as três instruções; a rota mantém o dedup por `source === 'handoff'` e chama esta função.)

- [ ] **Step 4: GREEN** — `bun run vitest run lib/challenge/job-service.test.js app/api/snapshot`.

- [ ] **Step 5: Commit** — `git commit -m "feat(challenge): job service — start/check/capture/cancel/sweep, capture through reconstructSiteNode with a borrowed producer"`

---

### Task 8: Rotas do job

**Files:**
- Create: `packages/web-shell/app/api/nodes/[id]/challenge/route.js`
- Create: `packages/web-shell/app/api/challenge-jobs/[id]/route.js`, `check/route.js`, `capture/route.js`, `cancel/route.js`
- Test: `packages/web-shell/app/api/challenge-jobs/routes.test.js`

**Interfaces:**
- Consumes: Task 7; `requireUser` (`lib/auth.js`); `db`; `ownedNode` (padrão em `app/api/nodes/[id]/route.js`).
- Produces: contratos JSON — `POST /api/nodes/:id/challenge {purpose}` → `200 {job}` | `4xx {error, …}`; `GET /api/challenge-jobs/:id` → `{job, liveView?: {url}}` com `Cache-Control: no-store`; `POST …/check` → `{job}`; `POST …/capture` → `{job, result}` (result = o mesmo shape do `/reconstruct` para `edit`; `{snapshotId}` para `reference`); `POST …/cancel` → `{job}`. Erros tipados: `job_conflict`/`job_not_ready`/`already_done` 409, `not_found` 404, `verification_busy`/`too_many_open`/`daily_free_quota`/`spend_breaker` 429, `insufficient_credits` 402, `vendor_not_configured` 503, `challenge_required`… não se aplica aqui.

- [ ] **Step 1: Teste (padrão do reconstruct route.test)**

```js
// packages/web-shell/app/api/challenge-jobs/routes.test.js
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../../lib/auth.js', () => ({ requireUser: vi.fn(async () => ({ user: { id: 42, plan: 'pro' } })) }));
const sqlMock = vi.fn(async () => []);
vi.mock('../../../lib/db.js', () => ({ db: vi.fn(async () => sqlMock) }));
vi.mock('../../../lib/challenge/job-service.js', () => ({
  startJob: vi.fn(), checkJob: vi.fn(), captureJob: vi.fn(), cancelJob: vi.fn(), liveViewFor: vi.fn(async () => null),
  publicJobView: (j) => ({ id: j.id, status: j.status }), ChallengeJobError: class extends Error { constructor(c, s = 409) { super(c); this.code = c; this.status = s; } },
}));
const svc = await import('../../../lib/challenge/job-service.js');
const { POST: start } = await import('../nodes/[id]/challenge/route.js');
const { GET: get } = await import('./[id]/route.js');
const { POST: capture } = await import('./[id]/capture/route.js');

const req = (url, body) => new Request(url, { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'ticket-1' }, body: body === undefined ? undefined : JSON.stringify(body) });
const P = (id) => ({ params: Promise.resolve({ id }) });

beforeEach(() => { vi.clearAllMocks(); sqlMock.mockResolvedValue([{ id: 'n1', board_id: 'b1', origin_url: 'https://site.example/', kind: 'site' }]); });

describe('challenge routes', () => {
  it('POST /nodes/:id/challenge starts a job for the owned node with the idempotency ticket', async () => {
    svc.startJob.mockResolvedValue({ job: { id: 'j1', status: 'ready' } });
    const res = await start(req('http://t/api/nodes/n1/challenge', { purpose: 'edit' }), P('n1'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ job: { id: 'j1', status: 'ready' } });
    expect(svc.startJob).toHaveBeenCalledWith(expect.objectContaining({ userId: 42, purpose: 'edit', idemKey: 'ticket-1', node: expect.objectContaining({ id: 'n1' }) }));
  });
  it('maps quota/balance errors to their typed status', async () => {
    svc.startJob.mockResolvedValue({ error: { code: 'insufficient_credits', status: 402, estimate: 275, balance: 5 } });
    const res = await start(req('http://t/api/nodes/n1/challenge', { purpose: 'edit' }), P('n1'));
    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({ error: 'insufficient_credits', estimate: 275, balance: 5 });
  });
  it('rejects an unknown purpose before touching the service', async () => {
    const res = await start(req('http://t/api/nodes/n1/challenge', { purpose: 'other' }), P('n1'));
    expect(res.status).toBe(400); expect(svc.startJob).not.toHaveBeenCalled();
  });
  it('GET is no-store and only adds liveView when the service allows', async () => {
    sqlMock.mockResolvedValue([{ id: 'j1', status: 'needs_human', user_id: 42 }]);
    svc.liveViewFor.mockResolvedValueOnce({ url: 'https://live/p' });
    const res = await get(req('http://t/api/challenge-jobs/j1'), P('j1'));
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ job: { id: 'j1', status: 'needs_human' }, liveView: { url: 'https://live/p' } });
  });
  it('capture: conflict is a typed 409', async () => {
    svc.captureJob.mockRejectedValue(Object.assign(new Error('job_conflict'), { code: 'job_conflict', status: 409 }));
    const res = await capture(req('http://t/api/challenge-jobs/j1/capture', {}), P('j1'));
    expect(res.status).toBe(409); expect((await res.json()).error).toBe('job_conflict');
  });
});
```

- [ ] **Step 2: RED.**

- [ ] **Step 3: Implementar (as cinco rotas seguem o mesmo esqueleto)**

```js
// packages/web-shell/app/api/nodes/[id]/challenge/route.js
import { NextResponse } from 'next/server';
import { requireUser } from '../../../../../lib/auth.js';
import { db } from '../../../../../lib/db.js';
import { startJob, publicJobView } from '../../../../../lib/challenge/job-service.js';
export const dynamic = 'force-dynamic'; export const runtime = 'nodejs'; export const maxDuration = 60;

export async function POST(request, { params }) {
  const { user, error } = await requireUser(request);
  if (error) return error;
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const purpose = body?.purpose;
  if (!['reference', 'edit'].includes(purpose)) return NextResponse.json({ error: 'invalid_purpose' }, { status: 400 });
  const idemKey = request.headers.get('idempotency-key') || null;
  const sql = await db();
  const [node] = await sql`SELECT n.* FROM nodes n JOIN boards b ON b.id = n.board_id WHERE n.id = ${id} AND b.user_id = ${user.id}`;
  if (!node) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!node.origin_url) return NextResponse.json({ error: 'no_origin_url' }, { status: 400 });
  const r = await startJob({ sql, userId: user.id, node, purpose, idemKey });
  if (r.error) {
    const { code, status = 409, estimate, balance } = r.error;
    return NextResponse.json({ error: code, ...(estimate != null ? { estimate, balance } : {}) }, { status });
  }
  return NextResponse.json({ job: publicJobView(r.job) });
}
```

```js
// packages/web-shell/app/api/challenge-jobs/[id]/route.js
import { NextResponse } from 'next/server';
import { requireUser } from '../../../../lib/auth.js';
import { db } from '../../../../lib/db.js';
import { getOwnedJob } from '../../../../lib/challenge/job-store.js';
import { liveViewFor, publicJobView } from '../../../../lib/challenge/job-service.js';
export const dynamic = 'force-dynamic'; export const runtime = 'nodejs';

export async function GET(request, { params }) {
  const { user, error } = await requireUser(request);
  if (error) return error;
  const { id } = await params;
  const sql = await db();
  const job = await getOwnedJob({ sql, userId: user.id, jobId: id });
  if (!job) return NextResponse.json({ error: 'not_found' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  const liveView = await liveViewFor({ job });
  return NextResponse.json({ job: publicJobView(job), ...(liveView ? { liveView } : {}) }, { headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
}
```

`check`, `cancel`: `POST` → `requireUser` → `db()` → `checkJob`/`cancelJob({sql, userId, jobId})` → `{job: publicJobView(job)}`; erros `ChallengeJobError` → `{error: e.code}` com `e.status`. `capture`:

```js
// packages/web-shell/app/api/challenge-jobs/[id]/capture/route.js
import { NextResponse } from 'next/server';
import { requireUser } from '../../../../../lib/auth.js';
import { db } from '../../../../../lib/db.js';
import { captureJob, publicJobView } from '../../../../../lib/challenge/job-service.js';
import { InsufficientCreditsError, OperationInProgressError } from '../../../../../lib/billing/context.js';
export const dynamic = 'force-dynamic'; export const runtime = 'nodejs'; export const maxDuration = 300;

async function loadNode({ sql, userId, nodeId }) {
  const [node] = await sql`SELECT n.* FROM nodes n JOIN boards b ON b.id = n.board_id WHERE n.id = ${nodeId} AND b.user_id = ${userId}`;
  return node || null;
}

export async function POST(request, { params }) {
  const { user, error } = await requireUser(request);
  if (error) return error;
  const { id } = await params;
  const sql = await db();
  try {
    const { job, result } = await captureJob({ sql, userId: user.id, jobId: id, loadNode });
    return NextResponse.json({ job: publicJobView(job), result });
  } catch (e) {
    if (e instanceof InsufficientCreditsError) return NextResponse.json({ error: 'insufficient_credits', estimate: e.estimate, balance: e.balance }, { status: 402 });
    if (e instanceof OperationInProgressError) return NextResponse.json({ error: 'in_progress' }, { status: 409 });
    if (e?.status && e?.code) return NextResponse.json({ error: e.code }, { status: e.status });
    if (['control_conversion_timeout', 'provider_timeout'].includes(e?.code)) return NextResponse.json({ error: 'conversion_timeout' }, { status: 504 });
    console.error('challenge capture error', e?.code || e?.message);
    return NextResponse.json({ error: 'capture_failed' }, { status: 502 });
  }
}
```

(Verificar os nomes exportados por `lib/billing/context.js` — o `/reconstruct` importa `InsufficientCreditsError`/`OperationInProgressError` de lá; copiar o import de lá.) Acrescentar os três prefixos NOVOS ao teste `next.config.test.js`? Não: estas rotas não servem runtime — o CSP do app se aplica normalmente.

- [ ] **Step 4: GREEN** + `bun run vitest run next.config.test.js` (sanidade).

- [ ] **Step 5: Auditoria Astra (auth por dono, no-store, mapeamento de erros) + commit** — `git commit -m "feat(challenge): routes — start, status (no-store, live view gated), check, capture (billing via reconstructSiteNode), cancel"`

---

### Task 9: Varredura no cron + `ready_check` com `nativeReady` + `.env.example`

**Files:**
- Modify: `packages/web-shell/app/api/cron/reconcile-holds/route.js` (após `reconcileStrandedHolds`)
- Modify: `packages/web-shell/app/api/nodes/[id]/route.js` (bloco `ready_check`, L32–45)
- Modify: `packages/web-shell/.env.example`
- Test: `packages/web-shell/app/api/nodes/[id]/route.ready-check.test.js`, `packages/web-shell/app/api/cron/reconcile-holds/route.test.js` (se existir, estender; senão criar)

**Interfaces:**
- Consumes: `sweepExpiredJobs` (Task 7); `classifyNativeLineage` (`lib/node-editor-kind.js`).
- Produces: `GET /api/nodes/:id?ready_check=1` → `{ready, snapshotId, nativeReady}`.

- [ ] **Step 1: Teste do ready_check**

```js
// packages/web-shell/app/api/nodes/[id]/route.ready-check.test.js
import { describe, expect, it, vi } from 'vitest';
vi.mock('../../../../lib/auth.js', () => ({ requireUser: vi.fn(async () => ({ user: { id: 42 } })) }));
const sqlMock = vi.fn();
vi.mock('../../../../lib/db.js', () => ({ db: vi.fn(async () => sqlMock) }));
const { GET } = await import('./route.js');

describe('ready_check', () => {
  it('reports nativeReady from the structural lineage (bundle uuid + manifest v2 + native source)', async () => {
    sqlMock
      .mockResolvedValueOnce([{ id: 'n1', current_snapshot_id: 's1', current_snapshot_source: 'native-bundle', current_native_bundle_id: '33333333-3333-4333-8333-333333333333', current_motion_manifest_version: 2 }])
      .mockResolvedValueOnce([{ ready: true }]);
    const res = await GET(new Request('http://t/api/nodes/n1?ready_check=1'), { params: Promise.resolve({ id: 'n1' }) });
    expect(await res.json()).toEqual({ ready: true, snapshotId: 's1', nativeReady: true });
  });
});
```

(Se `ownedNode` seleciona colunas fixas, ampliar o SELECT para incluir `current_snapshot_source`, `current_native_bundle_id`, `current_motion_manifest_version` — o `/reconstruct` já faz esse SELECT; copiar os aliases de lá.)

- [ ] **Step 2: RED.**

- [ ] **Step 3: Implementar**

No `ready_check`: `const nativeReady = classifyNativeLineage(node) === NATIVE_LINEAGE.READY;` e devolver `{ ready, snapshotId, nativeReady }`.

No cron, após o bloco de holds:

```js
try {
  const { sweepExpiredJobs } = await import('../../../../lib/challenge/job-service.js');
  const jobs = await sweepExpiredJobs({ sql });
  if (jobs.expired > 0) console.warn(`[reconcile-holds] expired ${jobs.expired} challenge jobs (vendor sessions released)`);
  summary.challengeJobsExpired = jobs.expired;
} catch (e) { console.error('[reconcile-holds] challenge sweep failed:', e?.code || e?.message); }
```

`.env.example`:

```
# Sites com verificação de bot (spec 2026-09-08): navegador remoto Browserbase
BROWSERBASE_API_KEY=
BROWSERBASE_PROJECT_ID=
UNCRAFT_CHALLENGE_HUMAN=0          # 1 = expõe o visualizador ao vivo (só após o portão de revogação)
UNCRAFT_BROWSERBASE_PROXY=off
UNCRAFT_CHALLENGE_DAILY_FREE=10
UNCRAFT_CHALLENGE_MAX_OPEN=2
UNCRAFT_CHALLENGE_MAX_SESSIONS=10
UNCRAFT_CHALLENGE_EDIT_RESERVED=3
UNCRAFT_CHALLENGE_DAILY_SESSIONS=200
```

- [ ] **Step 4: GREEN** (`route.ready-check.test.js` + testes existentes de `app/api/nodes/[id]` + cron).

- [ ] **Step 5: Auditoria Astra + commit** — `git commit -m "feat(challenge): cron sweep releases expired vendor sessions; ready_check reports nativeReady; env documented"`

---

### Task 10: Cliente — API, aviso, visualizador, hook

**Files:**
- Modify: `packages/web-shell/lib/canvas-api.js` (após `reconstructNode`)
- Create: `packages/web-shell/components/ChallengeNotice.jsx`
- Create: `packages/web-shell/components/ChallengeLiveView.jsx`
- Create: `packages/web-shell/components/useChallengeJob.js`
- Test: `packages/web-shell/components/useChallengeJob.test.js`, `packages/web-shell/components/ChallengeNotice.test.jsx`

**Interfaces:**
- Produces: `api.startChallenge(nodeId, {purpose})`, `api.getChallengeJob(jobId)`, `api.checkChallengeJob(jobId)`, `api.captureChallengeJob(jobId)`, `api.cancelChallengeJob(jobId)`; `useChallengeJob({ api, onSucceeded(nodeId, purpose, result), onFailed(nodeId, code), onNodeState(nodeId, patch) }) → { start(nodeId, purpose), cancel(nodeId), jobs: Map<nodeId, {jobId, status, liveView}>, acknowledge(nodeId) }`; `<ChallengeNotice host onOk onCancel extension={false} />`; `<ChallengeLiveView url onDisconnected />`.

- [ ] **Step 1: Testes**

```js
// packages/web-shell/components/useChallengeJob.test.js
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useChallengeJob } from './useChallengeJob.js';

function fakeApi(script) {
  // script: sequência de estados que GET devolve
  const states = [...script];
  return {
    startChallenge: vi.fn(async () => ({ job: { id: 'j1', status: states.shift() } })),
    getChallengeJob: vi.fn(async () => ({ job: { id: 'j1', status: states[0] ?? 'succeeded' }, ...(states[0] === 'needs_human' ? { liveView: { url: 'https://live/p' } } : {}) })),
    checkChallengeJob: vi.fn(async () => { states.shift(); return { job: { id: 'j1', status: states[0] } }; }),
    captureChallengeJob: vi.fn(async () => ({ job: { id: 'j1', status: 'succeeded' }, result: { ok: true, kind: 'native', credits: 275 } })),
    cancelChallengeJob: vi.fn(async () => ({ job: { id: 'j1', status: 'cancelled' } })),
  };
}

describe('useChallengeJob', () => {
  it('ready right away → captures → onSucceeded', async () => {
    vi.useFakeTimers();
    const api = fakeApi(['ready']);
    const onSucceeded = vi.fn();
    const { result } = renderHook(() => useChallengeJob({ api, onSucceeded, onFailed: vi.fn(), onNodeState: vi.fn() }));
    await act(async () => { await result.current.start('n1', 'edit'); });
    expect(api.captureChallengeJob).toHaveBeenCalledWith('j1');
    expect(onSucceeded).toHaveBeenCalledWith('n1', 'edit', expect.objectContaining({ credits: 275 }));
    vi.useRealTimers();
  });

  it('needs_human → shows live view, keeps checking every 3s, then captures when ready', async () => {
    vi.useFakeTimers();
    const api = fakeApi(['needs_human', 'needs_human', 'ready']);
    const onNodeState = vi.fn();
    const { result } = renderHook(() => useChallengeJob({ api, onSucceeded: vi.fn(), onFailed: vi.fn(), onNodeState }));
    await act(async () => { await result.current.start('n1', 'reference'); });
    expect(result.current.jobs.get('n1')).toMatchObject({ status: 'needs_human' });
    await act(async () => { await vi.advanceTimersByTimeAsync(3100); });
    expect(api.checkChallengeJob).toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(3100); });
    expect(api.captureChallengeJob).toHaveBeenCalledWith('j1');
    vi.useRealTimers();
  });

  it('unsupported → onFailed with the typed code and no capture', async () => {
    const api = fakeApi(['unsupported']);
    const onFailed = vi.fn();
    const { result } = renderHook(() => useChallengeJob({ api, onSucceeded: vi.fn(), onFailed, onNodeState: vi.fn() }));
    await act(async () => { await result.current.start('n1', 'edit'); });
    expect(onFailed).toHaveBeenCalledWith('n1', 'unsupported');
    expect(api.captureChallengeJob).not.toHaveBeenCalled();
  });
});
```

```jsx
// packages/web-shell/components/ChallengeNotice.test.jsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ChallengeNotice from './ChallengeNotice.jsx';

describe('ChallengeNotice', () => {
  it('shows the English copy with an OK button and no site link', () => {
    const onOk = vi.fn();
    render(<ChallengeNotice host="amigosecreto.curriculum.com.br" onOk={onOk} onCancel={vi.fn()} />);
    expect(screen.getByText(/needs a quick check/i)).toBeTruthy();
    expect(screen.queryByText(/Open amigosecreto/i)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(onOk).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: RED.**

- [ ] **Step 3: Implementar**

`canvas-api.js` (ao lado de `reconstructNode`):

```js
  startChallenge: (nodeId, { purpose }) => withTicket(`challenge:${nodeId}:${purpose}`, (ticket) =>
    fetch(`/api/nodes/${nodeId}/challenge`, withIdemHeader({ ...COMMON, method: 'POST', body: JSON.stringify({ purpose }) }, ticket)).then(jsonOrThrow)),
  getChallengeJob: (jobId) => fetch(`/api/challenge-jobs/${jobId}`, { ...COMMON, method: 'GET' }).then(jsonOrThrow),
  checkChallengeJob: (jobId) => fetch(`/api/challenge-jobs/${jobId}/check`, { ...COMMON, method: 'POST' }).then(jsonOrThrow),
  captureChallengeJob: (jobId) => fetch(`/api/challenge-jobs/${jobId}/capture`, { ...COMMON, method: 'POST' }).then(jsonOrThrow),
  cancelChallengeJob: (jobId) => fetch(`/api/challenge-jobs/${jobId}/cancel`, { ...COMMON, method: 'POST' }).then(jsonOrThrow),
```

```jsx
// packages/web-shell/components/ChallengeNotice.jsx
'use client';
// Aviso em inglês com OK (decisão de produto 2026-09-06). Sem link para o site,
// sem extensão: a verificação acontece no NOSSO navegador, dentro do node.
export default function ChallengeNotice({ host, onOk, onCancel }) {
  return (
    <div className="popup-overlay" onMouseDown={(e) => e.stopPropagation()}>
      <div className="popup-card challenge-modal-card" role="dialog" aria-modal="true" aria-labelledby="challenge-notice-title">
        <h3 id="challenge-notice-title" className="popup-title"><span className="popup-serif"><i>Quick</i></span> check needed</h3>
        <p className="popup-text"><strong>{host}</strong> needs a quick check before we can open it. We'll show it right here in the canvas — just pass the check and we'll continue on our own.</p>
        <div className="popup-actions">
          <button type="button" className="popup-btn popup-btn-outline" onClick={onCancel}>Cancel</button>
          <button type="button" className="popup-btn popup-btn-primary" onClick={onOk} autoFocus>OK</button>
        </div>
      </div>
    </div>
  );
}
```

```jsx
// packages/web-shell/components/ChallengeLiveView.jsx
'use client';
import { useEffect } from 'react';
// Visualizador ao vivo do NOSSO navegador remoto, dentro da moldura do node.
// A URL é segredo portador (spec §4.6): nunca vai para log/analytics; sandbox mínimo.
export default function ChallengeLiveView({ url, onDisconnected }) {
  useEffect(() => {
    const origin = (() => { try { return new URL(url).origin; } catch { return null; } })();
    function onMsg(e) {
      if (!origin || e.origin !== origin) return;
      if (e.data === 'browserbase-disconnected' || e.data?.type === 'browserbase-disconnected') onDisconnected?.();
    }
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [url, onDisconnected]);
  return (
    <div className="challenge-live-view">
      <div className="challenge-live-view-hint">Pass the check below — we'll continue automatically.</div>
      <iframe title="Site check" src={url} sandbox="allow-scripts allow-same-origin allow-pointer-lock" referrerPolicy="no-referrer" allow="" style={{ width: '100%', height: '100%', border: 0 }} />
    </div>
  );
}
```

```js
// packages/web-shell/components/useChallengeJob.js
'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
const POLL_MS = 3000;
const TERMINAL = new Set(['succeeded', 'failed', 'expired', 'cancelled', 'unsupported']);

// O canvas OBSERVA e DISPARA (spec §4.3): consulta o job, chama `check` em
// needs_human e `capture` em ready; nunca é dono da execução — reentrada é
// recusada pelo servidor (job_conflict) e tratada como "alguém já capturou".
export function useChallengeJob({ api, onSucceeded, onFailed, onNodeState }) {
  const [jobs, setJobs] = useState(() => new Map());
  const timers = useRef(new Map());
  const busy = useRef(new Set());

  const setJob = useCallback((nodeId, patch) => setJobs((prev) => { const next = new Map(prev); next.set(nodeId, { ...(prev.get(nodeId) || {}), ...patch }); return next; }), []);
  const stop = useCallback((nodeId) => { const t = timers.current.get(nodeId); if (t) clearInterval(t); timers.current.delete(nodeId); }, []);

  const handle = useCallback(async (nodeId, purpose, payload) => {
    const { job, liveView, result } = payload;
    setJob(nodeId, { jobId: job.id, status: job.status, liveView: liveView?.url || null });
    if (job.status === 'succeeded') { stop(nodeId); onSucceeded?.(nodeId, purpose, result); return; }
    if (TERMINAL.has(job.status)) { stop(nodeId); onFailed?.(nodeId, job.errorCode || job.status); return; }
    if (job.status === 'ready' && !busy.current.has(nodeId)) {
      busy.current.add(nodeId);
      try {
        const r = await api.captureChallengeJob(job.id);
        await handle(nodeId, purpose, r);
      } catch (e) {
        if (e?.code === 'job_conflict' || e?.code === 'already_done') return; // outro controlador venceu; o polling observa
        stop(nodeId); onFailed?.(nodeId, e?.code || 'capture_failed');
      } finally { busy.current.delete(nodeId); }
      return;
    }
    if (job.status === 'needs_human') onNodeState?.(nodeId, { stage: 'needs_human' });
    if (job.status === 'verifying' || job.status === 'capturing' || job.status === 'committing') onNodeState?.(nodeId, { stage: job.status });
  }, [api, onSucceeded, onFailed, onNodeState, setJob, stop]);

  const poll = useCallback((nodeId, purpose, jobId) => {
    stop(nodeId);
    const tick = async () => {
      try {
        const current = jobs.get(nodeId);
        const r = current?.status === 'needs_human' ? await api.checkChallengeJob(jobId) : await api.getChallengeJob(jobId);
        await handle(nodeId, purpose, r);
      } catch (e) { if (/404|not_found/i.test(String(e?.message || ''))) { stop(nodeId); onFailed?.(nodeId, 'not_found'); } }
    };
    timers.current.set(nodeId, setInterval(tick, POLL_MS));
  }, [api, handle, jobs, stop]);

  const start = useCallback(async (nodeId, purpose) => {
    const r = await api.startChallenge(nodeId, { purpose });
    await handle(nodeId, purpose, r);
    if (!TERMINAL.has(r.job.status)) poll(nodeId, purpose, r.job.id);
  }, [api, handle, poll]);

  const cancel = useCallback(async (nodeId) => {
    const j = jobs.get(nodeId); stop(nodeId);
    if (j?.jobId) await api.cancelChallengeJob(j.jobId).catch(() => {});
    setJobs((prev) => { const n = new Map(prev); n.delete(nodeId); return n; });
  }, [api, jobs, stop]);

  useEffect(() => () => { for (const t of timers.current.values()) clearInterval(t); timers.current.clear(); }, []);
  return { start, cancel, jobs };
}
```

(O teste do hook usa `@testing-library/react`; conferir que já é dependência — `ReferenceLibrary.test.jsx` usa; senão `bun add -d @testing-library/react`.)

- [ ] **Step 4: GREEN.**

- [ ] **Step 5: Commit** — `git commit -m "feat(challenge): client — API, English notice with OK, embedded live view, job hook (observe & dispatch)"`

---

### Task 11: Ligar no canvas; remover handoff antigo

**Files:**
- Modify: `packages/web-shell/components/CanvasClient.jsx`: (a) remover `startHandoffPolling`/`stopHandoffPolling`/`handoffPollersRef` (L2056–2133) e o `<ChallengeModal>` (L7339–7366) + import; (b) no `catch` da captura de referência (L2339–2351) e no `catch` do Edit (`handleEditingToggle`, ramo `e?.challenge`): mostrar `ChallengeNotice`; no OK → `challenge.start(nodeId, purpose)`; (c) render do node em `needs_human`: `<ChallengeLiveView>` no lugar do preview; (d) `onSucceeded`: `reference` → `api.getNode(nodeId)` e trocar `current_html`/`current_screenshot` como o poller antigo fazia; `edit` → `applyReconstructionResultToNode(node, result)` + `enterEditMode(preparedNode, editorKindForNode(preparedNode))` (mesmo caminho de `handleEditingToggle`); (e) `onFailed`: rótulos em inglês por código: `unsupported` → "This site blocks automated capture", `expired` → "Verification timed out — try again", `cancelled` → "Verification cancelled", outros → "Capture failed — nothing was charged".
- Modify: `packages/web-shell/components/CanvasNode.jsx` — aceitar prop `challengeStage` para exibir o rótulo/estágio; render do visualizador quando houver `liveViewUrl`.
- Delete: `packages/web-shell/components/ChallengeModal.jsx` (após grep de usos = 0).
- Test: `packages/web-shell/components/CanvasClient.challenge.test.jsx` (render mínimo com `api` mockado: colar URL que devolve `challenge` → aviso aparece; OK → `startChallenge` chamado com `purpose:'reference'`; Edit com 409 → `purpose:'edit'`).

- [ ] **Step 1: Teste** — seguir o padrão dos testes de componente existentes (`ReferenceLibrary.test.jsx`) para montar `CanvasClient` com `api` mockado; asserções: `screen.getByText(/quick check/i)`, `fireEvent.click(getByRole('button',{name:'OK'}))`, `expect(api.startChallenge).toHaveBeenCalledWith('n1', { purpose: 'reference' })`.

- [ ] **Step 2: RED.**

- [ ] **Step 3: Implementar** conforme a lista de Files (código de cola: o hook é instanciado uma vez em `CanvasClient` com `api` e os três callbacks; `notice` é estado `{nodeId, host, purpose}`).

- [ ] **Step 4: GREEN** + `bun run vitest run components` inteiro.

- [ ] **Step 5: Commit** — `git commit -m "feat(challenge): canvas wiring — notice→job→live view→auto-continue; legacy extension handoff removed"`

---

### Task 12: Extensão — retirar o handoff antigo

**Files:**
- Modify: `packages/extension-shell/panel/panel.js` (bloco do callout L3697–3802 e markup L124–138), `packages/extension-shell/handoff/handoff.js` (receiver do `uncraft.handoff.register` — remover; manter `present-flag.js` inofensivo), `packages/extension-shell/background.js` (`sendHandoffToWebShell` + roteador `uncraft.handoff.send` — remover), `packages/extension-shell/manifest.json` (content script `handoff/handoff.js` sai; **versão** 2.5.0 → 2.6.0).
- Test: `packages/extension-shell` não tem suíte; verificação = `grep -rn "uncraft.handoff" packages/extension-shell` vazio + carregar a extensão descompactada no Chrome e conferir que o widget abre sem erro no console.

- [ ] Steps: grep → remover → grep vazio → carregar no Chrome (manual) → commit `chore(extension): remove the extension-side handoff (superseded by the remote-browser challenge flow)`.

---

### Task 13: Portão de revogação do visualizador + prova viva (gated pela chave)

**Files:**
- Create: `packages/web-shell/scripts/probe-liveview-revocation.mjs`
- Create: `docs/superpowers/findings/2026-09-XX-liveview-revocation-and-live-proof.md`

Roda **somente** com `BROWSERBASE_API_KEY`/`PROJECT_ID`:

- [ ] **Step 1: Probe de revogação** — cria sessão; obtém `debuggerFullscreenUrl`; abre o visualizador num Chromium local (Playwright) e mede que um clique nele move o mouse na sessão (controle positivo); depois (a) chama `check` do nosso serviço e (b) `REQUEST_RELEASE`; mede se o visualizador ainda controla após (a) e após (b). Registrar: **com (a) o controle persiste?** Se sim → `UNCRAFT_CHALLENGE_HUMAN` fica `0` em produção até haver revogação real (spec §4.6). Escrever o resultado no finding.
- [ ] **Step 2: Prova viva automática** — `.env.local` com a chave; `./scripts/subir-lease-local.sh`; colar `https://amigosecreto.curriculum.com.br` no canvas → node vira referência sem clique; clicar Edit → "Preparing…" → editor abre. **Screenshot do editor aberto** anexado ao finding. Registrar tempos.
- [ ] **Step 3: Controle** — `https://www.farmminerals.com/promo` clona pelo caminho barato (sem job criado: `SELECT COUNT(*) FROM challenge_jobs` inalterado).
- [ ] **Step 4: Commit** do probe + finding.

---

### Task 14: Fechamento — suíte inteira, [SALVAR]

- [ ] `cd packages/web-shell && bun run vitest run` → tudo verde; `bun run build` (Next) → exit 0.
- [ ] Atualizar `docs/superpowers/plans/2026-09-08-challenge-remote-browser.md` com a tabela de status por tarefa; memória (`checkpoint_2026-09-XX_challenge-remote-browser.md` + `MEMORY.md`) e item novo no `CLAUDE.md`; vault Brain (nota da sessão + Findings — o "não tem como não passar pela extensão?" do Adilson derrubou a proposta A: registrar).
- [ ] Commit repo + vault.

---

## Self-review (feito ao escrever)

- **Cobertura da spec:** §2 decisões → Tasks 10/11 (aviso/OK, sem extensão, sem sair do canvas), 6/7/8 (cobrança só no sucesso, pré-checagem); §4.1 escada → Task 3 (verdict), 7 (`startJob`), 4 (tolerância 40s); §4.2 job/sessão → Tasks 1, 2, 5, 7, 9 (varredura); §4.3 rotas → Task 8; §4.4 sessão emprestada → Task 4; §4.5 cotas → Task 6; §4.6 visualizador/portão → Tasks 2 (só URLs de página), 7 (`liveViewFor` gated), 8 (no-store), 10 (sandbox), 13 (probe); §4.7 canvas → Tasks 10/11; §5 prova → Tasks 3/4 (integração real), 13 (viva). §6 resíduos: fila durável — o `lease_until` + varredura cobre o worker morto (Task 5/9).
- **Placeholders:** nenhum "TBD"; a Task 11 descreve a cola por localização exata e a Task 12 é remoção guiada por grep.
- **Consistência de nomes:** `withBorrowedSession`, `verifyTarget`, `startJob/checkJob/captureJob/cancelJob/liveViewFor/sweepExpiredJobs/publicJobView`, `checkChallengeQuota`, `createJob/getOwnedJob/transition/acquireLease/releaseLease/listExpired/count*`, `captureNativeBundle(url,{session,challengeToleranceMs})`, `captureSnapshot(url,{session})`, `persistReferenceSnapshot`, `api.startChallenge/getChallengeJob/checkChallengeJob/captureChallengeJob/cancelChallengeJob`, `useChallengeJob` — usados com os mesmos nomes em todas as tarefas.
