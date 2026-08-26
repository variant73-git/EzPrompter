# Runtime Lease B (concessão renovável + origem por sessão) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **v2 (2026-08-26)** — revisado após review adversarial dupla (agente Claude independente ×
> Sol/Codex, effort max). 3 P0 do Claude confirmados por grep no repo (superfície errada:
> o editor do produto é `NativeEditViewport`, não `NativeMotionEditor`; upload parte de
> DENTRO do clone; o gatilho real de teardown é `runtimeRecovery.exhausted`) e 2 bloqueantes
> do Sol aceitos (cookie com `Max-Age` morria às 4h apesar do sliding no banco; hostname não
> persistido destruía o cache a cada reabertura). Refutado com evidência: "Next 16 renomeou
> middleware→proxy" — este repo é `next@^15` (`package.json`), `middleware.js` vale; mantida
> a exigência de provar o guard no servidor REAL. Achado S3 do Sol era lacuna de redação
> (HTML já é `no-store` em `route.js:503`) — matriz de cache agora explícita.
>
> **v3 (2026-08-26)** — rodada 2 do Sol sobre os deltas do v2 (7 achados; 5 aceitos, 2
> ajustados com fundamento): badge sempre consumido + **lease única ativa por sessão**
> (fast path do bootstrap deixava o badge resgatável 60s; renovação por sessão prolongava
> lease replicada); **domínio registrável do runtime separado do app OBRIGATÓRIO em prod**
> + `Origin-Agent-Cluster: ?1` + `CORP: same-origin` (subdomínio sob o mesmo eTLD+1 não é
> separação de site; o cookie em si já é protegido pelo prefixo `__Host-`, que proíbe
> `Domain=`); CAS na atribuição do hostname + nonce 128 bits; quota de upload atômica no
> banco; postMessage 4-eixos nos DOIS sentidos com mapa de ids; máscara só em recusa
> TERMINAL de renovação (rede/5xx → backoff até a margem do expiry). Ajustados: registro
> append-only de hostnames DESCARTADO (128 bits aleatórios tornam reuso por colisão
> desprezível — cerimônia); severidade do redirect canônico rebaixada (o gateway atual JÁ
> ignora query — lookup por path do assetIndex; o redirect é equivalência com colapso de
> cache), mantendo cache do 301 limitado à lease + teste de não-loop.

**Goal:** Trocar o bearer-no-caminho do runtime do clone nativo por uma lease opaca renovável em cookie, servida de um hostname por sessão com `allow-same-origin` — matando (1) a imagem quebrada às 4h e (2) o re-download de corpo inteiro a cada reload — com a máscara de falha como entrega 1 e réguas de aceite medidas antes×depois.

**Architecture:** Bootstrap one-shot (badge JWT próprio, escopo `session:bootstrap`) → consumo atômico cria lease opaca revogável no banco → **cookie de SESSÃO** (sem `Max-Age` — a validade mora SÓ na linha da lease) → `303` para URL limpa → iframe `allow-scripts allow-same-origin` num **hostname persistido por sessão de edição** sob sufixo registrável estável. Renovar = estender a linha da lease (sliding), sem trocar URL nem recarregar o iframe. Service worker recusado por enforcement; CSP de UMA fonte estruturada; máscara desmonta o iframe e preserva o shell. Caminho legado (token no path, origem opaca) permanece atrás da flag `UNCRAFT_RUNTIME_LEASE` até o aceite medido.

**Tech Stack:** Next.js 15 (web-shell, porta 3030, **bun**), Postgres (Neon), Vitest, mkcert (HTTPS local para o witness), Chrome de marca para o aceite (Chromium do Playwright é imprestável para cache — finding 2026-08-25).

**Spec:** `docs/superpowers/handoffs/2026-08-25-runtime-lease-b-antes-de-a-handoff.md` + `2026-08-25-sol-audit-runtime-r1.md`/`-r2.md`. Executores leem os três.

## Status de execução (2026-08-26, branch `feat/runtime-lease-b`)

| Task | Estado | Commit |
|---|---|---|
| 1 (MASKED/RELOADING) | ✅ | `9d09ec05` |
| 2 (RuntimeMask no produto) | ✅ (prova ao vivo PENDENTE do banco) | `c0956def` |
| 4 (badge one-shot) | ✅ | `5166919f` |
| 5 (lease CRUD) | ✅ | `f37b413f` |
| 6 (extração do core, 30=30) | ✅ | `57ceea80` |
| 9 (CSP fonte única + detector) | ✅ (passo do produtor AJUSTADO — ver task) | `191bccfd` |
| 10 (hostname + host guard, provado live) | ✅ | `aaf7b5c5` |
| 11 (recusa de SW) | ✅ | `1b5e2e51` |
| 3, 7, 8, 12, 13, 14 | ⏳ `[DB]` — esperam Neon/Postgres | — |

Suíte no fechamento: **2302 passed | 28 skipped**; `next build` OK (middleware no build).

## Global Constraints

- **bun, não npm**; Vitest; suíte roda de `packages/web-shell/`.
- **TDD por task** — RED observado; auditoria do Sol antes de cada commit ([[feedback_sol_audit_everything]]).
- **Texto de produto em INGLÊS**; docs em PT.
- **Flag `UNCRAFT_RUNTIME_LEASE`** (server-side, default OFF). Enquadramento honesto (review r1): hardening de CORE (CSP meta com `worker-src`, recusa de SW) ALCANÇA o caminho legado deliberadamente; cada mudança dessas precisa provar neutralidade comportamental no legado com a CONTAGEM de testes da rota preservada (lição 178). Fora do hardening nomeado, flag off = comportamento atual byte-idêntico.
- **A lease autoriza SOMENTE GET/HEAD** de assets. Nunca mutação. Upload atravessa o PARENT por postMessage → rota app-authed (Task 12) — o clone não tem cookie de login (eTLD+1 separado; `SameSite=Lax` em `lib/auth.js:68`).
- **Invariante do `/api/rt`** (review r1): todo método é leitura pura de asset, sem mutação e sem oráculo distinguível — corpo/status/latência de recusa idênticos entre motivos (o clone hostil pede com a credencial da própria sessão; `HttpOnly` impede ler o cookie, não impede disparar o request).
- **Cookie da lease: cookie de SESSÃO** — `Set-Cookie` SEM `Max-Age`/`Expires` (Sol r3 #1: `Max-Age=4h` faria o browser parar de enviar o cookie às 4h, matando a renovação sliding; e o app não pode reemitir `__Host-` de outro host). Expiração vive na linha da lease, verificada a cada request.
- **Hostname por sessão: PERSISTIDO na sessão de edição** (Sol r3 #2) — mintado UMA vez ao abrir por **compare-and-set** (`UPDATE ... WHERE runtime_hostname IS NULL RETURNING`; o perdedor RELÊ o vencedor antes de assinar badge — Sol r4 #5), reusado em todo resume (F5, reload, reabertura); nonce de **32 hex = 128 bits** (colisão/reuso desprezível por construção) + `UNIQUE` como cinto com retry de `unique_violation`. Nova geração (re-clone) = sessão nova = hostname novo. Sufixo registrável ESTÁVEL (`<nonce>.rt.dominio.com`); nenhuma API do app no runtime host; nenhum cookie `Domain=.dominio`; `iframe credentialless` PROIBIDO.
- **Separação de SITE, não só de origem** (Sol r4 #2): em produção o sufixo do runtime DEVE viver em domínio registrável (eTLD+1) SEPARADO do app — validado no startup (evolução do check existente em `resolveRuntimeOrigin`); todas as respostas do runtime levam `Origin-Agent-Cluster: ?1` (mata `document.domain`) e, em modo lease, `Cross-Origin-Resource-Policy: same-origin`. O cookie da lease em si já é imune a tossing entre nonces: o prefixo `__Host-` proíbe `Domain=` por regra de browser. PSL entry para o sufixo = hardening opcional futuro, não pré-requisito.
- **Lease única ativa por sessão** (Sol r4 #1): criar lease nova revoga as anteriores da sessão (índice parcial `UNIQUE(edit_session_id) WHERE status='active'`); renovar toca exatamente a ativa. Badge é consumido SEMPRE — inclusive no fast path cookie-first; badge repetido só passa se o cookie apresentado corresponder à lease que o consumiu.
- **CHIPS é capacidade, não versão-piso**: Safari adicionou em 18.4 e há relato de desativação em 18.5 (Sol, bug WebKit 292975 — não verificado de 1ª mão). O finding de aceite registra a matriz de capacidade por browser; nada de "≥18.4" como garantia.
- **Neon esgotado:** tasks `[DB]` esperam banco; `[DB-free]` (unit com sql mockado, UI, CSP, probe) rodam antes.
- Migrações: `ADD COLUMN IF NOT EXISTS`; `.sql` dividido por `lib/sql-statements.js` (lição 180b).
- Commits com `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

## Mapa de arquivos

| Arquivo | Papel |
|---|---|
| `components/motion-editor/RuntimeMask.jsx` (novo) | Máscara + mensagem EN + Reload |
| `lib/motion-editor/edit-state-machine.js` (mod) | estados `MASKED` e `RELOADING` (falha de reload VOLTA à máscara, nunca teardown) |
| `components/motion-editor/NativeEditViewport.jsx` (mod) | **a superfície do PRODUTO** (review r1 P0-1): máscara no lugar do iframe, sandbox condicional, intercepta `runtimeRecovery.exhausted` |
| `components/CanvasNode.jsx` (mod) | `onUnavailable` só para falha de ABERTURA |
| `components/CanvasClient.jsx` (mod) | toast fica restrito ao caminho de abertura |
| `components/motion-editor/useNativeMotionController.js` (mod) | `reloadRuntime`, laço de renovação, postMessage com `event.source`+origem+envelope |
| `components/motion-editor/NativeMotionEditor.jsx` (mod) | paridade no laboratório dev (mesmas mudanças de iframe; secundária) |
| `lib/motion-editor/runtime-lease.js` (novo) | badge one-shot + lease CRUD |
| `migrations/2026-08-26-runtime-leases.sql` (novo) + schema de boot (mod) | tabela `native_runtime_leases` + `runtime_hostname` na sessão |
| `app/api/runtime-bootstrap/[badge]/route.js` (novo) | cookie-first: lease válida no cookie → 303 direto; senão consome badge |
| `app/api/rt/[sessionId]/[...path]/route.js` (novo) | gateway cookie-authed, URL limpa, canônica sem query |
| `lib/motion-editor/runtime-gateway-core.js` (novo) | corpo do GET extraído, parametrizado por autorização |
| `app/api/runtime/[token]/[...path]/route.js` (mod) | casca fina sobre o core (contagem de testes preservada) |
| `app/api/nodes/[id]/runtime-session/route.js` (mod) | flag on: hostname persistido + badge + URL de bootstrap |
| `app/api/nodes/[id]/runtime-session/renew/route.js` (novo) | renovação sliding |
| `app/api/nodes/[id]/native-uploads/route.js` (novo) | destino app-authed da ponte de upload |
| `lib/native-clone/native-uploads.js` (novo) | pipeline extraído (bytes mágicos, hash, store) |
| `packages/editor-core/src/editor.js` (mod) | upload vira postMessage ao parent em modo lease (`editor.js:7549`) |
| `lib/motion-editor/runtime-csp.js` (novo) | UMA política → header E meta |
| `lib/motion-editor/native-clone-gateway.js` (mod) | meta CSP da fonte única; config ganha `appOrigin`/`leaseMode` |
| `lib/motion-editor/runtime-session-token.js` (mod) | `mintRuntimeHostname`, `runtimeRequestUsesSessionHost` |
| `middleware.js` (novo — Next 15, convenção vigente NESTE repo) | host guard |
| `scripts/medir-entrega-runtime.mjs` (novo) | régua de aceite |

**Interfaces centrais:**

```js
// lib/motion-editor/runtime-lease.js
export const BOOTSTRAP_BADGE_TTL_SECONDS = 60;
export const LEASE_TTL_SECONDS = 4 * 60 * 60;          // sliding NO BANCO; o cookie é de sessão, sem idade
export const LEASE_RENEW_INTERVAL_MS = 10 * 60 * 1000;
export function mintBootstrapBadge({ nodeId, bundleId, sessionId, entryPath, hostname }, options = {})
  // -> { badge, jti, expiresAt } — hostname SEM porta (a porta vive na authority/URL, nunca na validação)
export function verifyBootstrapBadge(badge, options = {})
  // -> { payload } | { error: 'missing'|'invalid'|'expired'|'server_misconfigured' }
export async function createLeaseFromBadge({ sql, payload })
  // -> { cookieValue, lease } | { error: 'badge_used' } — na MESMA transação: revoga leases
  // ativas anteriores da sessão (invariante lease-única) e insere a nova
export async function verifyLease({ sql, cookieValue, hostname, sessionId })
  // -> { lease } | { error: 'missing'|'invalid'|'expired'|'revoked'|'host_mismatch' }
export async function renewLease({ sql, sessionId })      // -> { renewed, expiresAt } — toca A lease ativa (única por construção), nunca varre
export async function revokeLeasesForSession({ sql, sessionId })
export async function reapExpiredLeases({ sql })          // varredura: active vencida -> expired (GC, review r1 #7)
export function leaseCookieName()                          // '__Host-rt' (https) | 'uncraft_rt' (dev http puro — witness usa https)
export function leaseCookieHeader(cookieValue)             // SEM Max-Age/Expires: '__Host-rt=<v>; Secure; HttpOnly; SameSite=None; Partitioned; Path=/'

// lib/motion-editor/runtime-gateway-core.js
export async function serveRuntimeAsset({ request, pathSegments, session, descriptorRow, runtimeBase, corsWildcard })

// lib/motion-editor/runtime-csp.js
export function runtimeCspHeader({ frameAncestor })
export function runtimeCspMeta()
```

**Matriz de cache (obrigatória, Sol r3 #3):**

| Resposta | Cache-Control |
|---|---|
| bootstrap (303), renovação, falha inerte | `no-store` |
| HTML de entrada (bridge+config injetados) | `no-store` (já é hoje — `route.js:503`; teste de regressão passa a EXIGIR) |
| texto reescrito (JS/CSS/JSON/SVG) | `private, max-age=<restante da lease>, immutable` + ETag do conteúdo reescrito |
| binário content-addressed | `private, max-age=<restante da lease>, immutable` + ETag do hash |

---

## FASE 1 — Máscara (entrega 1; `[DB-free]`; independente da flag)

Decisão do Adilson (2026-08-26): a máscara é parte PERMANENTE do B, entrega 1. Falha de
runtime em edição ATIVA (recuperação esgotada, sessão revogada, servidor fora) deixa de
derrubar o editor com toast — vira máscara que **desmonta o iframe** (mata JS e rede do
clone — Sol r3 #7), preserva o shell e os painéis, e oferece Reload. O rascunho é
server-side (`openOrResumeEditSession` retoma; replay do item 180 reaplica) — nada se perde.

### Task 1: Estados `MASKED` e `RELOADING` na máquina de edição

**Files:**
- Modify: `lib/motion-editor/edit-state-machine.js`
- Test: `lib/motion-editor/edit-state-machine.test.js`

**Interfaces:**
- Produces: `EDIT_STATES.MASKED` (editor montado, iframe morto) e `EDIT_STATES.RELOADING`. Transições: edição ativa + `'runtime-unavailable'` → `MASKED`; `MASKED` + `'runtime-reload-requested'` → `RELOADING`; `RELOADING` + sucesso de abertura (evento existente de sessão pronta) → estado ativo; `RELOADING` + `'runtime-unavailable'` → **`MASKED`** (falha de reload NUNCA desmonta — Sol r3 #7). Falha durante abertura INICIAL (sem trabalho a poupar) mantém o teardown atual.

- [ ] **Step 1:** Ler `edit-state-machine.js` inteiro e mapear os nomes REAIS dos estados/eventos (o case `'runtime-unavailable'` ~linha 83; consumo em `useNativeMotionController.js:563,1166`). O contrato acima se expressa nos nomes reais.
- [ ] **Step 2: Testes RED**

```js
describe('masked/reloading (runtime failure keeps the editor mounted)', () => {
  it('runtime-unavailable during ACTIVE editing lands on MASKED with the failure code', () => {
    const s = reduceToActiveEditing();
    const next = transition(s, { type: 'runtime-unavailable', code: 'session_scope_mismatch' });
    expect(next.state).toBe(EDIT_STATES.MASKED);
    expect(next.failureCode).toBe('session_scope_mismatch');
  });
  it('reload request enters RELOADING', () => {
    const masked = maskedState();
    expect(transition(masked, { type: 'runtime-reload-requested' }).state).toBe(EDIT_STATES.RELOADING);
  });
  it('a FAILED reload returns to MASKED — never teardown', () => {
    const reloading = transition(maskedState(), { type: 'runtime-reload-requested' });
    const next = transition(reloading, { type: 'runtime-unavailable', code: 'x' });
    expect(next.state).toBe(EDIT_STATES.MASKED);
  });
  it('runtime-unavailable during INITIAL opening keeps the current teardown path', () => { /* congela o comportamento de abertura */ });
});
```

- [ ] **Step 3:** RED → implementar → PASS (contagem só cresce — lição 178).
- [ ] **Step 4: Commit** — `feat(motion): MASKED/RELOADING states — mid-edit runtime failure never tears down`

### Task 2: `RuntimeMask` na superfície do PRODUTO (`NativeEditViewport`)

**Files:**
- Create: `components/motion-editor/RuntimeMask.jsx` + `RuntimeMask.test.jsx`
- Modify: `components/motion-editor/NativeEditViewport.jsx` (interceptação + montagem), `components/CanvasNode.jsx:1501-1506` (onUnavailable só abre-falha), `components/CanvasClient.jsx:4663` (toast restrito), `components/motion-editor/useNativeMotionController.js` (`reloadRuntime`)
- Test: `NativeEditViewport.test.jsx` (existente — casos novos)

**Interfaces:**
- Consumes: Task 1.
- Produces: `<RuntimeMask failureCode onReload />`; `commands.reloadRuntime()`. **Interceptação no gatilho REAL** (review r1 P0-3): o efeito em `NativeEditViewport.jsx:50-53` (`status === 'unavailable' && controller.runtimeRecovery?.exhausted` → `reportUnavailable`) passa a: em edição ativa → estado MASKED (renderiza máscara NO LUGAR do iframe; `reportUnavailable`/`onUnavailable` NÃO são chamados); em abertura → comportamento atual (`onUnavailable` → toast).

- [ ] **Step 1: Testes RED do componente**

```jsx
it('renders the friendly message and calls onReload', () => {
  const onReload = vi.fn();
  render(<RuntimeMask onReload={onReload} />);
  expect(screen.getByText(/lost its connection/i)).toBeInTheDocument();
  expect(screen.getByText(/your edits are safe/i)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /reload/i }));
  expect(onReload).toHaveBeenCalledTimes(1);
});
it('is an overlay dialog', () => {
  render(<RuntimeMask onReload={() => {}} />);
  expect(screen.getByRole('alertdialog')).toBeInTheDocument();
});
```

- [ ] **Step 2:** Implementar (overlay `position:absolute; inset:0` dentro do corpo do viewport; tokens do DESIGN.md; copy EN calma: `This clone lost its connection.` / `Your edits are safe. Reload to keep editing.` / botão `Reload`).
- [ ] **Step 3: Testes RED da interceptação** em `NativeEditViewport.test.jsx` (o arquivo já mocka o controller): recovery-exhausted em edição ativa → máscara renderizada, `onUnavailable` NÃO chamado, **iframe DESMONTADO** (`queryByTitle('Native animated website runtime')` null); recovery-exhausted durante abertura → `onUnavailable` chamado (congela o atual); clique em Reload → `commands.reloadRuntime` chamado; reload falho → máscara continua.
- [ ] **Step 4:** Implementar: `NativeEditViewport` deriva `isMasked` do estado da máquina (Task 1); render condicional `isMasked ? <RuntimeMask/> : <iframe .../>`; `reloadRuntime` no controller: despacha `'runtime-reload-requested'` e repete o fluxo de abertura de sessão EXISTENTE (o mesmo que produz `runtimeUrl`), com `runtimeReloadTick` na `key` do iframe.
- [ ] **Step 5:** `CanvasClient.jsx:4663`: toast permanece SÓ para o caminho de abertura. Paridade no laboratório (`NativeMotionEditor.jsx`) com as mesmas mudanças de iframe — secundária, mesma sessão de trabalho.
- [ ] **Step 6:** Suíte inteira → PASS, contagem cresce.
- [ ] **Step 7: Prova no programa aberto** ([[finding_adilson_medir_versus_mostrar]]): Edit num clone nativo no CANVAS (não no lab), derrubar o runtime, screenshot da máscara; religar, Reload, screenshot recuperado. Guardar screenshots junto do plano.
- [ ] **Step 8: Commit** — `feat(motion): RuntimeMask in the product edit surface — masks instead of teardown, reload retries in place`

---

## FASE 2 — Lease server-side `[DB]` exceto onde marcado

### Task 3: Migração — leases + hostname persistido `[DB]`

**Files:**
- Create: `migrations/2026-08-26-runtime-leases.sql`
- Modify: schema de boot (mesmo padrão de `native_motion_edit_sessions`)
- Test: `scripts/migrate.mjs` reconhece tabela E colunas novas

- [ ] **Step 1: SQL**

```sql
-- Hostname por sessão: mintado UMA vez, reusado em todo resume (Sol r3 #2 — sem
-- isto, cada reabertura mudaria a origem e destruiria o cache que o B existe
-- para criar). UNIQUE = registro durável do "nunca reutilizado".
ALTER TABLE native_motion_edit_sessions ADD COLUMN IF NOT EXISTS runtime_hostname TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_native_motion_sessions_runtime_hostname
  ON native_motion_edit_sessions(runtime_hostname) WHERE runtime_hostname IS NOT NULL;

CREATE TABLE IF NOT EXISTS native_runtime_leases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lease_hash CHAR(64) NOT NULL UNIQUE,          -- sha256(cookieValue)
  badge_jti VARCHAR(64) NOT NULL UNIQUE,        -- consumo atômico do badge
  edit_session_id UUID NOT NULL REFERENCES native_motion_edit_sessions(id) ON DELETE CASCADE,
  node_id UUID NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  bundle_id UUID NOT NULL,                      -- "geração": re-clone => sessão nova => host novo; verify confere contra a sessão corrente
  hostname TEXT NOT NULL,
  status VARCHAR(12) NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked','expired')),
  expires_at TIMESTAMPTZ NOT NULL,              -- SLIDING: renew = NOW() + ttl
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  renewed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_native_runtime_leases_session
  ON native_runtime_leases(edit_session_id, status);
-- Lease única ativa por sessão (Sol r4 #1): renovação toca exatamente UMA linha,
-- e uma lease abandonada/replicada não é mantida viva pelo timer do usuário.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_native_runtime_leases_one_active
  ON native_runtime_leases(edit_session_id) WHERE status = 'active';

-- Quota agregada de upload por nó, reservada ATOMICAMENTE (Sol r4 #3: contar-depois-
-- gravar é TOCTOU; o UPDATE condicional reserva antes do putImmutable).
CREATE TABLE IF NOT EXISTS native_node_upload_quota (
  node_id UUID PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
  bytes_used BIGINT NOT NULL DEFAULT 0 CHECK (bytes_used >= 0)
);
```

- [ ] **Step 2:** `migrate.mjs` aplica; 2ª rodada = "em dia".
- [ ] **Step 3: Commit** — `feat(runtime): leases table + persisted per-session hostname (UNIQUE = never reused)`

### Task 4: Badge one-shot `[DB-free]`

**Files:** Create `lib/motion-editor/runtime-lease.js` + `runtime-lease.test.js`

Badge JWT: `typ 'uncraft.runtime-bootstrap.v1'`, `aud 'uncraft-runtime-bootstrap'`, `iss 'uncraft-web-shell'`, `scope 'session:bootstrap'`, `jti` 16 bytes hex, HS256, mesmo segredo dedicado (`typ`/`aud`/`scope` distintos impedem confusão — o verificador legado já recusa `typ` estranho).

- [ ] **Step 1: Testes RED** (espelhar `runtime-session-token.test.js`):

```js
it('mints with own type, audience, scope, jti and 60s TTL', () => { /* decode + asserts */ });
it('legacy verifier REJECTS a badge; badge verifier REJECTS a legacy token', () => {
  expect(verifyRuntimeSessionToken(badge, { secret }).error).toBe('invalid');
  expect(verifyBootstrapBadge(legacyToken, { secret }).error).toBe('invalid');
});
it('payload round-trips; hostname is lowercase [a-z0-9.-], WITHOUT port', () => {
  // porta pertence à authority da URL, nunca à identidade validada (Sol r3 #4)
  expect(() => mintBootstrapBadge({ ...input, hostname: 'abc.rt.localtest.me:3030' })).toThrow();
});
it('expired badge -> {error:"expired"}', () => {});
```

- [ ] **Step 2:** RED → implementar (vocabulário fechado de erros, disciplina de `tokenVerificationFailure`) → PASS.
- [ ] **Step 3: Commit** — `feat(runtime): one-shot bootstrap badge (session:bootstrap, own type/audience)`

### Task 5: Lease CRUD `[DB-free (sql mockado)]`

**Files:** Modify `lib/motion-editor/runtime-lease.js` + test

- [ ] **Step 1: Testes RED:**

```js
it('createLeaseFromBadge consumes the jti atomically (ON CONFLICT DO NOTHING; rowCount 0 -> badge_used)', async () => {});
it('cookieValue is 32 random bytes base64url; only sha256(cookieValue) reaches the DB', async () => {});
it('verifyLease: exact lowercase host equality — mismatch refuses', async () => {});
it('verifyLease: expired/revoked/absent -> typed errors', async () => {});
it('renewLease slides expires_at ONLY on active, unexpired rows (fenced transition — lição 162)', async () => {
  // UPDATE ... SET expires_at = NOW() + interval, renewed_at = NOW()
  //  WHERE edit_session_id = $1 AND status = 'active' AND expires_at > NOW()
});
it('reapExpiredLeases marks active-but-expired as expired', async () => {});
it('lease cookie is a SESSION cookie: no Max-Age, no Expires', () => {
  // Sol r3 #1: idade no cookie mataria a renovação — o browser pararia de
  // enviá-lo às 4h e o app não pode reemitir __Host- de outro host.
  const h = leaseCookieHeader('v');
  expect(h).toBe('__Host-rt=v; Secure; HttpOnly; SameSite=None; Partitioned; Path=/');
  expect(h).not.toMatch(/Max-Age|Expires/i);
});
```

- [ ] **Step 2:** RED → implementar → PASS.
- [ ] **Step 3: Commit** — `feat(runtime): lease CRUD — hashed session cookie, atomic badge consumption, guarded sliding renew, reaper`

### Task 6: Extração do core do gateway (refactor puro) `[DB-free]`

**Files:** Create `lib/motion-editor/runtime-gateway-core.js`; Modify `app/api/runtime/[token]/[...path]/route.js`; Test: o `.test.js` EXISTENTE da rota, inalterado.

- [ ] **Step 1:** Rodar a suíte da rota ANTES e ANOTAR a contagem exata.
- [ ] **Step 2:** Extração mecânica: o corpo do GET (descriptor, `_uploads` GET, range/206, reescrita/tradução, injeção do bridge, matriz de cache, `inertFailure`) vira `serveRuntimeAsset(...)`; a rota legada autoriza por token (inalterado) e delega com `runtimeBase='/api/runtime/<token>'`, `corsWildcard:true`. Caminho lease NÃO emite `Access-Control-Allow-Origin` (same-origin não precisa; `*` com cookie é veneno).
- [ ] **Step 3:** MESMA suíte → PASS com a MESMA contagem.
- [ ] **Step 4: Commit** — `refactor(runtime): extract gateway core, behavior-identical (route test count preserved)`

### Task 7: Bootstrap cookie-first + rota `/api/rt` `[DB]`

**Files:** Create `app/api/runtime-bootstrap/[badge]/route.js` + test, `app/api/rt/[sessionId]/[...path]/route.js` + test

**Interfaces:**
- Produces: `GET /api/runtime-bootstrap/<badge>` → `Set-Cookie` + `303 /api/rt/<sessionId>/<entryPath>`; `GET/HEAD /api/rt/<sessionId>/<...path>` cookie-authed.
- **Bootstrap cookie-first SEM deixar o badge vivo** (review r1 #6 + Sol r4 #1): o badge é
  consumido SEMPRE (jti gravado) já no primeiro contato; um badge REPETIDO só passa quando o
  request apresenta o cookie da MESMA lease que o consumiu (StrictMode double-mount, bfcache,
  `location.reload()` — remount incidental tolerado sem janela de replay para outro jar).

- [ ] **Step 1: Testes RED do bootstrap:**

```js
it('valid badge -> consumes jti + session Set-Cookie + 303 to clean entry URL (no credential in Location)', async () => {
  expect(res.status).toBe(303);
  expect(res.headers.get('Location')).toBe(`/api/rt/${sessionId}/${entryPath}`);
  expect(res.headers.get('Set-Cookie')).toMatch(/^__Host-rt=[^;]+; Secure; HttpOnly; SameSite=None; Partitioned; Path=\/$/);
  expect(res.headers.get('Cache-Control')).toBe('no-store');
});
it('same badge again WITH the cookie of the lease that consumed it -> 303, no new lease (StrictMode consumes exactly one)', async () => {});
it('same badge again WITHOUT that cookie -> inert failure, no cookie (no 60s replay window for another jar)', async () => {});
it('badge hostname != request host -> inert failure', async () => {});
it('flag off -> 404 inert', async () => {});
it('new lease for the session revokes the previous one (single-active invariant)', async () => {});
```

- [ ] **Step 2: Testes RED de `/api/rt`:** matriz de recusa espelhando a legada (sem cookie / inválido / host errado / lease expirada / sessionId≠lease / sessão revogada) → `inertFailure` com corpo/status IDÊNTICOS entre motivos (invariante sem-oráculo); caminho feliz segue a **matriz de cache** do topo; SEM header ACAO; respostas levam `Origin-Agent-Cluster: ?1` e `Cross-Origin-Resource-Policy: same-origin` (Sol r4 #2); HTML injeta bridge com `runtimeBase='/api/rt/<sessionId>'`; POST → `inertFailure` (upload não mora aqui); **query string → `301` para o caminho canônico sem query, com `Cache-Control: private, max-age=<restante da lease>`** — equivalência com o comportamento ATUAL (o lookup legado já é por path do assetIndex; query é ignorada hoje), só colapsando as variantes numa entrada de cache; testes: duas queries diferentes → mesmo destino, redirect seguido não loopa, redirect não escapa do rate limit; **teste de revogação**: revogar a lease → pedido seguinte de QUALQUER asset recusa, e a ENTRADA (HTML `no-store`) não abre do cache.
- [ ] **Step 3:** Implementar sobre o core; badge/cookie redigidos de logs (só `tokenDigest`). **Rate limit por sessão** no gateway lease: token bucket em memória contando REQUESTS e BYTES (ex. 600 req/min e 200MB/min por sessão — um clone real abre ~370 assets uma vez; Range/304 contam), `429 no-store` acima. ⚠️ Dívida NOMEADA (Sol r4 #3): bucket é por processo — em implantação multi-instância cada uma concede o próprio orçamento; contador compartilhado (Redis) é infra deferida do launch ([[launch_cost_optimizations_deferred]]); o teto real interino é `N instâncias × teto`. Nota de modelo de ameaça no código: a exclusão de site adversarial (decisão 2026-08-09/178) cobre o site sabotar o PRÓPRIO clone — gasto de dinheiro NOSSO (egress/DB) não está coberto por ela.
- [ ] **Step 4:** PASS; suíte inteira verde.
- [ ] **Step 5: Commit** — `feat(runtime): cookie-first bootstrap + cookie-authed clean-URL gateway (no-oracle, canonical, rate-limited)`

### Task 8: Emissão idempotente + renovação sliding + revogação `[DB]`

**Files:** Modify `app/api/nodes/[id]/runtime-session/route.js`, `lib/motion-editor/edit-session-store.js`; Create `app/api/nodes/[id]/runtime-session/renew/route.js`; tests correspondentes

**Interfaces:**
- Produces: flag on → POST devolve `runtime: { url: 'https://<hostname-DA-SESSÃO>/api/runtime-bootstrap/<badge>', mode: 'lease', origin, expiresAt }`. **Hostname: lido da sessão; mintado SÓ se `runtime_hostname IS NULL`, por CAS** — `UPDATE native_motion_edit_sessions SET runtime_hostname = ${mint} WHERE id = ${sid} AND runtime_hostname IS NULL RETURNING runtime_hostname`; rowCount 0 = outro open venceu → RELER e usar o vencedor; o badge é assinado SÓ depois de ler o valor persistido (Sol r4 #5 — dois opens concorrentes nunca produzem badges de hosts diferentes). Resume/F5 devolve o MESMO host (Sol r3 #2); badge sempre fresco (o bootstrap cookie-first torna isso barato). `POST .../renew` → requireUser + dono do node + sessão ativa → `renewLease` + `expires_at` da sessão = NOW()+4h (sliding nas duas linhas). Commit/discard/supersede da sessão → `revokeLeasesForSession`. **Divergência deliberada do Sol r2 §3.3.3** (que sugeria renovação por postMessage): renovar do PARENT com cookie de login é mais seguro que rotear renovação pelo clone não-confiável — registrado como intencional (review r1 #8).

- [ ] **Step 1: Testes RED** — emissão: 1º open minta e PERSISTE hostname; resume devolve o mesmo; re-clone (sessão nova) minta outro; renew: sliding nas duas linhas, 404 node alheio, recusa tipada para sessão não-ativa; close revoga leases (teste no edit-session-store espelhando vizinhos).
- [ ] **Step 2:** RED → implementar → PASS. Renovação NÃO emite cookie nem muda URL — só UPDATE (é isso que mata a imagem das 4h sem reload).
- [ ] **Step 3:** Reaper: chamar `reapExpiredLeases` no cron existente (`/api/cron/reconcile-holds` é o precedente de agendamento; acrescentar chamada ou rota irmã).
- [ ] **Step 4: Commit** — `feat(runtime): idempotent issuance on persisted hostname + sliding renew + revoke on close`

---

## FASE 3 — Hostname + SW + CSP + upload bridge + troca do iframe

### Task 9: `runtime-csp.js` — uma fonte para header e meta `[DB-free]`

**Files:** Create `lib/motion-editor/runtime-csp.js` + test; Modify `runtime-gateway-core.js` (header), `native-clone-gateway.js:~197` (meta), `lib/native-clone/capture-bundle.js` (strip de metas CSP autorais)

- [ ] **Step 1: Testes RED**

```js
it('header and meta serialize from the SAME structured policy', () => {
  const strip = (csp) => csp.split('; ').filter((d) => !d.startsWith('frame-ancestors')).sort().join('; ');
  expect(strip(runtimeCspHeader({ frameAncestor: 'https://app.example' }))).toBe(strip(runtimeCspMeta()));
  expect(runtimeCspHeader({ frameAncestor: 'https://app.example' })).toContain('frame-ancestors https://app.example');
  expect(runtimeCspMeta()).not.toContain('frame-ancestors');
  expect(runtimeCspMeta()).toContain("worker-src 'self' blob:");   // o furo atual (route.js:58 × gateway:201), fechado
});
```

- [ ] **Step 2:** RED → implementar → apontar core e `injectRuntimeBridge` → PASS. ⚠️ MUDANÇA que alcança o legado (hardening declarado): a meta ganha `worker-src`; provar neutralidade = suíte da rota legada com contagem preservada + anotação no commit.
- [ ] **Step 3 (AJUSTADO na execução):** o produtor entrega o documento SERVIDO (bytes congelados — comentário em `capture-bundle.js:657`), não serialização de DOM vivo → a rota "remover via DOM" NÃO EXISTE neste produtor, e remover por regex é a classe proibida (163/164). Implementação honesta: detector puro `htmlCarriesAuthoredCspMeta` (detecção, não mutação — falso positivo em comentário custa um aviso, nunca corrupção) + `console.warn` no gateway quando o HTML servido carrega meta CSP autoral. Neutralização real fica DEFERIDA para a lane do tokenizer HTML (residual nomeado; sites com CSP meta já quebravam o bridge HOJE — pré-existente, agora visível).
- [ ] **Step 4: Commit** — `feat(runtime): single structured CSP source; producer strips captured CSP metas via DOM`

### Task 10: Hostname/authority + host guard `[DB-free]`

**Files (AJUSTADO na execução):** Modify `lib/motion-editor/runtime-lease.js` (mint/usesSessionHost — coesão com a identidade de host da lease); Create `lib/runtime-host-guard.js` (decisão PURA, livre de node:crypto — middleware roda em edge e não pode importar o módulo da lease) + `middleware.js` + testes

**Interfaces:**
- Produces: `mintRuntimeHostname({ suffix })` → `'<32-hex>.'+suffix` (128 bits; label de 32 chars < teto de 63 do DNS) — **suffix é HOSTNAME puro** (`rt.localtest.me`, `rt.uncraft.app`); porta/esquema vivem em `UNCRAFT_RUNTIME_AUTHORITY_TEMPLATE` (dev `https://{host}:3443`, prod `https://{host}`) usado só na CONSTRUÇÃO de URL (Sol r3 #4: identidade validada nunca carrega porta); `runtimeRequestUsesSessionHost(requestUrl, expectedHostname)` compara `new URL(u).hostname` (sem porta) em lowercase; middleware (Next 15 — convenção vigente NESTE repo; refutada a alegação de rename): host casa `*.<sufixo>` → só `/api/rt/`, `/api/runtime-bootstrap/`, `/api/runtime/`; resto 404; em produção, host do APP não serve `/api/rt/*`.

- [ ] **Step 1: Testes RED** — mint (shape 32-hex, sufixo vazio recusa, sufixo com porta recusa; colisão INJETADA no insert → retry de `unique_violation` uma vez — Sol r4 #5: "1000 sem colisão" testa sorte, não tratamento); guard (matriz host×rota; dev sem sufixo → passa tudo, atual intacto). Middleware lê `request.headers.get('host')` e DESCARTA a porta antes de casar (⚠️ `next dev` mente no origin de `request.url` — lição 167; o header Host é a verdade). **Startup check** (prod): eTLD+1 do sufixo ≠ eTLD+1 do app (Sol r4 #2; evolução do check de `resolveRuntimeOrigin`).
- [ ] **Step 2:** RED → implementar → PASS.
- [ ] **Step 3: Prova no servidor REAL** (parte boa do achado r3 #4 que sobrevive à refutação do rename): com o dev server de pé, `curl` matrix — runtime host + rota de app → 404; runtime host + `/api/rt/...` → alcança a rota. Um teste unitário da função não prova que o guard está INSTALADO.
- [ ] **Step 4:** Infra do Adilson, nomeada (não executada por agente): wildcard DNS `*.rt.<domínio>` + wildcard domain/cert no Vercel.
- [ ] **Step 5: Commit** — `feat(runtime): per-session hostname (pure-host identity, authority template) + host-guard middleware proven live`

### Task 11: Recusa de service worker por enforcement `[DB-free]`

**Files:** Modify `runtime-gateway-core.js`; Test na rota `/api/rt`

`allow-same-origin` torna SW registrável e `worker-src` não separa Worker de ServiceWorker (clones usam Worker legítimo). O registro busca o script com header **`Service-Worker: script`** — ponto de recusa determinístico (spec §4).

- [ ] **Step 1: Testes RED** — request com `service-worker: script` → `403 no-store`; MESMO path sem o header → serve (braço de controle — zero sem controle não vale, lição 177).
- [ ] **Step 2:** RED → implementar no core (vale para os DOIS caminhos; no legado é inalcançável hoje — hardening declarado, contagem preservada) → PASS.
- [ ] **Step 3: Commit** — `feat(runtime): refuse service-worker registration by enforcement (Service-Worker: script -> 403)`

### Task 12: Ponte de upload pelo parent `[DB]`

**Files:** Create `lib/native-clone/native-uploads.js` + test, `app/api/nodes/[id]/native-uploads/route.js` + test; Modify `packages/editor-core/src/editor.js:7549` (+ `bash scripts/build-editor.sh`), `components/motion-editor/useNativeMotionController.js` (handler da ponte), `app/api/runtime/[token]/[...path]/route.js` (POST delega à lib)

**Premissa corrigida (review r1 P0-2):** o upload parte de DENTRO do clone (`editor.js:7549`, `targetWin.fetch('./_uploads', {method:'POST'})`) — em modo lease o iframe não tem cookie de login (eTLD+1 separado, `SameSite=Lax`) e a lease não autoriza POST. **Desenho: ponte por postMessage.**

- [ ] **Step 1:** Extrair o pipeline (teto ANTES de materializar, bytes mágicos dos 5 formatos, hash-nome, `putImmutable`) para `native-uploads.js`; testes RED espelhando os casos da rota legada (413 declarado, 413 corpo, 415 sem mágica, idempotência por hash). Rota legada delega à lib; contagem preservada.
- [ ] **Step 2:** Rota nova `POST /api/nodes/[id]/native-uploads`: `requireUser` + dono do node + **sessão de edição ativa no node** (a MESMA condição da rota legada: linha `active` não expirada) + pipeline → `{ path: './_uploads/<hash>.<ext>' }`. **Quota agregada ATÔMICA** (Sol r4 #3 — contar-depois-gravar é TOCTOU): reservar ANTES do `putImmutable` com `UPDATE native_node_upload_quota SET bytes_used = bytes_used + ${n} WHERE node_id = ${id} AND bytes_used + ${n} <= ${TETO} RETURNING bytes_used` (upsert da linha no primeiro uso; rowCount 0 = 413 tipado); falha do put devolve a reserva (mesma disciplina de settle do 161/162). Teto: 64MB por nó.
- [ ] **Step 3:** Ponte com os 4 eixos NOS DOIS SENTIDOS (Sol r4 #4): em modo lease, `editor.js` posta `{ type: 'uncraft:upload-request', id, bytes: ArrayBuffer, name }` ao parent (transferable; id de uso único). Parent (controller, com cookie de login): valida `event.source === iframe.contentWindow` + `event.origin` + nonce + tipo na allowlist; recusa `SharedArrayBuffer`/views (só `ArrayBuffer` cru); checa teto ANTES de enviar; **fila com concorrência máx. 2 e teto de bytes em voo (32MB)**; POSTa e responde `{ type: 'uncraft:upload-result', id, path | error }`. Bridge (lado do clone): aceita resultado só se `event.source === window.parent` + `event.origin === appOrigin` + nonce + `id` presente no mapa de pendentes (uso único — duplicado/tardio descartado) + `path` casando `^\.\/(_uploads)\/[0-9a-f]{16,64}\.(?:png|jpe?g|gif|webp|avif)$`. Modo legado: caminho atual intacto. Testes RED nos dois lados, incluindo braço negativo de frame irmão TAMBÉM no bridge.
- [ ] **Step 4:** `bash scripts/build-editor.sh` (editor-core é compartilhado — regra do repo). Suíte inteira verde.
- [ ] **Step 5: Commit** — `feat(runtime): upload bridge via parent — the lease never authorizes mutation`

### Task 13: Troca do iframe + postMessage endurecido + laço de renovação `[DB]`

**Files:** Modify `components/motion-editor/NativeEditViewport.jsx` (sandbox/src), `components/motion-editor/NativeMotionEditor.jsx` (paridade lab), `useNativeMotionController.js`, `lib/motion-editor/native-clone-gateway.js` (config `appOrigin`/`leaseMode`), `lib/motion-editor/runtime-bridge-source.js`, `app/api/nodes/[id]/runtime-session/route.js` (resposta já traz `origin` — Task 8)

- [ ] **Step 1: Sandbox condicional** — modo lease: `sandbox="allow-scripts allow-same-origin allow-pointer-lock"`; legado: atual. Pré-condições JÁ shipadas nesta ordem: host guard (T10), SW refusal (T11), CSP (T9) — o embutido continua cross-origin com o app (o alerta clássico de escape é para same-origin com o parent — Sol r1 §7). O `src` é a URL de bootstrap UMA vez; nunca re-setar para badge fora de `reloadRuntime` (o bootstrap cookie-first tolera remount incidental — T7).
- [ ] **Step 2: postMessage endurecido** (Sol r3 #5 — os QUATRO eixos do r1 §7, não só origem): parent aceita mensagem apenas se `event.source === iframeRef.current?.contentWindow` **E** `event.origin === runtime.origin` **E** envelope válido (o nonce de sessão EXISTENTE — `matchesRuntimeContext` em `protocol.js:28` já compara origem quando configurada; manter o nonce TAMBÉM em modo lease) **E** tipo na allowlist do protocolo. Bridge: aceita apenas `event.origin === appOrigin` (config) + nonce; TODOS os `postMessage` do bridge usam `appOrigin` como targetOrigin em modo lease (os dois call-sites `'*'` em `useNativeMotionController.js:508,1014` + os do bridge). Testes RED nos dois lados, incluindo braço negativo (mensagem de frame irmão com origem certa e `source` errado → ignorada).
- [ ] **Step 3: Renovação** — controller, editor aberto em modo lease: `setInterval(LEASE_RENEW_INTERVAL_MS)` → `POST .../renew`. **Política de falha em dois regimes** (Sol r4 #7 — duas falhas de rede não podem mascarar uma lease válida por horas): recusa TERMINAL autenticada (401/403/409 com código tipado: revogada, sessão inativa, ownership perdido) → `'runtime-unavailable'` imediato (máscara); rede/5xx/timeout → backoff com jitter (30s→60s→120s, teto 120s) CONTINUANDO a editar, e só mascara quando `Date.now()` cruza `expiresAt - margem (15min)` sem renovação bem-sucedida. Teste: N falhas transitórias seguidas de recuperação SEM entrar em MASKED; recusa terminal mascara na hora. Interval limpo no unmount/exit. Timers fake.
- [ ] **Step 4: Witness no programa aberto** (exige HTTPS local — T14 Step 1 vem ANTES): abrir Edit no canvas → Network: URLs limpas sem token, cookie enviado, 200 na 1ª abertura; F5 do app → MESMO hostname (sessão retomada) e assets `(disk cache)`; TTL de teste curto por env → renovação observada → imagem lazy pedida DEPOIS do TTL original carrega (o defeito das 4h, morto). Screenshots.
- [ ] **Step 5: Commit** — `feat(runtime): same-origin sandbox on persisted per-session host, 4-axis postMessage validation, sliding renewal loop`

---

## FASE 4 — Réguas de aceite (antes×depois)

### Task 14: HTTPS local + probe de bytes `[DB]` + Chrome de marca

**Files:** Create `scripts/medir-entrega-runtime.mjs`; docs de setup no próprio script

- [ ] **Step 1: Pré-requisito HTTPS local** (as DUAS reviews exigiram: `__Host-`/`Partitioned`/`SameSite=None` pedem `Secure`, e Chrome só isenta `localhost` literal — `rt.localtest.me` em http NÃO recebe o cookie): mkcert wildcard `*.rt.localtest.me` + proxy TLS local (ex. Caddy `https://*.rt.localtest.me:3443 -> :3030`) documentado no script. Sem isto o witness da T13 e este aceite não rodam.
- [ ] **Step 2: Probe** sobre o harness validado (`_probe-cache-opaco-corpo-inteiro.mjs`: `channel:'chrome'`, perfil persistente): bytes de rede REAIS (CDP `Network.loadingFinished` → `encodedDataLength`) em três momentos — **abrir sem rolar / rolar até o fim / reload** — cada abertura com asserção positiva de decodificação (`img.complete && naturalWidth > 0`; zero sem controle não vale — lição 177).
- [ ] **Step 3: Linha de base (flag OFF)** — reload re-paga tudo (reproduz o finding de 25/08).
- [ ] **Step 4: Depois (flag ON)** — **aceite: bytes de reload ≈ 0** (só HTML `no-store` + revalidações); registrar o delta abrir×rolar (o que o lazy economiza de verdade). Reabertura da sessão (F5 do app) TAMBÉM medida — é o que o hostname persistido compra.
- [ ] **Step 5:** Re-executar o produtor ATUAL uma vez e pesar o bundle — nenhum número de custo volta a ser citado sem isso (errata do artefato econômico).
- [ ] **Step 6:** Finding `packages/web-shell/docs/superpowers/findings/2026-08-XX-aceite-lease-b.md`: números, browser/versão, matriz de capacidade CHIPS por browser (Safari 18.4/18.5 REGISTRADO como aberto — relato de desativação não verificado de 1ª mão), Safari/Firefox ABERTOS (instrumentos falharam nos controles — finding 25/08), e a infra do Adilson (wildcard DNS/cert no Vercel) como pendência nomeada.
- [ ] **Step 7: Commit** — `test(runtime): acceptance probe — bytes per moment, before/after lease (reload ~= 0)`

---

## FASE 5 — [GATED] A (banco público) — NÃO FAZER NESTE PLANO

Registrado para não se perder (spec §7): descritor v2 (classe/publicAssetId/versão do classificador no descriptor E no hash; bundles v1 privados para sempre), 3 classes em 2 eixos (`visibility` × `activeContent`; só passivo-farejado publica; HTML/JS/CSS/JSON/SVG/reescrito NUNCA), prova de publicidade POSITIVA, mídia grande por Public Blob direto, ID opaco. **SE o A acontece é decisão do Adilson, depois do B, com os bytes reais do aceite na mão.** Nenhuma task aqui.

---

## Riscos nomeados (para o auditor)

1. **Fases 2/3 acopladas de propósito**: cookie exige `allow-same-origin`; `allow-same-origin` exige host isolado + SW refusal + CSP — por isso a troca do sandbox (T13) vem por último, atrás das pré-condições shipadas.
2. **Cookie de sessão + lease sliding**: a expiração é 100% server-side; browser que restaura sessão ("continue where you left off") re-envia o cookie e o servidor decide. Residual: cache do browser não vê revogação por até `max-age` (classe pré-existente de 2026-08-20, nomeada; a partição por sessão a limita ao próprio perfil).
3. **Bundles v1 com meta CSP do site**: warn no gateway, sem reescrita (regex não estabelece contexto — 163/164); produtor remove por DOM daqui em diante.
4. **CHIPS**: matriz de capacidade por browser no aceite; Safari fora do claim até prova. Flag permite manter modo legado por user-agent se doer (decisão de produto adiada até o aceite).
5. **Gasto por JS hostil** (Sol r3 #6 / r4 #3): rate limit por sessão (requests E bytes) + redirect canônico de query + quota de upload atômica no banco. Dívida nomeada: bucket por instância até o contador compartilhado (Redis, infra do launch). A exclusão de site adversarial (178) cobre integridade do próprio clone, NÃO custo nosso — nota no código.
6. **Renovação pelo parent** diverge do r2 §3.3.3 (postMessage) DELIBERADAMENTE: mais seguro que rotear renovação pelo clone não-confiável.
7. **Descartado com fundamento** (r4): registro append-only de hostnames (128 bits aleatórios tornam reuso por colisão desprezível; o `UNIQUE` + retry é cinto suficiente); recusa seca de query strings (quebraria cache-buster legítimo — o redirect canônico é equivalente ao ignore-query que o gateway JÁ pratica).
