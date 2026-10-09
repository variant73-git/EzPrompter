# Cópia editável no Edit — M1 (preparar e mostrar) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ao clicar Edit num node de site (atrás de interruptor de desenvolvimento), o Uncraft prepara a cópia
canônica numa máquina virtual descartável, mostra o progresso real no node (site borrado + número grande + anel)
e abre a cópia no editor quando fica pronta; em falha, mostra o motivo com "Try again" / "Open live clone instead".

**Architecture:** uma tarefa persistida (`canonical_jobs`) cercada por status + geração + dono da trava avança
em passos curtos a cada consulta do canvas (sem fila nem worker). A montagem roda o script existente
`scripts/normalizar-clone.mjs` sem mudança de lógica dentro de um Vercel Sandbox (4 vCPU, nome determinístico,
sem credenciais), que escreve o progresso num arquivo. O resultado vira um pacote registrado pelo caminho que já
existe (`registerNativeBundle`) e um snapshot `canonical`, publicado por comparação-e-troca numa única instrução.
O node passa a abrir esse pacote no editor nativo, que já serve qualquer pacote registrado.

**Tech Stack:** Next.js 15 (rotas `app/api`), Neon Postgres (`sql` tagged template), Vitest + Testing Library
(jsdom), `@vercel/sandbox` 3.6.1, `tar-stream` 3.1.7, Playwright 1.60 dentro da máquina.

**Spec:** `docs/superpowers/specs/2026-10-09-copia-editavel-no-edit-design.md` (§0, §1, §2, §4, §5, §10 M1).

## Global Constraints

- Tudo atrás de dois interruptores: servidor `UNCRAFT_CANONICAL_EDIT=1` (só servidor, fail-closed: ausente = rotas
  respondem 404 `canonical_disabled`) e canvas `NEXT_PUBLIC_CANONICAL_EDIT=1`. `NEXT_PUBLIC_*` não é fronteira de
  segurança; quem decide é o servidor.
- Máquina: `resources.vcpus = 4`, `timeout = 30 min`, `persistent: false`, nome `uc-canon-<jobId>-a<attempt>`.
- Dentro da máquina: `playwright-core 1.60.0`, `playwright 1.60.0`, `gsap 3.15.0`, `lenis 1.3.26`,
  `lottie-web 5.13.0`; navegador instalado com `PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64`.
- Protocolo de gravação = padrão do script (laço agrupado + assentar 1,0 s). Não passar `UNCRAFT_ASSENTAR_MS` nem
  `UNCRAFT_LACOS_AGRUPADOS`.
- Modo de movimento `decl+leitura`; M1 roda com `--sem-plano` (cena 3D é M2).
- Nenhuma credencial (banco, Blob, Vercel) entra na máquina.
- Snapshot novo: `source = 'canonical'` (cabe em `VARCHAR(20)`).
- Preço da preparação: operação `clone.canonical`, 0 créditos (pricing decide depois); a captura nativa continua
  cobrando como hoje (`clone.edit`).
- Texto de produto em inglês. Nunca fontes JetBrains.
- web-shell usa **bun** para dependências (`bun.lock` é a fonte da verdade). Comandos de teste sempre com
  `cd packages/web-shell && npx vitest run <arquivo>` (o `cd` persiste entre chamadas — saída vazia de teste é
  alarme, não "passou").
- Trabalhar num worktree (o checkout principal está sujo) — Task 0.
- Interruptor ligado no dev aponta para o banco do produto: na primeira subida do servidor o `schema.sql` cria a
  tabela `canonical_jobs` (só acréscimo). Avisar o Adilson antes da Task 15.

## Review Focus

1. **Dois cliques / duas abas durante a preparação** → uma única tarefa e uma única máquina; a segunda aba vê o mesmo
   progresso. (Teste: `startCanonicalJob` devolve a tarefa ativa; `advanceCanonicalJob` com trava alheia não chama
   a máquina — Task 6 e Task 7.)
2. **A requisição morre no meio de um passo** (função cortada pelo tempo), inclusive entre iniciar o comando e gravar o
   estado → a próxima consulta retoma sem segunda máquina nem segundo comando, e uma requisição velha que perdeu a
   trava não mexe em nada. (Testes: marca `iniciado` na máquina impede reinício; trava tomada no meio aborta sem
   desligar nem cobrar — Task 7; o próprio script recusa uma segunda execução — Task 5.)
3. **O node muda durante os ~6 minutos** (o usuário abre o clone vivo e salva) → a cópia NÃO sobrescreve; falha
   `publish_conflict` com escolha. (Teste: publicação sem linha devolvida → `publish_conflict` — Task 5 e Task 7.)
4. **O usuário move o node enquanto espera** → quando a cópia chega, a posição nova fica. (Teste: `readyNodeFrom`
   aplica o resultado ao node ATUAL, não ao capturado no clique — Task 12.)
5. **A página cresce durante a gravação** (conteúdo preguiçoso) → o número desacelera, nunca volta. (Teste:
   `monotonicPct` e o hook de progresso — Task 2 e Task 10.)

---

## Mapa de arquivos

| arquivo | responsabilidade |
|---|---|
| `scripts/normalizar-clone.mjs` (modificar) | anotar uma linha de progresso por parada quando `UNCRAFT_PROGRESSO` aponta um arquivo |
| `lib/canonical/progress.js` (novo) | traduzir estágio/linha da máquina em porcentagem; nunca voltar |
| `schema.sql`, `migrations/2026-10-09-canonical-jobs.sql`, `scripts/migrate.mjs` (modificar/novo) | tabela `canonical_jobs` |
| `lib/canonical/job-store.js` (novo) | SQL da tarefa: inserir, ler pelo dono, trava, transições cercadas |
| `lib/canonical/sandbox-runner.js` (novo) | falar com o Vercel Sandbox; script que roda dentro da máquina |
| `lib/canonical/payload.js` (novo) | arquivos de código + captura que vão para a máquina |
| `lib/canonical/output-bundle.js` (novo) | ler o `.tgz` da máquina e montar a entrada do `registerNativeBundle` |
| `lib/canonical/publish.js` (novo) | snapshot `canonical` + node + tarefa `ready` numa instrução só |
| `lib/canonical/job-service.js` (novo) | iniciar, avançar (máquina de estados), varrer vencidas |
| `lib/node-editor-kind.js` (modificar) | `'canonical'` conta como snapshot nativo |
| `lib/billing/pricing.js`, `lib/billing/operations.js` (modificar) | preço 0 e reserva viva fora da varredura |
| `app/api/nodes/[id]/canonical-job/route.js`, `app/api/canonical-jobs/[id]/advance/route.js` (novos) | rotas |
| `app/api/cron/reconcile-holds/route.js`, `next.config.js` (modificar) | varredura e inclusão dos scripts no pacote da função |
| `lib/canvas-api.js` (modificar), `lib/canonical/poller.js` (novo), `components/useCanonicalPrep.js` (novo) | cliente |
| `lib/canonical/edit-entry.js`, `lib/canonical/error-copy.js` (novos) | decisão do Edit; textos de erro |
| `components/CanonicalPrepOverlay.jsx` (novo), `components/CanvasNode.jsx`, `components/CanvasNodeItem.jsx`, `components/CanvasClient.jsx`, `app/globals.css` (modificar) | UI no node e fiação |

---

### Task 0: Worktree e dependências

**Files:** nenhum arquivo do repo além de `packages/web-shell/package.json` e `packages/web-shell/bun.lock`.

- [ ] **Step 1: Criar o worktree a partir da ponta atual**

```bash
cd /Users/adilsonporto/Desktop/IA/Uncraft
git worktree add ../Uncraft-m1 -b feat/canonical-edit-m1 HEAD
cp packages/web-shell/.env.local ../Uncraft-m1/packages/web-shell/.env.local
mkdir -p ../Uncraft-m1/packages/web-shell/.vercel && cp packages/web-shell/.vercel/project.json ../Uncraft-m1/packages/web-shell/.vercel/project.json
```

Os dois arquivos copiados são ignorados pelo git (segredos e vínculo do projeto) — nunca commitar.

- [ ] **Step 2: Instalar dependências e as duas novas**

```bash
cd /Users/adilsonporto/Desktop/IA/Uncraft-m1/packages/web-shell
bun install
bun add @vercel/sandbox@3.6.1 tar-stream@3.1.7
```

- [ ] **Step 3: Conferir a suíte verde antes de mexer**

Run: `cd /Users/adilsonporto/Desktop/IA/Uncraft-m1/packages/web-shell && npx vitest run 2>&1 | tail -5`
Expected: `Test Files ... passed`, nenhum `failed`. Anotar a contagem (referência para as próximas tasks).

- [ ] **Step 4: Commit**

```bash
git add package.json bun.lock
git commit -m "chore(canonical): add @vercel/sandbox and tar-stream"
```

Todas as tasks seguintes rodam em `/Users/adilsonporto/Desktop/IA/Uncraft-m1`.

---

### Task 1: Progresso por parada no script de montagem

**Files:**
- Modify: `packages/web-shell/scripts/normalizar-clone.mjs` (imports linha 20; bloco após `PROTOCOLO_GRAVACAO`; laço de `gravarLeitura`, linhas ~479-497)
- Test: `packages/web-shell/scripts/normalizar-progresso.test.js`

**Interfaces:**
- Produces: `export function anotarProgresso(arquivo: string|null, entrada: object): void`; linhas JSONL
  `{"fase":"gravando","feitas":n,"total":m}` e `{"fase":"montando"}` no arquivo de `UNCRAFT_PROGRESSO`.

- [ ] **Step 1: Write the failing test**

```js
// packages/web-shell/scripts/normalizar-progresso.test.js
import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { anotarProgresso } from './normalizar-clone.mjs';

describe('anotarProgresso', () => {
  it('acrescenta uma linha JSON por chamada', () => {
    const arq = path.join(mkdtempSync(path.join(tmpdir(), 'prog-')), 'progresso.jsonl');
    anotarProgresso(arq, { fase: 'gravando', feitas: 1, total: 40 });
    anotarProgresso(arq, { fase: 'montando' });
    const linhas = readFileSync(arq, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(linhas).toEqual([{ fase: 'gravando', feitas: 1, total: 40 }, { fase: 'montando' }]);
  });

  it('sem arquivo não faz nada', () => {
    expect(() => anotarProgresso(null, { fase: 'gravando' })).not.toThrow();
  });

  it('nunca derruba a gravação quando o arquivo não pode ser escrito', () => {
    expect(() => anotarProgresso('/caminho/que/nao/existe/p.jsonl', { fase: 'gravando' })).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/web-shell && npx vitest run scripts/normalizar-progresso.test.js`
Expected: FAIL — `anotarProgresso is not a function` (ou "does not provide an export named").

- [ ] **Step 3: Write minimal implementation**

Na linha 20 trocar `import { existsSync } from 'node:fs';` por:

```js
import { appendFileSync, existsSync } from 'node:fs';
```

Logo depois de `export const PROTOCOLO_GRAVACAO = ...` acrescentar:

```js
// PROGRESSO (2026-10-09, cópia no Edit): a máquina que monta a cópia conta as paradas num arquivo que o
// servidor lê para o número do node. Uma linha JSON por parada; nunca derruba a gravação (é cosmético).
const PROGRESSO = process.env.UNCRAFT_PROGRESSO || null;
export function anotarProgresso(arquivo, entrada) {
  if (!arquivo) return;
  try { appendFileSync(arquivo, `${JSON.stringify(entrada)}\n`); } catch { /* progresso é cosmético */ }
}
```

No laço de `gravarLeitura`, logo depois de `amostras.push({ y, a, b, telasA, telas });` (ainda dentro do `for`):

```js
    anotarProgresso(PROGRESSO, { fase: 'gravando', feitas: i + 1, total: lista.length });
```

Logo depois do `}` que fecha esse `for` (antes do comentário `// TESTE DE LACO`):

```js
  anotarProgresso(PROGRESSO, { fase: 'montando' });
```

- [ ] **Step 4: Run test to verify it passes (e que o protocolo não mudou)**

Run: `cd packages/web-shell && npx vitest run scripts/normalizar-progresso.test.js scripts/caminhos-movimento.test.js`
Expected: PASS nos dois arquivos.

- [ ] **Step 5: Commit**

```bash
git add packages/web-shell/scripts/normalizar-clone.mjs packages/web-shell/scripts/normalizar-progresso.test.js
git commit -m "feat(canonical): recording writes one progress line per scroll stop"
```

---

### Task 2: Porcentagem a partir do estágio

**Files:**
- Create: `packages/web-shell/lib/canonical/progress.js`
- Test: `packages/web-shell/lib/canonical/progress.test.js`

**Interfaces:**
- Produces: `PCT` (constantes), `parseProgressLog(text) → {fase,...}|null`, `pctFromVm(entry) → number|null`,
  `monotonicPct(prev, next) → number`, `capturePhasePct(elapsedMs, expectedMs=25000) → number`.

- [ ] **Step 1: Write the failing test**

```js
// packages/web-shell/lib/canonical/progress.test.js
import { describe, expect, it } from 'vitest';
import { PCT, capturePhasePct, monotonicPct, parseProgressLog, pctFromVm } from './progress.js';

describe('progresso da cópia', () => {
  it('lê a última linha válida e ignora a linha cortada no meio da escrita', () => {
    const log = '{"fase":"instalando"}\n{"fase":"gravando","feitas":3,"total":40}\n{"fase":"grav';
    expect(parseProgressLog(log)).toEqual({ fase: 'gravando', feitas: 3, total: 40 });
    expect(parseProgressLog('')).toBeNull();
    expect(parseProgressLog(null)).toBeNull();
  });

  it('gravação vai de 15 a 85 pela fração de paradas', () => {
    expect(pctFromVm({ fase: 'instalando' })).toBe(PCT.installing);
    expect(pctFromVm({ fase: 'gravando', feitas: 0, total: 40 })).toBe(15);
    expect(pctFromVm({ fase: 'gravando', feitas: 20, total: 40 })).toBe(50);
    expect(pctFromVm({ fase: 'gravando', feitas: 40, total: 40 })).toBe(85);
    expect(pctFromVm({ fase: 'gravando', feitas: 50, total: 40 })).toBe(85);
    expect(pctFromVm({ fase: 'montando' })).toBe(PCT.assembling);
    expect(pctFromVm({ fase: 'outra' })).toBeNull();
    expect(pctFromVm(null)).toBeNull();
  });

  it('página que cresce desacelera o número, nunca o faz voltar', () => {
    const antes = pctFromVm({ fase: 'gravando', feitas: 30, total: 40 }); // 68
    const depois = pctFromVm({ fase: 'gravando', feitas: 30, total: 50 }); // 57
    expect(depois).toBeLessThan(antes);
    expect(monotonicPct(antes, depois)).toBe(antes);
    expect(monotonicPct(antes, 90)).toBe(90);
    expect(monotonicPct(undefined, 12)).toBe(12);
    expect(monotonicPct(40, Number.NaN)).toBe(40);
    expect(monotonicPct(40, 140)).toBe(100);
  });

  it('a captura nativa avança por tempo e para abaixo de 10', () => {
    expect(capturePhasePct(0)).toBe(0);
    expect(capturePhasePct(12_500)).toBe(5);
    expect(capturePhasePct(90_000)).toBe(PCT.captureCap);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/web-shell && npx vitest run lib/canonical/progress.test.js`
Expected: FAIL — `Failed to resolve import "./progress.js"`.

- [ ] **Step 3: Write minimal implementation**

```js
// packages/web-shell/lib/canonical/progress.js
// Porcentagem da preparação da cópia (spec 2026-10-09 §4.3). Pesos fixos por etapa; a gravação é a fração
// de paradas feitas. O número NUNCA volta: se a página cresce, o total sobe e ele só desacelera.
export const PCT = Object.freeze({
  captureCap: 9,
  queued: 10,
  created: 11,
  files: 13,
  started: 14,
  installing: 15,
  recordingStart: 15,
  recordingEnd: 85,
  assembling: 88,
  packaging: 95,
  ready: 100,
});

export function parseProgressLog(text) {
  if (typeof text !== 'string' || !text) return null;
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i].trim();
    if (!line) continue;
    try {
      const entry = JSON.parse(line);
      if (entry && typeof entry.fase === 'string') return entry;
    } catch { /* linha cortada no meio da escrita */ }
  }
  return null;
}

export function pctFromVm(entry) {
  if (!entry) return null;
  if (entry.fase === 'instalando') return PCT.installing;
  if (entry.fase === 'montando') return PCT.assembling;
  if (entry.fase === 'gravando') {
    const total = Number(entry.total);
    const feitas = Number(entry.feitas);
    if (!(total > 0) || !(feitas >= 0)) return PCT.recordingStart;
    const frac = Math.min(1, feitas / total);
    return Math.round(PCT.recordingStart + (PCT.recordingEnd - PCT.recordingStart) * frac);
  }
  return null;
}

export function monotonicPct(prev, next) {
  const base = Number.isFinite(prev) ? prev : 0;
  if (!Number.isFinite(next)) return base;
  return Math.max(base, Math.min(100, Math.round(next)));
}

export function capturePhasePct(elapsedMs, expectedMs = 25_000) {
  if (!(elapsedMs > 0)) return 0;
  return Math.min(PCT.captureCap, Math.floor((elapsedMs / expectedMs) * (PCT.captureCap + 1)));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/web-shell && npx vitest run lib/canonical/progress.test.js`
Expected: PASS (4 testes).

- [ ] **Step 5: Commit**

```bash
git add packages/web-shell/lib/canonical/progress.js packages/web-shell/lib/canonical/progress.test.js
git commit -m "feat(canonical): progress percentage by stage, never going back"
```

---

### Task 3: Tabela `canonical_jobs`

**Files:**
- Modify: `packages/web-shell/schema.sql` (depois do bloco de `challenge_jobs`, que termina no índice `idx_challenge_jobs_open`)
- Create: `packages/web-shell/migrations/2026-10-09-canonical-jobs.sql`
- Modify: `packages/web-shell/scripts/migrate.mjs` (array `MIGRACOES`)
- Test: `packages/web-shell/lib/canonical/schema.test.js`

**Interfaces:**
- Produces: tabela `canonical_jobs` com as colunas abaixo; status `queued|provisioning|recording|packaging|ready|failed`.

- [ ] **Step 1: Write the failing test**

```js
// packages/web-shell/lib/canonical/schema.test.js
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { splitSqlStatements } from '../sql-statements.js';

const raiz = path.resolve(__dirname, '../..');
const ler = (rel) => readFileSync(path.join(raiz, rel), 'utf8');
const bloco = (texto) => {
  const i = texto.indexOf('CREATE TABLE IF NOT EXISTS canonical_jobs');
  const fim = texto.indexOf('idx_canonical_jobs_overdue');
  return i >= 0 && fim > i ? texto.slice(i, texto.indexOf(';', fim) + 1) : null;
};

describe('canonical_jobs', () => {
  it('schema.sql e a migração têm o MESMO bloco', () => {
    const doSchema = bloco(ler('schema.sql'));
    expect(doSchema).not.toBeNull();
    expect(bloco(ler('migrations/2026-10-09-canonical-jobs.sql'))).toBe(doSchema);
  });

  it('uma tarefa ativa por node e cerca por geração', () => {
    const b = bloco(ler('schema.sql'));
    expect(b).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS idx_canonical_jobs_one_active ON canonical_jobs\(node_id\)\s+WHERE status IN \('queued','provisioning','recording','packaging'\)/);
    expect(b).toMatch(/generation INTEGER NOT NULL DEFAULT 1/);
    expect(b).toMatch(/UNIQUE \(user_id, idem_key\)/);
    expect(b).toMatch(/cleanup_done BOOLEAN NOT NULL DEFAULT false/);
  });

  it('o divisor de instruções entende o bloco', () => {
    expect(splitSqlStatements(bloco(ler('schema.sql'))).length).toBe(4);
  });

  it('migrate.mjs conhece a migração', () => {
    expect(ler('scripts/migrate.mjs')).toContain("arquivo: 'migrations/2026-10-09-canonical-jobs.sql'");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/web-shell && npx vitest run lib/canonical/schema.test.js`
Expected: FAIL — `expected null not to be null`.

- [ ] **Step 3: Write minimal implementation**

Bloco a colar em `schema.sql` logo após `idx_challenge_jobs_open`, e IDÊNTICO (mesmos bytes, do `CREATE TABLE` ao último `;`) em `migrations/2026-10-09-canonical-jobs.sql`:

```sql
-- Cópia editável no Edit (spec 2026-10-09 §4.1): tarefa persistida que prepara a cópia canônica numa
-- máquina descartável. Toda transição é cercada por status + geração + dono da trava.
-- Espelho de migrations/2026-10-09-canonical-jobs.sql.
CREATE TABLE IF NOT EXISTS canonical_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  board_id UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  node_id UUID NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  source_snapshot_id UUID NOT NULL,               -- versão do node ao enfileirar (comparação-e-troca)
  native_bundle_id UUID NOT NULL,                 -- captura nativa de onde a cópia nasce
  status VARCHAR(16) NOT NULL DEFAULT 'queued' CHECK (status IN (
    'queued','provisioning','recording','packaging','ready','failed')),
  stage VARCHAR(24),
  progress_pct SMALLINT NOT NULL DEFAULT 10,
  generation INTEGER NOT NULL DEFAULT 1,          -- sobe a cada transição de status
  attempt SMALLINT NOT NULL DEFAULT 1,            -- 2 = recomeço do zero numa máquina nova
  lease_owner TEXT,
  lease_until TIMESTAMPTZ,
  sandbox_name TEXT,                              -- nome determinístico, gravado ANTES de criar a máquina
  command_id TEXT,
  op_id UUID,                                     -- reserva de cobrança (operations.id)
  result_bundle_id UUID,
  result_snapshot_id UUID,
  error_code VARCHAR(40),
  error_detail TEXT,
  cleanup_done BOOLEAN NOT NULL DEFAULT false,    -- máquina desligada E cobrança encerrada; a varredura retoma até confirmar
  idem_key TEXT NOT NULL,
  deadline_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '35 minutes',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, idem_key)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_canonical_jobs_one_active ON canonical_jobs(node_id)
  WHERE status IN ('queued','provisioning','recording','packaging');
CREATE INDEX IF NOT EXISTS idx_canonical_jobs_cleanup ON canonical_jobs(updated_at)
  WHERE cleanup_done = false AND status IN ('ready','failed');
CREATE INDEX IF NOT EXISTS idx_canonical_jobs_overdue ON canonical_jobs(deadline_at)
  WHERE status IN ('queued','provisioning','recording','packaging');
```

Em `scripts/migrate.mjs`, acrescentar ao fim de `MIGRACOES`:

```js
  {
    arquivo: 'migrations/2026-10-09-canonical-jobs.sql',
    falta: (r) => ({
      colunas: [],
      tabelas: ['canonical_jobs'].filter((t) => !r.tabelas.includes(t)),
      travas: [],
    }),
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/web-shell && npx vitest run lib/canonical/schema.test.js`
Expected: PASS (4 testes).

- [ ] **Step 5: Commit**

```bash
git add packages/web-shell/schema.sql packages/web-shell/migrations/2026-10-09-canonical-jobs.sql packages/web-shell/scripts/migrate.mjs packages/web-shell/lib/canonical/schema.test.js
git commit -m "feat(canonical): canonical_jobs table, one active job per node"
```

---

### Task 4: SQL da tarefa (`job-store`)

**Files:**
- Create: `packages/web-shell/lib/canonical/job-store.js`
- Test: `packages/web-shell/lib/canonical/job-store.test.js`

**Interfaces:**
- Produces (todas `async`, recebem `{ sql, ... }`, devolvem a linha ou `null`):
  `insertJob({sql,userId,boardId,nodeId,sourceSnapshotId,nativeBundleId,idemKey,opId})`,
  `findActiveJobForNode({sql,userId,nodeId})`, `findJobByIdem({sql,userId,idemKey})`,
  `getOwnedJob({sql,userId,jobId})`, `acquireLease({sql,jobId,owner,ttlSecs})`,
  `releaseLease({sql,jobId,owner})` (sem retorno), `moveJob({sql,jobId,owner,generation,from,to,patch})`,
  `noteJob({sql,jobId,owner,generation,patch})`, `restartJob({sql,jobId,owner,generation,from})`,
  `failOverdueJob({sql,jobId,generation,from})`, `listOverdueJobs({sql,limit})` (devolve array),
  `markCleanupDone({sql,jobId})` (sem retorno), `listCleanupPending({sql,limit})` (devolve array).
  Constantes `ACTIVE` (array) e `TERMINAL` (Set).
  `patch` aceita só: `stage, sandbox_name, command_id, progress_pct, result_bundle_id, error_code, error_detail`.

- [ ] **Step 1: Write the failing test**

```js
// packages/web-shell/lib/canonical/job-store.test.js
import { describe, expect, it } from 'vitest';
import {
  ACTIVE, TERMINAL, acquireLease, failOverdueJob, findActiveJobForNode, getOwnedJob, insertJob,
  listCleanupPending, listOverdueJobs, markCleanupDone, moveJob, noteJob, restartJob,
} from './job-store.js';

function fakeSql(rowsByCall = []) {
  const calls = [];
  const sql = (strings, ...values) => {
    calls.push({ text: strings.join('?'), values });
    return Promise.resolve(rowsByCall.shift() ?? []);
  };
  sql._calls = calls;
  return sql;
}

describe('canonical job store', () => {
  it('constantes de estado', () => {
    expect(ACTIVE).toEqual(['queued', 'provisioning', 'recording', 'packaging']);
    expect([...TERMINAL]).toEqual(['ready', 'failed']);
  });

  it('insertJob não sobrescreve: conflito devolve null', async () => {
    const sql = fakeSql([[]]);
    const row = await insertJob({ sql, userId: 1, boardId: 'b', nodeId: 'n', sourceSnapshotId: 's', nativeBundleId: 'nb', idemKey: 'k', opId: 'op' });
    expect(row).toBeNull();
    expect(sql._calls[0].text).toMatch(/ON CONFLICT DO NOTHING/);
    expect(sql._calls[0].values).toEqual([1, 'b', 'n', 's', 'nb', 'k', 'op']);
  });

  it('leituras são sempre pelo dono', async () => {
    const sql = fakeSql([[], []]);
    await getOwnedJob({ sql, userId: 1, jobId: 'j' });
    await findActiveJobForNode({ sql, userId: 1, nodeId: 'n' });
    expect(sql._calls[0].text).toMatch(/WHERE id = \? AND user_id = \?/);
    expect(sql._calls[1].text).toMatch(/node_id = \? AND user_id = \?/);
  });

  it('a trava só pega tarefa ativa e com trava vencida', async () => {
    const sql = fakeSql([[{ id: 'j', lease_owner: 'w' }]]);
    const row = await acquireLease({ sql, jobId: 'j', owner: 'w', ttlSecs: 280 });
    expect(row.lease_owner).toBe('w');
    expect(sql._calls[0].text).toMatch(/status IN \('queued','provisioning','recording','packaging'\)/);
    expect(sql._calls[0].text).toMatch(/lease_until IS NULL OR lease_until < NOW\(\)/);
  });

  it('moveJob é cercado por status, geração E dono, e sobe a geração', async () => {
    const sql = fakeSql([[{ id: 'j', status: 'recording', generation: 3 }], []]);
    const ok = await moveJob({ sql, jobId: 'j', owner: 'w', generation: 2, from: 'provisioning', to: 'recording', patch: { command_id: 'c1' } });
    expect(ok.status).toBe('recording');
    expect(sql._calls[0].text).toMatch(/generation = generation \+ 1/);
    expect(sql._calls[0].text).toMatch(/WHERE id = \? AND status = \? AND generation = \? AND lease_owner = \?/);
    const perdido = await moveJob({ sql, jobId: 'j', owner: 'w', generation: 2, from: 'provisioning', to: 'recording' });
    expect(perdido).toBeNull();
  });

  it('patch fora do conjunto fechado é ignorado', async () => {
    const sql = fakeSql([[{ id: 'j' }]]);
    await noteJob({ sql, jobId: 'j', owner: 'w', generation: 1, patch: { status: 'ready', user_id: 9, stage: 'files', progress_pct: 13 } });
    const { values } = sql._calls[0];
    expect(values).toContain('files');
    expect(values).toContain(13);
    expect(values).not.toContain('ready');
    expect(values).not.toContain(9);
    expect(sql._calls[0].text).toMatch(/GREATEST\(progress_pct/);
    expect(sql._calls[0].text).not.toMatch(/SET status/);
  });

  it('restartJob só recomeça uma vez e apaga máquina/comando', async () => {
    const sql = fakeSql([[{ id: 'j', status: 'queued', attempt: 2 }]]);
    await restartJob({ sql, jobId: 'j', owner: 'w', generation: 4, from: 'recording' });
    const { text } = sql._calls[0];
    expect(text).toMatch(/attempt = attempt \+ 1/);
    expect(text).toMatch(/sandbox_name = NULL/);
    expect(text).toMatch(/command_id = NULL/);
    expect(text).toMatch(/AND attempt < 2/);
  });

  it('a varredura falha só a vencida e na mesma geração', async () => {
    const sql = fakeSql([[{ id: 'j' }], [{ id: 'j', status: 'failed' }]]);
    expect(await listOverdueJobs({ sql, limit: 10 })).toEqual([{ id: 'j' }]);
    await failOverdueJob({ sql, jobId: 'j', generation: 5, from: 'recording' });
    expect(sql._calls[0].text).toMatch(/deadline_at < NOW\(\)/);
    expect(sql._calls[1].text).toMatch(/error_code = 'timeout'/);
    expect(sql._calls[1].text).toMatch(/AND generation = \? AND deadline_at < NOW\(\)/);
    expect(sql._calls[1].text).toMatch(/AND \(lease_until IS NULL OR lease_until < NOW\(\)\)/);
  });

  it('limpeza pendente: só tarefas terminadas, e marcar só nelas', async () => {
    const sql = fakeSql([[{ id: 'j' }], []]);
    expect(await listCleanupPending({ sql, limit: 5 })).toEqual([{ id: 'j' }]);
    await markCleanupDone({ sql, jobId: 'j' });
    expect(sql._calls[0].text).toMatch(/cleanup_done = false AND status IN \('ready','failed'\)/);
    expect(sql._calls[1].text).toMatch(/SET cleanup_done = true/);
    expect(sql._calls[1].text).toMatch(/status IN \('ready','failed'\)/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/web-shell && npx vitest run lib/canonical/job-store.test.js`
Expected: FAIL — `Failed to resolve import "./job-store.js"`.

- [ ] **Step 3: Write minimal implementation**

```js
// packages/web-shell/lib/canonical/job-store.js
// SQL de canonical_jobs (spec 2026-10-09 §4.1). Leitura sempre pelo DONO; toda escrita da requisição que
// trabalha é cercada por status + geração + dono da trava (no challenge_jobs a trava só olhava id e validade).
export const ACTIVE = Object.freeze(['queued', 'provisioning', 'recording', 'packaging']);
export const TERMINAL = new Set(['ready', 'failed']);

// Conjunto FECHADO do que uma transição pode mudar — nunca um nome vindo de fora.
const PATCHABLE = new Set(['stage', 'sandbox_name', 'command_id', 'progress_pct', 'result_bundle_id', 'error_code', 'error_detail']);
function cleanPatch(patch) {
  const p = {};
  for (const [k, v] of Object.entries(patch || {})) if (PATCHABLE.has(k)) p[k] = v;
  return p;
}

export async function insertJob({ sql, userId, boardId, nodeId, sourceSnapshotId, nativeBundleId, idemKey, opId = null }) {
  const rows = await sql`
    INSERT INTO canonical_jobs (user_id, board_id, node_id, source_snapshot_id, native_bundle_id, idem_key, op_id)
    VALUES (${userId}, ${boardId}, ${nodeId}, ${sourceSnapshotId}, ${nativeBundleId}, ${idemKey}, ${opId})
    ON CONFLICT DO NOTHING
    RETURNING *`;
  return rows[0] || null;
}

export async function findActiveJobForNode({ sql, userId, nodeId }) {
  const rows = await sql`
    SELECT * FROM canonical_jobs
     WHERE node_id = ${nodeId} AND user_id = ${userId}
       AND status IN ('queued','provisioning','recording','packaging')
     LIMIT 1`;
  return rows[0] || null;
}

export async function findJobByIdem({ sql, userId, idemKey }) {
  const rows = await sql`SELECT * FROM canonical_jobs WHERE user_id = ${userId} AND idem_key = ${idemKey}`;
  return rows[0] || null;
}

export async function getOwnedJob({ sql, userId, jobId }) {
  const rows = await sql`SELECT * FROM canonical_jobs WHERE id = ${jobId} AND user_id = ${userId}`;
  return rows[0] || null;
}

export async function acquireLease({ sql, jobId, owner, ttlSecs }) {
  const rows = await sql`
    UPDATE canonical_jobs
       SET lease_owner = ${owner},
           lease_until = NOW() + make_interval(secs => ${ttlSecs}),
           updated_at = NOW()
     WHERE id = ${jobId}
       AND status IN ('queued','provisioning','recording','packaging')
       AND (lease_until IS NULL OR lease_until < NOW())
     RETURNING *`;
  return rows[0] || null;
}

export async function releaseLease({ sql, jobId, owner }) {
  await sql`
    UPDATE canonical_jobs SET lease_owner = NULL, lease_until = NULL, updated_at = NOW()
     WHERE id = ${jobId} AND lease_owner = ${owner}`;
}

export async function moveJob({ sql, jobId, owner, generation, from, to, patch = {} }) {
  const p = cleanPatch(patch);
  const rows = await sql`
    UPDATE canonical_jobs
       SET status = ${to},
           generation = generation + 1,
           stage = COALESCE(${p.stage ?? null}, stage),
           sandbox_name = COALESCE(${p.sandbox_name ?? null}, sandbox_name),
           command_id = COALESCE(${p.command_id ?? null}, command_id),
           progress_pct = GREATEST(progress_pct, COALESCE(${p.progress_pct ?? null}, progress_pct)),
           result_bundle_id = COALESCE(${p.result_bundle_id ?? null}, result_bundle_id),
           error_code = COALESCE(${p.error_code ?? null}, error_code),
           error_detail = COALESCE(${p.error_detail ?? null}, error_detail),
           updated_at = NOW()
     WHERE id = ${jobId} AND status = ${from} AND generation = ${generation} AND lease_owner = ${owner}
     RETURNING *`;
  return rows[0] || null;
}

// Anotação sem mudar de status (progresso, sub-estágio): mesma cerca, geração intacta.
export async function noteJob({ sql, jobId, owner, generation, patch = {} }) {
  const p = cleanPatch(patch);
  const rows = await sql`
    UPDATE canonical_jobs
       SET stage = COALESCE(${p.stage ?? null}, stage),
           command_id = COALESCE(${p.command_id ?? null}, command_id),
           progress_pct = GREATEST(progress_pct, COALESCE(${p.progress_pct ?? null}, progress_pct)),
           updated_at = NOW()
     WHERE id = ${jobId} AND generation = ${generation} AND lease_owner = ${owner}
       AND status IN ('queued','provisioning','recording','packaging')
     RETURNING *`;
  return rows[0] || null;
}

// Recomeço do zero numa máquina nova (uma vez): volta a 'queued' sem máquina nem comando.
export async function restartJob({ sql, jobId, owner, generation, from }) {
  const rows = await sql`
    UPDATE canonical_jobs
       SET status = 'queued',
           generation = generation + 1,
           attempt = attempt + 1,
           sandbox_name = NULL,
           command_id = NULL,
           stage = NULL,
           updated_at = NOW()
     WHERE id = ${jobId} AND status = ${from} AND generation = ${generation} AND lease_owner = ${owner}
       AND attempt < 2
     RETURNING *`;
  return rows[0] || null;
}

export async function listOverdueJobs({ sql, limit = 50 }) {
  return sql`
    SELECT * FROM canonical_jobs
     WHERE status IN ('queued','provisioning','recording','packaging') AND deadline_at < NOW()
     ORDER BY deadline_at ASC
     LIMIT ${limit}`;
}

// Limpeza de tarefa terminada: desligar a máquina e encerrar a cobrança podem falhar depois da transição;
// a varredura repete até confirmar (cada passo é idempotente).
export async function listCleanupPending({ sql, limit = 50 }) {
  return sql`
    SELECT * FROM canonical_jobs
     WHERE cleanup_done = false AND status IN ('ready','failed')
     ORDER BY updated_at ASC
     LIMIT ${limit}`;
}

export async function markCleanupDone({ sql, jobId }) {
  await sql`
    UPDATE canonical_jobs SET cleanup_done = true, updated_at = NOW()
     WHERE id = ${jobId} AND status IN ('ready','failed')`;
}

// Varredura (sem dono): só a vencida, na geração lida, e NUNCA com uma trava válida — a requisição dona pode estar
// no meio de criar a máquina; derrubá-la aqui deixaria a máquina nascer depois da limpeza (órfã). Com trava viva,
// quem falha a tarefa por prazo é a própria requisição (o passo seguinte checa o prazo) ou esta varredura depois que
// a trava vencer (330 s).
export async function failOverdueJob({ sql, jobId, generation, from }) {
  const rows = await sql`
    UPDATE canonical_jobs
       SET status = 'failed',
           generation = generation + 1,
           error_code = 'timeout',
           lease_owner = NULL,
           lease_until = NULL,
           updated_at = NOW()
     WHERE id = ${jobId} AND status = ${from} AND generation = ${generation} AND deadline_at < NOW()
       AND (lease_until IS NULL OR lease_until < NOW())
     RETURNING *`;
  return rows[0] || null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/web-shell && npx vitest run lib/canonical/job-store.test.js`
Expected: PASS (9 testes).

- [ ] **Step 5: Commit**

```bash
git add packages/web-shell/lib/canonical/job-store.js packages/web-shell/lib/canonical/job-store.test.js
git commit -m "feat(canonical): fenced SQL for the preparation job"
```

---

### Task 5: Máquina, pacote de entrada, saída e publicação

Quatro módulos pequenos que a máquina de estados (Task 7) usa. Cada um com seu teste; um commit no fim.

**Files:**
- Create: `packages/web-shell/lib/canonical/sandbox-runner.js` + `sandbox-runner.test.js`
- Create: `packages/web-shell/lib/canonical/payload.js` + `payload.test.js`
- Create: `packages/web-shell/lib/canonical/output-bundle.js` + `output-bundle.test.js`
- Create: `packages/web-shell/lib/canonical/publish.js` + `publish.test.js`
- Modify: `packages/web-shell/lib/node-editor-kind.js:16` + `lib/node-editor-kind.test.js`

**Interfaces:**
- Consumes: `indexedAssetKey` (`lib/native-clone/bundle-store.js`), `createEmptyMotionManifest`
  (`lib/motion-editor/manifest.js`), `descriptorFromRow` (`lib/motion-editor/runtime-gateway-core.js`).
- Produces:
  - `VM` (caminhos, incl. `started` e `done`), `SANDBOX_VCPUS=4`, `SANDBOX_TIMEOUT_MS`, `EXIT_MEANING`,
    `sandboxNameFor(jobId, attempt)`, `sandboxCredentials(env)`, `buildRunScript()`, `parseExitFile(text) → number|null`,
    `createSandboxRunner({sdkLoader, env})` → `{ ensure(name), find(name), isAlive(sandbox), writeFiles(sandbox, files),
    start(sandbox) → cmdId, readFile(sandbox, path) → Buffer|null, stop(name) }`.
    **A verdade do andamento é a máquina** (arquivos `iniciado` e `fim.json` que o próprio script escreve), não o
    `command_id` no banco: assim, uma requisição que morre entre iniciar o comando e gravar o estado não causa
    segunda execução.
  - `PAYLOAD_FILES`, `VM_PACKAGE_JSON`, `loadCodePayload({root, readFile})`, `loadCapturePayload({store, descriptor})`,
    `loadNativeDescriptor({sql, bundleId})`, `chunkBySize(files, maxBytes)`.
  - `readTarGz(buffer, {maxBytes})` → `[{path, body}]`; `canonicalProducerOutput({files, nativeDescriptor})`.
  - `publishCanonical({sql, job, owner, descriptor, html})` → `{snapshotId, motionManifest}`; erro `code:'publish_conflict'`.
  - `NATIVE_SNAPSHOT_SOURCES` passa a incluir `'canonical'`; `CANONICAL_SNAPSHOT_SOURCE = 'canonical'`.

- [ ] **Step 1: Write the failing tests (os quatro arquivos)**

```js
// packages/web-shell/lib/canonical/sandbox-runner.test.js
import { describe, expect, it, vi } from 'vitest';
import { SANDBOX_VCPUS, VM, buildRunScript, createSandboxRunner, parseExitFile, sandboxCredentials, sandboxNameFor } from './sandbox-runner.js';

function fakeSdk({ found = null } = {}) {
  const sandbox = {
    status: 'running',
    writeFiles: vi.fn(async () => {}),
    runCommand: vi.fn(async () => ({ cmdId: 'cmd-1' })),
    readFileToBuffer: vi.fn(async () => Buffer.from('x')),
    stop: vi.fn(async () => ({})),
  };
  const Sandbox = {
    getOrCreate: vi.fn(async () => sandbox),
    get: vi.fn(async () => { if (found === 'missing') throw Object.assign(new Error('Sandbox not found'), { response: { status: 404 } }); return sandbox; }),
  };
  return { Sandbox, sandbox, loader: async () => ({ Sandbox }) };
}

describe('sandbox runner', () => {
  it('nome determinístico por tarefa e tentativa', () => {
    expect(sandboxNameFor('j1', 1)).toBe('uc-canon-j1-a1');
    expect(sandboxNameFor('j1', 2)).toBe('uc-canon-j1-a2');
  });

  it('credenciais explícitas só com as três; senão OIDC da Vercel', () => {
    expect(sandboxCredentials({})).toEqual({});
    expect(sandboxCredentials({ UNCRAFT_SANDBOX_TOKEN: 't', UNCRAFT_SANDBOX_TEAM_ID: 'team' })).toEqual({});
    expect(sandboxCredentials({ UNCRAFT_SANDBOX_TOKEN: 't', UNCRAFT_SANDBOX_TEAM_ID: 'team', UNCRAFT_SANDBOX_PROJECT_ID: 'p' }))
      .toEqual({ token: 't', teamId: 'team', projectId: 'p' });
  });

  it('o script roda o protocolo padrão, decl+leitura, sem plano e sem segredo', () => {
    const s = buildRunScript();
    expect(s).toContain('PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64');
    expect(s).toContain('--movimento=decl+leitura');
    expect(s).toContain('--sem-plano');
    expect(s).toContain(`UNCRAFT_PROGRESSO="$P"`);
    expect(s).toContain(`tar -czf ${VM.archive}`);
    expect(s).not.toMatch(/UNCRAFT_ASSENTAR_MS|UNCRAFT_LACOS_AGRUPADOS|TOKEN|SECRET|DATABASE_URL/);
  });

  it('o script recusa uma segunda execução ANTES de mexer em qualquer arquivo, e anota início e fim', () => {
    const linhas = buildRunScript().split('\n');
    const trava = linhas.findIndex((l) => l === `mkdir ${VM.lock} 2>/dev/null || exit 0`);
    const fim = linhas.findIndex((l) => l.startsWith('trap ') && l.includes(VM.done));
    const inicio = linhas.findIndex((l) => l === `echo iniciado > ${VM.started}`);
    const progresso = linhas.findIndex((l) => l.includes('"fase":"instalando"'));
    expect(trava).toBeGreaterThan(0);
    expect(fim).toBeGreaterThan(trava);      // a 2ª execução sai pela trava sem reescrever o fim.json da 1ª
    expect(inicio).toBeGreaterThan(fim);
    expect(progresso).toBeGreaterThan(inicio);
  });

  it('lê o código de saída que o script grava', () => {
    expect(parseExitFile('{"codigo":0}\n')).toBe(0);
    expect(parseExitFile('{"codigo":43}')).toBe(43);
    expect(parseExitFile('')).toBeNull();
    expect(parseExitFile('{"codigo":')).toBeNull();
    expect(parseExitFile(null)).toBeNull();
  });

  it('ensure cria com 4 vCPU, sem disco persistente, pelo nome', async () => {
    const { Sandbox, loader } = fakeSdk();
    const runner = createSandboxRunner({ sdkLoader: loader, env: {} });
    await runner.ensure('uc-canon-j1-a1');
    expect(Sandbox.getOrCreate).toHaveBeenCalledWith(expect.objectContaining({
      name: 'uc-canon-j1-a1', resources: { vcpus: SANDBOX_VCPUS }, persistent: false, timeout: 30 * 60 * 1000,
    }));
  });

  it('start destacado', async () => {
    const { sandbox, loader } = fakeSdk();
    const runner = createSandboxRunner({ sdkLoader: loader, env: {} });
    expect(await runner.start(sandbox)).toBe('cmd-1');
    expect(sandbox.runCommand).toHaveBeenCalledWith({ cmd: 'bash', args: [VM.script], detached: true });
  });

  it('find devolve null para máquina inexistente; stop só para a viva e diz o que encontrou', async () => {
    const missing = fakeSdk({ found: 'missing' });
    const semMaquina = createSandboxRunner({ sdkLoader: missing.loader, env: {} });
    expect(await semMaquina.find('x')).toBeNull();
    expect(await semMaquina.stop('x')).toBe('absent');
    const { sandbox, loader } = fakeSdk();
    const runner = createSandboxRunner({ sdkLoader: loader, env: {} });
    expect(await runner.stop('uc-canon-j1-a1')).toBe('stopped');
    expect(sandbox.stop).toHaveBeenCalledTimes(1);
    sandbox.status = 'stopped';
    expect(await runner.stop('uc-canon-j1-a1')).toBe('not-alive');
    expect(sandbox.stop).toHaveBeenCalledTimes(1);
  });
});
```

```js
// packages/web-shell/lib/canonical/payload.test.js
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createMemoryBundleStore } from '../native-clone/bundle-store.js';
import { registerNativeBundle } from '../native-clone/register-bundle.js';
import { PAYLOAD_FILES, VM_PACKAGE_JSON, chunkBySize, loadCapturePayload, loadCodePayload } from './payload.js';
import { VM } from './sandbox-runner.js';

const raiz = path.resolve(__dirname, '../..');

// Fecho de imports ESTÁTICOS a partir do script de montagem: se alguém acrescentar um import, a lista do
// pacote tem que acompanhar (o plano-nativo é import dinâmico e só roda sem --sem-plano — fora do M1).
function fechoDeImports(inicio) {
  const visto = new Set();
  const fila = [inicio];
  while (fila.length) {
    const rel = fila.shift();
    if (visto.has(rel)) continue;
    visto.add(rel);
    const src = readFileSync(path.join(raiz, rel), 'utf8');
    const alvos = [...src.matchAll(/^\s*(?:import|export)\s[^'"]*?from\s*['"](\.{1,2}\/[^'"]+)['"]/gm)].map((m) => m[1]);
    for (const alvo of alvos) fila.push(path.posix.normalize(path.posix.join(path.posix.dirname(rel), alvo)));
  }
  return [...visto].sort();
}

describe('pacote de entrada da máquina', () => {
  it('a lista de arquivos é exatamente o fecho do script + o tocador', () => {
    const esperado = [...new Set([...fechoDeImports('scripts/normalizar-clone.mjs'), 'lib/motion-program/uncraft-motion.js'])].sort();
    expect([...PAYLOAD_FILES].sort()).toEqual(esperado);
  });

  it('código vai para /vercel/sandbox/c com package.json fixo e o script executável', async () => {
    const files = await loadCodePayload({ root: raiz });
    expect(files.find((f) => f.path === `${VM.code}/scripts/normalizar-clone.mjs`)).toBeTruthy();
    expect(JSON.parse(files.find((f) => f.path === `${VM.code}/package.json`).content)).toEqual(VM_PACKAGE_JSON);
    const script = files.find((f) => f.path === VM.script);
    expect(script.mode).toBe(0o755);
  });

  it('captura vai com a página e o tipo de cada arquivo ao lado', async () => {
    const store = createMemoryBundleStore();
    const descriptor = await registerNativeBundle({
      entryPath: 'index.html',
      runtimeFingerprint: `sha256:${'a'.repeat(64)}`,
      assets: [
        { path: 'index.html', body: new TextEncoder().encode('<html></html>'), contentType: 'text/html; charset=utf-8' },
        { path: '_ext/cdn/abc', body: new Uint8Array([1, 2]), contentType: 'image/png' },
      ],
    }, { store });
    const files = await loadCapturePayload({ store, descriptor });
    expect(files.map((f) => f.path).sort()).toEqual([
      `${VM.capture}/_ext/cdn/abc`, `${VM.capture}/_ext/cdn/abc.uncraft-meta.json`,
      `${VM.capture}/index.html`, `${VM.capture}/index.html.uncraft-meta.json`,
    ]);
    const meta = files.find((f) => f.path === `${VM.capture}/_ext/cdn/abc.uncraft-meta.json`);
    expect(JSON.parse(Buffer.from(meta.content).toString())).toEqual({ contentType: 'image/png' });
  });

  it('captura cuja página não é index.html falha tipada', async () => {
    await expect(loadCapturePayload({ store: createMemoryBundleStore(), descriptor: { entryPath: 'sobre/index.html', assetIndex: [] } }))
      .rejects.toMatchObject({ code: 'capture_failed' });
  });

  it('lotes por tamanho nunca passam do teto, salvo arquivo maior que ele sozinho', () => {
    const f = (n) => ({ path: String(n), content: new Uint8Array(n) });
    const lotes = chunkBySize([f(6), f(6), f(3), f(20)], 10);
    expect(lotes.map((l) => l.map((x) => x.path))).toEqual([['6'], ['6', '3'], ['20']]);
  });
});
```

```js
// packages/web-shell/lib/canonical/output-bundle.test.js
import { describe, expect, it } from 'vitest';
import { gzipSync } from 'node:zlib';
import tar from 'tar-stream';
import { createMemoryBundleStore } from '../native-clone/bundle-store.js';
import { registerNativeBundle } from '../native-clone/register-bundle.js';
import { canonicalProducerOutput, readTarGz } from './output-bundle.js';

async function tgz(entries) {
  const pack = tar.pack();
  for (const e of entries) {
    if (e.dir) pack.entry({ name: e.name, type: 'directory' }, '');
    else pack.entry({ name: e.name }, Buffer.from(e.body));
  }
  pack.finalize();
  const chunks = [];
  for await (const c of pack) chunks.push(c);
  return gzipSync(Buffer.concat(chunks));
}

describe('saída da máquina', () => {
  it('lê só arquivos, sem o ./ do começo', async () => {
    const buf = await tgz([{ name: './', dir: true }, { name: './index.html', body: '<html>' }, { name: './vendor/gsap.min.js', body: 'g' }]);
    const files = await readTarGz(buf);
    expect(files.map((f) => f.path)).toEqual(['index.html', 'vendor/gsap.min.js']);
    expect(Buffer.from(files[0].body).toString()).toBe('<html>');
  });

  it('preserva o tipo que a captura deu aos arquivos sem extensão e deixa o resto inferir', () => {
    const files = [
      { path: 'index.html', body: new Uint8Array([1]) },
      { path: 'motion.json', body: new Uint8Array([2]) },
      { path: '_ext/cdn/abc', body: new Uint8Array([3]) },
    ];
    const out = canonicalProducerOutput({ files, nativeDescriptor: { assetIndex: [{ path: '_ext/cdn/abc', contentType: 'image/png' }] } });
    expect(out.entryPath).toBe('index.html');
    expect(out.assets.find((a) => a.path === '_ext/cdn/abc').contentType).toBe('image/png');
    expect(out.assets.find((a) => a.path === 'index.html').contentType).toBeUndefined();
    expect(out.runtimeFingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('sem motion.json a montagem não terminou: falha tipada', () => {
    expect(() => canonicalProducerOutput({ files: [{ path: 'index.html', body: new Uint8Array([1]) }], nativeDescriptor: { assetIndex: [] } }))
      .toThrow(expect.objectContaining({ code: 'recording_failed' }));
  });

  it('a saída registra como pacote', async () => {
    const files = [
      { path: 'index.html', body: new TextEncoder().encode('<html></html>') },
      { path: 'motion.json', body: new TextEncoder().encode('{"versao":0,"fichas":[]}') },
    ];
    const descriptor = await registerNativeBundle(canonicalProducerOutput({ files, nativeDescriptor: { assetIndex: [] } }), { store: createMemoryBundleStore() });
    expect(descriptor.entryPath).toBe('index.html');
    expect(descriptor.assetIndex.find((a) => a.path === 'motion.json').contentType).toBe('application/json; charset=utf-8');
  });
});
```

```js
// packages/web-shell/lib/canonical/publish.test.js
import { describe, expect, it } from 'vitest';
import { publishCanonical } from './publish.js';

function fakeSql(rows) {
  const calls = [];
  const sql = (strings, ...values) => { calls.push({ text: strings.join('?'), values }); return Promise.resolve(rows); };
  sql._calls = calls;
  return sql;
}
const job = { id: 'j1', node_id: 'n1', source_snapshot_id: 's1', generation: 4 };
const descriptor = { bundleId: '11111111-1111-5111-8111-111111111111', runtimeFingerprint: `sha256:${'b'.repeat(64)}` };

describe('publicação da cópia', () => {
  it('snapshot canonical + node + tarefa numa instrução só, cercada', async () => {
    const sql = fakeSql([{ snapshot_id: 's2', job_id: 'j1' }]);
    const out = await publishCanonical({ sql, job, owner: 'w', descriptor, html: '<html>' });
    expect(out.snapshotId).toBe('s2');
    expect(out.motionManifest.baseBundleId).toBe(descriptor.bundleId);
    const { text } = sql._calls[0];
    expect(sql._calls).toHaveLength(1);
    expect(text).toMatch(/'canonical'/);
    expect(text).toMatch(/j\.status = 'packaging' AND j\.generation = \? AND j\.lease_owner = \?/);
    expect(text).toMatch(/nodes\.current_snapshot_id = \?/);
    expect(text).toMatch(/SET status = 'ready'/);
  });

  it('node que mudou no meio: publish_conflict, nada publicado', async () => {
    await expect(publishCanonical({ sql: fakeSql([{ snapshot_id: null, job_id: null }]), job, owner: 'w', descriptor, html: '<html>' }))
      .rejects.toMatchObject({ code: 'publish_conflict' });
  });
});
```

Em `lib/node-editor-kind.test.js`, acrescentar ao `describe` existente:

```js
  it('snapshot canonical com pacote e manifesto v2 é nativo pronto', () => {
    expect(classifyNativeLineage({
      current_snapshot_source: 'canonical',
      current_native_bundle_id: '33333333-3333-4333-8333-333333333333',
      current_motion_manifest_version: 2,
    })).toBe(NATIVE_LINEAGE.READY);
  });
```

(Se `classifyNativeLineage`/`NATIVE_LINEAGE` ainda não estiverem importados no topo do arquivo de teste, acrescentar ao import de `./node-editor-kind.js`.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/web-shell && npx vitest run lib/canonical/sandbox-runner.test.js lib/canonical/payload.test.js lib/canonical/output-bundle.test.js lib/canonical/publish.test.js lib/node-editor-kind.test.js`
Expected: FAIL — imports não resolvem nos quatro novos; o teste de `canonical` falha com `expected 'native-inconsistent' to be 'native-ready'`.

- [ ] **Step 3: Write minimal implementation**

```js
// packages/web-shell/lib/canonical/sandbox-runner.js
// Máquina descartável que monta a cópia (spec 2026-10-09 §4.2). Uma tarefa por máquina; nome determinístico
// (gravado ANTES de criar, para nunca ficar órfã); nenhuma credencial entra nela — o servidor escreve os
// arquivos, dispara o comando destacado e lê o resultado.
export const VM = Object.freeze({
  root: '/vercel/sandbox',
  code: '/vercel/sandbox/c',
  capture: '/vercel/sandbox/captura',
  out: '/vercel/sandbox/out',
  progress: '/vercel/sandbox/out/progresso.jsonl',
  archive: '/vercel/sandbox/out/canonica.tgz',
  errors: '/vercel/sandbox/out/erro.txt',
  lock: '/vercel/sandbox/out/.run',
  started: '/vercel/sandbox/out/iniciado',
  done: '/vercel/sandbox/out/fim.json',
  script: '/vercel/sandbox/run.sh',
});
export const SANDBOX_VCPUS = 4;
export const SANDBOX_TIMEOUT_MS = 30 * 60 * 1000;
const ALIVE = new Set(['pending', 'running']);
export const EXIT_MEANING = Object.freeze({
  40: 'payload_missing', 41: 'install_failed', 42: 'browser_install_failed', 43: 'normalize_failed', 44: 'archive_failed',
});

export function sandboxNameFor(jobId, attempt) {
  return `uc-canon-${jobId}-a${attempt}`;
}

// Na Vercel o SDK usa o token OIDC do deploy; fora dela (dev), as três variáveis explícitas.
export function sandboxCredentials(env = process.env) {
  const token = env.UNCRAFT_SANDBOX_TOKEN;
  const teamId = env.UNCRAFT_SANDBOX_TEAM_ID;
  const projectId = env.UNCRAFT_SANDBOX_PROJECT_ID;
  return token && teamId && projectId ? { token, teamId, projectId } : {};
}

// O script é a verdade do andamento: a trava atômica (mkdir) faz uma segunda execução sair sem tocar em nada; o
// `fim.json` (código de saída) é escrito pelo próprio script ao terminar, por qualquer caminho.
export function buildRunScript() {
  return [
    '#!/usr/bin/env bash',
    'set -u',
    `mkdir -p ${VM.out}`,
    `mkdir ${VM.lock} 2>/dev/null || exit 0`,
    `trap 'echo "{\\"codigo\\":$?}" > ${VM.done}' EXIT`,
    `echo iniciado > ${VM.started}`,
    `P=${VM.progress}`,
    `echo '{"fase":"instalando"}' >> "$P"`,
    `cd ${VM.code} || exit 40`,
    `npm install --no-audit --no-fund > ${VM.out}/install.log 2>&1 || exit 41`,
    `PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64 npx playwright install --with-deps chromium >> ${VM.out}/install.log 2>&1 || exit 42`,
    `UNCRAFT_PROGRESSO="$P" node scripts/normalizar-clone.mjs --captura ${VM.capture} --saida ${VM.out}/canonica --movimento=decl+leitura --sem-plano > ${VM.out}/relatorio.json 2> ${VM.errors} || exit 43`,
    `tar -czf ${VM.archive} -C ${VM.out}/canonica . || exit 44`,
    'exit 0',
    '',
  ].join('\n');
}

export function parseExitFile(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  try {
    const codigo = JSON.parse(text).codigo;
    return Number.isInteger(codigo) ? codigo : null;
  } catch {
    return null;
  }
}

function isNotFound(error) {
  return error?.response?.status === 404 || error?.status === 404 || /not.?found/i.test(String(error?.message || ''));
}

export function createSandboxRunner({ sdkLoader = () => import('@vercel/sandbox'), env = process.env } = {}) {
  const creds = () => sandboxCredentials(env);
  const sdk = async () => (await sdkLoader()).Sandbox;
  const runner = {
    async ensure(name) {
      const Sandbox = await sdk();
      return Sandbox.getOrCreate({
        name, resources: { vcpus: SANDBOX_VCPUS }, timeout: SANDBOX_TIMEOUT_MS, persistent: false, ...creds(),
      });
    },
    async find(name) {
      const Sandbox = await sdk();
      try { return await Sandbox.get({ name, ...creds() }); } catch (error) { if (isNotFound(error)) return null; throw error; }
    },
    isAlive(sandbox) {
      return Boolean(sandbox) && ALIVE.has(sandbox.status);
    },
    async writeFiles(sandbox, files) {
      await sandbox.writeFiles(files);
    },
    async start(sandbox) {
      const cmd = await sandbox.runCommand({ cmd: 'bash', args: [VM.script], detached: true });
      return cmd.cmdId;
    },
    async readFile(sandbox, path) {
      return sandbox.readFileToBuffer({ path });
    },
    // 'stopped' = estava viva e desligamos; 'not-alive' = existe e já parou; 'absent' = não existe (AINDA — uma
    // criação que ficou no ar pode terminar depois; quem chama decide o que a ausência prova).
    async stop(name) {
      const sandbox = await runner.find(name);
      if (!sandbox) return 'absent';
      if (!runner.isAlive(sandbox)) return 'not-alive';
      await sandbox.stop();
      return 'stopped';
    },
  };
  return runner;
}
```

```js
// packages/web-shell/lib/canonical/payload.js
// O que vai para a máquina: o script de montagem (com o fecho dos seus imports), o tocador, um package.json
// com versões FIXAS e a captura nativa com o tipo de cada arquivo ao lado (o script lê `<arq>.uncraft-meta.json`).
import { readFile as fsReadFile } from 'node:fs/promises';
import path from 'node:path';
import { indexedAssetKey } from '../native-clone/bundle-store.js';
import { descriptorFromRow } from '../motion-editor/runtime-gateway-core.js';
import { VM, buildRunScript } from './sandbox-runner.js';

export const PAYLOAD_FILES = Object.freeze([
  'lib/motion-program/uncraft-motion.js',
  'scripts/compilar-movimento.mjs',
  'scripts/gravar-trajetoria.mjs',
  'scripts/inventario-conteudo.mjs',
  'scripts/lenis-instantanea.mjs',
  'scripts/ler-gsap.mjs',
  'scripts/ler-ix3.mjs',
  'scripts/mapa-da-captura.mjs',
  'scripts/normalizar-clone.mjs',
  'scripts/rastro-gravacao.mjs',
]);

export const VM_PACKAGE_JSON = Object.freeze({
  name: 'canonica-carga',
  private: true,
  dependencies: { 'playwright-core': '1.60.0', playwright: '1.60.0', gsap: '3.15.0', lenis: '1.3.26', 'lottie-web': '5.13.0' },
});

const CAPTURE_READ_CONCURRENCY = 8;

export async function loadCodePayload({ root = process.cwd(), readFile = fsReadFile } = {}) {
  const files = await Promise.all(PAYLOAD_FILES.map(async (rel) => ({
    path: `${VM.code}/${rel}`,
    content: await readFile(path.join(root, rel)),
  })));
  files.push({ path: `${VM.code}/package.json`, content: Buffer.from(JSON.stringify(VM_PACKAGE_JSON)) });
  files.push({ path: VM.script, content: Buffer.from(buildRunScript()), mode: 0o755 });
  return files;
}

export async function loadCapturePayload({ store, descriptor }) {
  if (descriptor?.entryPath !== 'index.html') {
    throw Object.assign(new Error('entry_path_unsupported'), { code: 'capture_failed', detail: `entryPath=${descriptor?.entryPath}` });
  }
  const assets = descriptor.assetIndex;
  const files = new Array(assets.length * 2);
  let next = 0;
  async function worker() {
    while (next < assets.length) {
      const i = next; next += 1;
      const asset = assets[i];
      const body = await store.read(indexedAssetKey(descriptor.storageKey, asset.path));
      files[2 * i] = { path: `${VM.capture}/${asset.path}`, content: body };
      files[2 * i + 1] = {
        path: `${VM.capture}/${asset.path}.uncraft-meta.json`,
        content: Buffer.from(JSON.stringify({ contentType: asset.contentType })),
      };
    }
  }
  await Promise.all(Array.from({ length: Math.min(CAPTURE_READ_CONCURRENCY, assets.length) }, worker));
  return files;
}

export async function loadNativeDescriptor({ sql, bundleId }) {
  const rows = await sql`
    SELECT bundle_id, schema_version, storage_key, content_hash, entry_path, asset_index,
           runtime_fingerprint, reconstruction_capabilities
      FROM native_bundles WHERE bundle_id = ${bundleId}`;
  if (!rows[0]) throw Object.assign(new Error('native_bundle_missing'), { code: 'capture_failed', detail: `bundle ${bundleId}` });
  return descriptorFromRow(rows[0]);
}

// A escrita na máquina vai em lotes (a captura passa de 30 MB): nenhum lote passa do teto, salvo um arquivo
// que já é maior que ele sozinho.
export function chunkBySize(files, maxBytes = 16 * 1024 * 1024) {
  const lotes = [];
  let atual = [];
  let soma = 0;
  for (const file of files) {
    const n = file.content?.byteLength ?? file.content?.length ?? 0;
    if (atual.length && soma + n > maxBytes) { lotes.push(atual); atual = []; soma = 0; }
    atual.push(file); soma += n;
  }
  if (atual.length) lotes.push(atual);
  return lotes;
}
```

```js
// packages/web-shell/lib/canonical/output-bundle.js
// O .tgz que a máquina deixa vira a entrada do registerNativeBundle. O tipo de cada arquivo copiado da captura
// é o que a captura registrou (arquivos sem extensão, como `_ext/...`, viravam octet-stream por inferência);
// o que é nosso (index.html, motion.json, vendor/) o registro infere pela extensão.
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import tar from 'tar-stream';

export const MAX_ARCHIVE_BYTES = 400 * 1024 * 1024;

export async function readTarGz(buffer, { maxBytes = MAX_ARCHIVE_BYTES } = {}) {
  const raw = gunzipSync(buffer, { maxOutputLength: maxBytes });
  const extract = tar.extract();
  const files = [];
  await new Promise((resolve, reject) => {
    extract.on('entry', (header, stream, next) => {
      const chunks = [];
      stream.on('data', (c) => chunks.push(c));
      stream.on('error', reject);
      stream.on('end', () => {
        const name = header.name.replace(/^\.\//, '');
        if (header.type === 'file' && name) files.push({ path: name, body: new Uint8Array(Buffer.concat(chunks)) });
        next();
      });
    });
    extract.on('finish', resolve);
    extract.on('error', reject);
    extract.end(raw);
  });
  return files;
}

export function canonicalProducerOutput({ files, nativeDescriptor }) {
  const paths = new Set(files.map((f) => f.path));
  for (const required of ['index.html', 'motion.json']) {
    if (!paths.has(required)) throw Object.assign(new Error(`output_incomplete: ${required}`), { code: 'recording_failed', detail: `missing ${required}` });
  }
  const known = new Map((nativeDescriptor?.assetIndex || []).map((a) => [a.path, a.contentType]));
  const assets = files.map(({ path, body }) => (known.has(path) ? { path, body, contentType: known.get(path) } : { path, body }));
  const fingerprint = createHash('sha256').update(Buffer.from(files.map((f) => f.path).sort().join('\n'))).digest('hex');
  return {
    entryPath: 'index.html',
    assets,
    runtimeFingerprint: `sha256:${fingerprint}`,
    reconstructionCapabilities: { detectedEngines: [], candidateControls: [] },
  };
}
```

```js
// packages/web-shell/lib/canonical/publish.js
// Publicação da cópia (spec 2026-10-09 §4.1): snapshot 'canonical' + ponteiro do node + tarefa 'ready' numa
// instrução só. Só publica se a tarefa ainda está em 'packaging' na MESMA geração e com a MESMA trava, e se o
// node ainda aponta para a versão de quando a tarefa nasceu. Senão: publish_conflict, nada muda.
import { createEmptyMotionManifest } from '../motion-editor/manifest.js';

export async function publishCanonical({ sql, job, owner, descriptor, html }) {
  const manifest = createEmptyMotionManifest({ baseBundleId: descriptor.bundleId, runtimeFingerprint: descriptor.runtimeFingerprint });
  const meta = { canonicalJobId: job.id, canonicalPreparedAt: new Date().toISOString() };
  const rows = await sql`
    WITH fence AS (
      SELECT j.id FROM canonical_jobs j
       WHERE j.id = ${job.id} AND j.status = 'packaging' AND j.generation = ${job.generation} AND j.lease_owner = ${owner}
       FOR UPDATE
    ), current_node AS (
      SELECT n.id FROM nodes n, fence
       WHERE n.id = ${job.node_id} AND n.current_snapshot_id = ${job.source_snapshot_id}
       FOR UPDATE OF n
    ), inserted AS (
      INSERT INTO snapshots (
        node_id, html, screenshot_url, source, parent_snapshot_id,
        native_bundle_id, motion_manifest, motion_manifest_version
      )
      SELECT ${job.node_id}, ${html},
             (SELECT screenshot_url FROM snapshots WHERE id = ${job.source_snapshot_id}),
             'canonical', ${job.source_snapshot_id},
             ${descriptor.bundleId}, ${JSON.stringify(manifest)}::jsonb, ${manifest.schemaVersion}
        FROM current_node
      RETURNING id
    ), updated_node AS (
      UPDATE nodes
         SET current_snapshot_id = inserted.id,
             meta = meta || ${JSON.stringify(meta)}::jsonb
        FROM inserted
       WHERE nodes.id = ${job.node_id} AND nodes.current_snapshot_id = ${job.source_snapshot_id}
      RETURNING inserted.id AS snapshot_id
    ), done AS (
      UPDATE canonical_jobs
         SET status = 'ready', generation = generation + 1, progress_pct = 100,
             result_bundle_id = ${descriptor.bundleId},
             result_snapshot_id = (SELECT snapshot_id FROM updated_node),
             lease_owner = NULL, lease_until = NULL, updated_at = NOW()
       WHERE id = ${job.id} AND EXISTS (SELECT 1 FROM updated_node)
      RETURNING id
    )
    SELECT (SELECT snapshot_id FROM updated_node) AS snapshot_id, (SELECT id FROM done) AS job_id`;
  const snapshotId = rows[0]?.snapshot_id || null;
  if (!snapshotId || !rows[0]?.job_id) throw Object.assign(new Error('publish_conflict'), { code: 'publish_conflict' });
  return { snapshotId, motionManifest: manifest };
}
```

Em `lib/node-editor-kind.js:16` trocar a constante por:

```js
export const CANONICAL_SNAPSHOT_SOURCE = 'canonical';
// 'canonical' (a cópia editável, spec 2026-10-09) tem a mesma estrutura de um snapshot nativo: pacote + manifesto v2.
export const NATIVE_SNAPSHOT_SOURCES = Object.freeze(['native-bundle', 'native-edit', CANONICAL_SNAPSHOT_SOURCE]);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/web-shell && npx vitest run lib/canonical/sandbox-runner.test.js lib/canonical/payload.test.js lib/canonical/output-bundle.test.js lib/canonical/publish.test.js lib/node-editor-kind.test.js`
Expected: PASS em todos. Se o teste do fecho de imports falhar listando um arquivo a mais, acrescentar o arquivo a
`PAYLOAD_FILES` (é o teste fazendo o trabalho dele), nunca afrouxar o teste.

- [ ] **Step 5: Commit**

```bash
git add packages/web-shell/lib/canonical/sandbox-runner.js packages/web-shell/lib/canonical/sandbox-runner.test.js \
  packages/web-shell/lib/canonical/payload.js packages/web-shell/lib/canonical/payload.test.js \
  packages/web-shell/lib/canonical/output-bundle.js packages/web-shell/lib/canonical/output-bundle.test.js \
  packages/web-shell/lib/canonical/publish.js packages/web-shell/lib/canonical/publish.test.js \
  packages/web-shell/lib/node-editor-kind.js packages/web-shell/lib/node-editor-kind.test.js
git commit -m "feat(canonical): sandbox runner, payload, output bundle and fenced publish"
```

---

### Task 6: Iniciar a tarefa e reservar a cobrança

**Files:**
- Create: `packages/web-shell/lib/canonical/job-service.js` (primeira parte)
- Modify: `packages/web-shell/lib/billing/pricing.js` (`OP_PRICING` e `OP_ESTIMATES`)
- Modify: `packages/web-shell/lib/billing/operations.js` (`findStrandedOperations`)
- Test: `packages/web-shell/lib/canonical/job-service.start.test.js`, `packages/web-shell/lib/billing/operations.test.js`

**Interfaces:**
- Consumes: `job-store.js` (Task 4), `claimOperation` (`lib/billing/operations.js`), `settleOperation`
  (`lib/billing/ledger.js`), `estimateOp` (`lib/billing/pricing.js`).
- Produces: `CANONICAL_OP = 'clone.canonical'`, `canonicalEditEnabled(env)`, `publicCanonicalJobView(job)` →
  `{ id, nodeId, status, progressPct, errorCode }`, `readyResult(job)` → resultado que
  `applyReconstructionResultToNode` aceita ou `null`, `startCanonicalJob({sql,userId,node,idemKey,deps})` →
  `{ job } | { error: { code, status, ... } }`.

- [ ] **Step 1: Write the failing tests**

```js
// packages/web-shell/lib/canonical/job-service.start.test.js
import { describe, expect, it, vi } from 'vitest';
import { CANONICAL_OP, canonicalEditEnabled, publicCanonicalJobView, readyResult, startCanonicalJob } from './job-service.js';

const node = { id: 'n1', board_id: 'b1', current_snapshot_id: 's1', current_snapshot_source: 'native-bundle', current_native_bundle_id: 'nb1' };
function deps(over = {}) {
  return {
    jobStore: {
      findActiveJobForNode: vi.fn(async () => null),
      findJobByIdem: vi.fn(async () => null),
      insertJob: vi.fn(async (a) => ({ id: 'j1', status: 'queued', progress_pct: 10, node_id: a.nodeId })),
    },
    claimOperation: vi.fn(async () => ({ outcome: 'claimed', operationId: 'op1', balance: 100 })),
    settleOperation: vi.fn(async () => ({})),
    ...over,
  };
}

describe('iniciar a preparação', () => {
  it('interruptor do servidor fecha por padrão', () => {
    expect(canonicalEditEnabled({})).toBe(false);
    expect(canonicalEditEnabled({ UNCRAFT_CANONICAL_EDIT: '1' })).toBe(true);
    expect(canonicalEditEnabled({ UNCRAFT_CANONICAL_EDIT: 'true' })).toBe(false);
  });

  it('só node com captura nativa nunca editada', async () => {
    const d = deps();
    for (const source of ['native-edit', 'canonical', 'capture', null]) {
      const out = await startCanonicalJob({ sql: {}, userId: 1, node: { ...node, current_snapshot_source: source }, idemKey: 'k', deps: d });
      expect(out.error).toEqual({ code: 'canonical_not_applicable', status: 409 });
    }
    expect(d.claimOperation).not.toHaveBeenCalled();
  });

  it('reserva a cobrança (preço 0) e cria a tarefa com a versão atual do node', async () => {
    const d = deps();
    const out = await startCanonicalJob({ sql: {}, userId: 1, node, idemKey: 'k', deps: d });
    expect(out.job.id).toBe('j1');
    expect(d.claimOperation).toHaveBeenCalledWith(expect.objectContaining({ op: CANONICAL_OP, idemKey: 'canonical:k', estimate: 0, nodeId: 'n1' }));
    expect(d.jobStore.insertJob).toHaveBeenCalledWith(expect.objectContaining({ sourceSnapshotId: 's1', nativeBundleId: 'nb1', idemKey: 'k', opId: 'op1' }));
  });

  it('segunda aba: devolve a tarefa ativa sem reservar de novo', async () => {
    const d = deps();
    d.jobStore.findActiveJobForNode.mockResolvedValueOnce({ id: 'j-viva', status: 'recording' });
    const out = await startCanonicalJob({ sql: {}, userId: 1, node, idemKey: 'k2', deps: d });
    expect(out.job.id).toBe('j-viva');
    expect(d.claimOperation).not.toHaveBeenCalled();
  });

  it('corrida na inserção com OUTRA etiqueta: devolve a reserva desta e reusa a tarefa vencedora', async () => {
    const d = deps();
    d.jobStore.insertJob.mockResolvedValueOnce(null);
    d.jobStore.findActiveJobForNode.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'j-outra', op_id: 'op-outra' });
    const out = await startCanonicalJob({ sql: {}, userId: 1, node, idemKey: 'k', deps: d });
    expect(out.job.id).toBe('j-outra');
    expect(d.settleOperation).toHaveBeenCalledWith(expect.objectContaining({ opId: 'op1', opStatus: 'failed', chargeCredits: 0 }));
  });

  it('corrida com a MESMA etiqueta: a reserva é partilhada e NÃO é devolvida', async () => {
    const d = deps();
    d.claimOperation.mockResolvedValueOnce({ outcome: 'duplicate', row: { id: 'op-gemea', status: 'in_flight' } });
    d.jobStore.insertJob.mockResolvedValueOnce(null);
    d.jobStore.findJobByIdem.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'j-gemea', op_id: 'op-gemea' });
    const out = await startCanonicalJob({ sql: {}, userId: 1, node, idemKey: 'k', deps: d });
    expect(out.job.id).toBe('j-gemea');
    expect(d.jobStore.insertJob).toHaveBeenCalledWith(expect.objectContaining({ opId: 'op-gemea' }));
    expect(d.settleOperation).not.toHaveBeenCalled();
  });

  it('visão pública não vaza detalhe interno', () => {
    expect(publicCanonicalJobView({ id: 'j', node_id: 'n', status: 'failed', progress_pct: 57, error_code: 'timeout', error_detail: 'segredo', sandbox_name: 'x' }))
      .toEqual({ id: 'j', nodeId: 'n', status: 'failed', progressPct: 57, errorCode: 'timeout' });
  });

  it('resultado pronto no formato que o canvas aplica', () => {
    expect(readyResult({ status: 'recording' })).toBeNull();
    expect(readyResult({ status: 'ready', result_bundle_id: 'b2', result_snapshot_id: 's2' })).toEqual({
      kind: 'native', snapshotId: 's2', snapshotSource: 'canonical',
      bundleDescriptor: { bundleId: 'b2' }, motionManifest: { schemaVersion: 2, baseBundleId: 'b2' },
    });
  });
});
```

Em `lib/billing/operations.test.js`, acrescentar:

```js
  it('findStrandedOperations deixa de fora a reserva de uma preparação viva', async () => {
    const calls = [];
    const sql = (strings, ...values) => { calls.push(strings.join('?')); return Promise.resolve([]); };
    await findStrandedOperations({ sql, olderThanSecs: 900, limit: 10 });
    expect(calls[0]).toMatch(/NOT EXISTS \(\s*SELECT 1 FROM canonical_jobs j\s+WHERE j\.op_id = operations\.id\s+AND j\.cleanup_done = false\s*\)/);
  });
```

(Se `findStrandedOperations` ainda não estiver importado no topo do arquivo, acrescentar ao import de `./operations.js`.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/web-shell && npx vitest run lib/canonical/job-service.start.test.js lib/billing/operations.test.js`
Expected: FAIL — `./job-service.js` não resolve; o teste novo de operations falha no `toMatch`.

- [ ] **Step 3: Write minimal implementation**

Em `lib/billing/pricing.js`, acrescentar a `OP_PRICING` (depois de `'clone.edit'`):

```js
  // Preparação da cópia editável (spec 2026-10-09 §4.5): ciclo de reserva completo, preço ainda 0.
  'clone.canonical':    { flat: 0 },
```

e a `OP_ESTIMATES` (depois de `'clone.edit'`):

```js
  'clone.canonical': 0,
```

Em `lib/billing/operations.js`, trocar o corpo de `findStrandedOperations` por:

```js
export async function findStrandedOperations({ sql, olderThanSecs = 900, limit = 100 }) {
  // A preparação da cópia (spec 2026-10-09) vive até 35 min — mais que o TTL. Enquanto a tarefa dela não terminou
  // a LIMPEZA (máquina desligada + cobrança encerrada), a reserva NÃO é órfã: quem a encerra é a própria tarefa ou a
  // varredura dela — senão esta varredura devolveria a reserva de uma cópia entregue.
  return sql`
    SELECT id, user_id, op, hold_credits, created_at
    FROM operations
    WHERE status = 'in_flight' AND created_at < NOW() - make_interval(secs => ${olderThanSecs})
      AND NOT EXISTS (
        SELECT 1 FROM canonical_jobs j
         WHERE j.op_id = operations.id
           AND j.cleanup_done = false
      )
    ORDER BY created_at ASC
    LIMIT ${limit}
  `;
}
```

```js
// packages/web-shell/lib/canonical/job-service.js
// Preparação da cópia editável no Edit (spec 2026-10-09 §4). Nenhum request espera a máquina: o canvas
// consulta e cada consulta avança UM passo curto sob a trava da tarefa.
import { claimOperation } from '../billing/operations.js';
import { settleOperation } from '../billing/ledger.js';
import { estimateOp } from '../billing/pricing.js';
import * as jobStore from './job-store.js';

export const CANONICAL_OP = 'clone.canonical';

export function canonicalEditEnabled(env = process.env) {
  return env.UNCRAFT_CANONICAL_EDIT === '1';
}

export function publicCanonicalJobView(job) {
  return {
    id: job.id,
    nodeId: job.node_id,
    status: job.status,
    progressPct: Number(job.progress_pct) || 0,
    errorCode: job.error_code || null,
  };
}

export function readyResult(job) {
  if (job?.status !== 'ready' || !job.result_bundle_id || !job.result_snapshot_id) return null;
  return {
    kind: 'native',
    snapshotId: job.result_snapshot_id,
    snapshotSource: 'canonical',
    bundleDescriptor: { bundleId: job.result_bundle_id },
    motionManifest: { schemaVersion: 2, baseBundleId: job.result_bundle_id },
  };
}

function logSettleFailure(jobId, error) {
  // eslint-disable-next-line no-console
  console.error('[canonical] settle failed', jobId, error?.code || error?.message);
}

export async function startCanonicalJob({ sql, userId, node, idemKey, deps = {} }) {
  const store = deps.jobStore || jobStore;
  const claim = deps.claimOperation || claimOperation;
  const settle = deps.settleOperation || settleOperation;
  if (node?.current_snapshot_source !== 'native-bundle' || !node.current_native_bundle_id || !node.current_snapshot_id) {
    return { error: { code: 'canonical_not_applicable', status: 409 } };
  }
  const active = await store.findActiveJobForNode({ sql, userId, nodeId: node.id });
  if (active) return { job: active };
  const previous = await store.findJobByIdem({ sql, userId, idemKey });
  if (previous) return { job: previous };

  const estimate = estimateOp(CANONICAL_OP);
  const claimed = await claim({ sql, userId, idemKey: `canonical:${idemKey}`, op: CANONICAL_OP, boardId: node.board_id, nodeId: node.id, estimate });
  if (claimed.outcome === 'insufficient') return { error: { code: 'insufficient_credits', status: 402, estimate, balance: claimed.balance } };
  const opId = claimed.outcome === 'claimed'
    ? claimed.operationId
    : (claimed.row?.status === 'in_flight' ? claimed.row.id : null);

  const job = await store.insertJob({
    sql, userId, boardId: node.board_id, nodeId: node.id,
    sourceSnapshotId: node.current_snapshot_id, nativeBundleId: node.current_native_bundle_id, idemKey, opId,
  });
  if (job) return { job };

  // Corrida: outra requisição criou a tarefa entre a leitura e a inserção. Só devolve a reserva que ESTA requisição
  // criou e que nenhuma tarefa adotou — com a mesma etiqueta a reserva é PARTILHADA e a tarefa vencedora vai usá-la.
  const winner = (await store.findJobByIdem({ sql, userId, idemKey })) || (await store.findActiveJobForNode({ sql, userId, nodeId: node.id }));
  if (opId && claimed.outcome === 'claimed' && winner?.op_id !== opId) {
    await settle({ sql, userId, opId, op: CANONICAL_OP, boardId: node.board_id, nodeId: node.id, holdCredits: estimate, chargeCredits: 0, opStatus: 'failed' })
      .catch((e) => logSettleFailure(null, e));
  }
  return winner ? { job: winner } : { error: { code: 'internal', status: 500 } };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/web-shell && npx vitest run lib/canonical/job-service.start.test.js lib/billing/operations.test.js lib/billing/pricing.test.js`
Expected: PASS (se `pricing.test.js` não existir, o vitest só roda os outros dois — conferir que a saída lista os
arquivos e nenhum `failed`).

- [ ] **Step 5: Commit**

```bash
git add packages/web-shell/lib/canonical/job-service.js packages/web-shell/lib/canonical/job-service.start.test.js \
  packages/web-shell/lib/billing/pricing.js packages/web-shell/lib/billing/operations.js packages/web-shell/lib/billing/operations.test.js
git commit -m "feat(canonical): start the job with a price-0 hold kept out of the stranded sweep"
```

---

### Task 7: Avançar a tarefa (máquina de estados) e varrer as vencidas

**Files:**
- Modify: `packages/web-shell/lib/canonical/job-service.js` (acrescentar ao fim)
- Test: `packages/web-shell/lib/canonical/job-service.advance.test.js`

**Interfaces:**
- Consumes: Tasks 2, 4, 5, 6.
- Produces: `LEASE_SECS = 330` (> `maxDuration` 300 da rota), `createCanonicalDeps(overrides)`,
  `advanceCanonicalJob({sql,userId,jobId,deps})` → `{ job: publicView, result? } | { error: { code, status } }`,
  `sweepCanonicalJobs({sql,deps,limit})` → `{ scanned, failed, cleaned }`.
  Códigos de falha públicos: `capture_failed`, `sandbox_unavailable`, `recording_failed`, `timeout`,
  `publish_conflict`, `internal`.

- [ ] **Step 1: Write the failing test**

O teste usa um armazém de tarefas EM MEMÓRIA com as mesmas cercas do SQL (status + geração + dono), para a máquina
de estados ser exercitada de verdade e não por mocks soltos.

```js
// packages/web-shell/lib/canonical/job-service.advance.test.js
import { describe, expect, it, vi } from 'vitest';
import { advanceCanonicalJob, sweepCanonicalJobs } from './job-service.js';
import { ACTIVE, TERMINAL } from './job-store.js';
import { VM } from './sandbox-runner.js';

// Armazém EM MEMÓRIA com as mesmas cercas do SQL (status + geração + dono), para a máquina de estados ser
// exercitada de verdade e não por mocks soltos.
function memoryJobStore(initial) {
  const rows = new Map(initial.map((r) => [r.id, { ...r }]));
  const PATCH = ['stage', 'sandbox_name', 'command_id', 'progress_pct', 'result_bundle_id', 'error_code', 'error_detail'];
  const apply = (row, patch) => {
    for (const k of PATCH) if (patch?.[k] != null) row[k] = k === 'progress_pct' ? Math.max(row.progress_pct, patch[k]) : patch[k];
  };
  return {
    ACTIVE, TERMINAL, rows,
    async getOwnedJob({ userId, jobId }) { const r = rows.get(jobId); return r && r.user_id === userId ? { ...r } : null; },
    async acquireLease({ jobId, owner }) {
      const r = rows.get(jobId);
      if (!r || !ACTIVE.includes(r.status) || r.lease_owner) return null;
      r.lease_owner = owner; return { ...r };
    },
    async releaseLease({ jobId, owner }) { const r = rows.get(jobId); if (r && r.lease_owner === owner) r.lease_owner = null; },
    async moveJob({ jobId, owner, generation, from, to, patch }) {
      const r = rows.get(jobId);
      if (!r || r.status !== from || r.generation !== generation || r.lease_owner !== owner) return null;
      r.status = to; r.generation += 1; apply(r, patch); return { ...r };
    },
    async noteJob({ jobId, owner, generation, patch }) {
      const r = rows.get(jobId);
      if (!r || r.generation !== generation || r.lease_owner !== owner || !ACTIVE.includes(r.status)) return null;
      apply(r, patch); return { ...r };
    },
    async restartJob({ jobId, owner, generation, from }) {
      const r = rows.get(jobId);
      if (!r || r.status !== from || r.generation !== generation || r.lease_owner !== owner || r.attempt >= 2) return null;
      Object.assign(r, { status: 'queued', generation: r.generation + 1, attempt: r.attempt + 1, sandbox_name: null, command_id: null, stage: null });
      return { ...r };
    },
    async listOverdueJobs() { return [...rows.values()].filter((r) => ACTIVE.includes(r.status) && r.deadline_at < Date.now()).map((r) => ({ ...r })); },
    async failOverdueJob({ jobId, generation, from }) {
      const r = rows.get(jobId);
      // espelha `(lease_until IS NULL OR lease_until < NOW())`: aqui, trava presente = válida
      if (!r || r.status !== from || r.generation !== generation || r.lease_owner) return null;
      Object.assign(r, { status: 'failed', generation: r.generation + 1, error_code: 'timeout', lease_owner: null }); return { ...r };
    },
    async listCleanupPending() { return [...rows.values()].filter((r) => TERMINAL.has(r.status) && !r.cleanup_done).map((r) => ({ ...r })); },
    async markCleanupDone({ jobId }) { const r = rows.get(jobId); if (r && TERMINAL.has(r.status)) r.cleanup_done = true; },
  };
}

function baseJob(over = {}) {
  return {
    id: 'j1', user_id: 1, board_id: 'b1', node_id: 'n1', source_snapshot_id: 's1', native_bundle_id: 'nb1',
    status: 'queued', stage: null, progress_pct: 10, generation: 1, attempt: 1, lease_owner: null,
    sandbox_name: null, command_id: null, op_id: 'op1', result_bundle_id: null, result_snapshot_id: null,
    error_code: null, error_detail: null, cleanup_done: false, deadline_at: Date.now() + 60_000, created_at: Date.now(), ...over,
  };
}

// `vm.files` = arquivos que a MÁQUINA tem (o script escreve `iniciado` e `fim.json` — a verdade do andamento).
function setup(jobOver = {}, { vm = {} } = {}) {
  const store = memoryJobStore([baseJob(jobOver)]);
  const sandbox = { status: 'running' };
  const files = new Map(Object.entries(vm.files || {}));
  const runner = {
    ensure: vi.fn(async () => sandbox),
    find: vi.fn(async () => (vm.missing ? null : sandbox)),
    isAlive: (s) => Boolean(s) && ['pending', 'running'].includes(s.status),
    writeFiles: vi.fn(async () => {}),
    start: vi.fn(async () => 'cmd-1'),
    readFile: vi.fn(async (_s, p) => (files.has(p) ? Buffer.from(files.get(p)) : null)),
    stop: vi.fn(async () => {}),
  };
  let n = 0;
  const deps = {
    jobStore: store,
    runner,
    bundleStore: {},
    loadCodePayload: vi.fn(async () => [{ path: `${VM.code}/package.json`, content: Buffer.from('{}') }]),
    loadCapturePayload: vi.fn(async () => [{ path: `${VM.capture}/index.html`, content: Buffer.from('<html>') }]),
    loadNativeDescriptor: vi.fn(async () => ({ entryPath: 'index.html', assetIndex: [] })),
    readTarGz: vi.fn(async () => [
      { path: 'index.html', body: new TextEncoder().encode('<html>canonica</html>') },
      { path: 'motion.json', body: new TextEncoder().encode('{"versao":0,"fichas":[]}') },
    ]),
    registerNativeBundle: vi.fn(async () => ({ bundleId: 'cb1', runtimeFingerprint: `sha256:${'c'.repeat(64)}` })),
    persistNativeBundleDescriptor: vi.fn(async () => {}),
    publishCanonical: vi.fn(async ({ job }) => {
      const r = store.rows.get(job.id);
      Object.assign(r, { status: 'ready', generation: r.generation + 1, progress_pct: 100, result_bundle_id: 'cb1', result_snapshot_id: 's2', lease_owner: null });
      return { snapshotId: 's2' };
    }),
    settleOperation: vi.fn(async () => ({})),
    newOwner: () => `w${(n += 1)}`,
  };
  return { store, runner, deps, sandbox, files };
}

const advance = (deps) => advanceCanonicalJob({ sql: {}, userId: 1, jobId: 'j1', deps });
const gravando = (over = {}) => ({ status: 'recording', sandbox_name: 'uc-canon-j1-a1', command_id: 'cmd-1', progress_pct: 14, ...over });

describe('avançar a preparação', () => {
  it('fila → máquina criada pelo nome → arquivos → comando → gravando, numa consulta', async () => {
    const { store, runner, deps } = setup();
    const out = await advance(deps);
    expect(runner.ensure).toHaveBeenCalledWith('uc-canon-j1-a1');
    expect(runner.writeFiles).toHaveBeenCalled();
    expect(runner.start).toHaveBeenCalledTimes(1);
    expect(out.job).toMatchObject({ status: 'recording', progressPct: 14 });
    expect(store.rows.get('j1')).toMatchObject({ sandbox_name: 'uc-canon-j1-a1', command_id: 'cmd-1', lease_owner: null });
  });

  it('gravando: o número vem do arquivo de progresso da máquina', async () => {
    const { deps } = setup(gravando(), { vm: { files: { [VM.progress]: '{"fase":"instalando"}\n{"fase":"gravando","feitas":20,"total":40}\n' } } });
    const out = await advance(deps);
    expect(out.job).toMatchObject({ status: 'recording', progressPct: 50 });
  });

  it('script terminou bem → registra, publica, encerra a cobrança, desliga a máquina e fecha a limpeza', async () => {
    const { store, runner, deps } = setup(gravando(), { vm: { files: { [VM.done]: '{"codigo":0}', [VM.archive]: 'tgz' } } });
    const out = await advance(deps);
    expect(out.job.status).toBe('ready');
    expect(out.result).toMatchObject({ snapshotId: 's2', snapshotSource: 'canonical', bundleDescriptor: { bundleId: 'cb1' } });
    expect(deps.publishCanonical).toHaveBeenCalledWith(expect.objectContaining({ html: '<html>canonica</html>' }));
    expect(deps.settleOperation).toHaveBeenCalledWith(expect.objectContaining({ opId: 'op1', opStatus: 'settled', chargeCredits: 0 }));
    expect(runner.stop).toHaveBeenCalledWith('uc-canon-j1-a1');
    expect(store.rows.get('j1').cleanup_done).toBe(true);
  });

  it('script falhou → recording_failed, reserva devolvida, máquina desligada', async () => {
    const { runner, deps } = setup(gravando(), { vm: { files: { [VM.done]: '{"codigo":43}', [VM.errors]: 'TypeError: x' } } });
    const out = await advance(deps);
    expect(out.job).toMatchObject({ status: 'failed', errorCode: 'recording_failed' });
    expect(deps.settleOperation).toHaveBeenCalledWith(expect.objectContaining({ opStatus: 'failed', chargeCredits: 0 }));
    expect(runner.stop).toHaveBeenCalledWith('uc-canon-j1-a1');
  });

  it('máquina morreu: recomeça do zero UMA vez (desligando a velha); na segunda, sandbox_unavailable', async () => {
    const first = setup(gravando(), { vm: { missing: true } });
    const out1 = await advance(first.deps);
    expect(out1.job.status).toBe('queued');
    expect(first.store.rows.get('j1')).toMatchObject({ attempt: 2, sandbox_name: null, command_id: null });
    expect(first.runner.stop).toHaveBeenCalledWith('uc-canon-j1-a1');
    const second = setup(gravando({ attempt: 2, sandbox_name: 'uc-canon-j1-a2', command_id: 'cmd-2' }), { vm: { missing: true } });
    const out2 = await advance(second.deps);
    expect(out2.job).toMatchObject({ status: 'failed', errorCode: 'sandbox_unavailable' });
  });

  it('outra requisição com a trava: devolve a visão sem tocar a máquina', async () => {
    const { runner, deps } = setup(gravando({ lease_owner: 'outra' }));
    const out = await advance(deps);
    expect(out.job.status).toBe('recording');
    expect(runner.find).not.toHaveBeenCalled();
    expect(runner.readFile).not.toHaveBeenCalled();
  });

  it('requisição anterior morreu DEPOIS de iniciar o script e ANTES de gravar o estado: não inicia outro', async () => {
    // estado no banco: 'provisioning' sem command_id; na máquina, o script já escreveu `iniciado`
    const { runner, deps } = setup(
      { status: 'provisioning', sandbox_name: 'uc-canon-j1-a1', command_id: null, stage: 'files' },
      { vm: { files: { [VM.started]: 'iniciado\n' } } },
    );
    const out = await advance(deps);
    expect(runner.start).not.toHaveBeenCalled();
    expect(runner.writeFiles).not.toHaveBeenCalled();
    expect(out.job.status).toBe('recording');
  });

  it('trava tomada no meio do passo: a requisição velha para — não inicia, não desliga, não cobra, não falha', async () => {
    const { store, runner, deps } = setup();
    runner.writeFiles.mockImplementationOnce(async () => { store.rows.get('j1').lease_owner = 'intruso'; });
    const out = await advance(deps);
    expect(runner.start).not.toHaveBeenCalled();
    expect(runner.stop).not.toHaveBeenCalled();
    expect(deps.settleOperation).not.toHaveBeenCalled();
    expect(out.job.status).toBe('provisioning');
    expect(store.rows.get('j1').lease_owner).toBe('intruso');
  });

  it('node mudou no meio → publish_conflict com reserva devolvida', async () => {
    const { deps } = setup(gravando(), { vm: { files: { [VM.done]: '{"codigo":0}', [VM.archive]: 'tgz' } } });
    deps.publishCanonical.mockRejectedValueOnce(Object.assign(new Error('publish_conflict'), { code: 'publish_conflict' }));
    const out = await advance(deps);
    expect(out.job).toMatchObject({ status: 'failed', errorCode: 'publish_conflict' });
    expect(deps.settleOperation).toHaveBeenCalledWith(expect.objectContaining({ opStatus: 'failed' }));
  });

  it('erro DEPOIS de mudar de estado não deixa a tarefa presa (falha lê a linha atual)', async () => {
    const { deps } = setup(gravando(), { vm: { files: { [VM.done]: '{"codigo":0}', [VM.archive]: 'tgz' } } });
    deps.registerNativeBundle.mockRejectedValueOnce(new Error('blob down'));
    const out = await advance(deps);
    expect(out.job).toMatchObject({ status: 'failed', errorCode: 'internal' });
  });

  it('desligar a máquina falhou depois de pronta: limpeza fica pendente (a varredura retoma)', async () => {
    const { store, runner, deps } = setup(gravando(), { vm: { files: { [VM.done]: '{"codigo":0}', [VM.archive]: 'tgz' } } });
    runner.stop.mockRejectedValueOnce(new Error('api down'));
    const out = await advance(deps);
    expect(out.job.status).toBe('ready');
    expect(store.rows.get('j1').cleanup_done).toBe(false);
  });

  it('criar a máquina falhou → sandbox_unavailable', async () => {
    const { runner, deps } = setup();
    runner.ensure.mockRejectedValueOnce(new Error('quota'));
    const out = await advance(deps);
    expect(out.job).toMatchObject({ status: 'failed', errorCode: 'sandbox_unavailable' });
  });

  it('captura que não serve → capture_failed', async () => {
    const { deps } = setup();
    deps.loadCapturePayload.mockRejectedValueOnce(Object.assign(new Error('entry'), { code: 'capture_failed' }));
    const out = await advance(deps);
    expect(out.job).toMatchObject({ status: 'failed', errorCode: 'capture_failed' });
  });

  it('prazo vencido → timeout, máquina desligada', async () => {
    const { runner, deps } = setup(gravando({ deadline_at: Date.now() - 1 }));
    const out = await advance(deps);
    expect(out.job).toMatchObject({ status: 'failed', errorCode: 'timeout' });
    expect(runner.stop).toHaveBeenCalledWith('uc-canon-j1-a1');
  });

  it('tarefa de outro usuário: 404', async () => {
    const { deps } = setup();
    expect(await advanceCanonicalJob({ sql: {}, userId: 2, jobId: 'j1', deps })).toEqual({ error: { code: 'not_found', status: 404 } });
  });

  it('tarefa pronta devolve o resultado em toda consulta', async () => {
    const { deps } = setup({ status: 'ready', result_bundle_id: 'cb1', result_snapshot_id: 's2', progress_pct: 100, cleanup_done: true });
    const out = await advance(deps);
    expect(out.result).toMatchObject({ snapshotId: 's2' });
  });

  it('varredura: falha as vencidas e fecha a limpeza delas', async () => {
    const { store, runner, deps } = setup(gravando({ deadline_at: Date.now() - 1 }));
    expect(await sweepCanonicalJobs({ sql: {}, deps })).toEqual({ scanned: 1, failed: 1, cleaned: 1 });
    expect(runner.stop).toHaveBeenCalledWith('uc-canon-j1-a1');
    expect(deps.settleOperation).toHaveBeenCalledWith(expect.objectContaining({ opStatus: 'failed' }));
    expect(store.rows.get('j1').cleanup_done).toBe(true);
  });

  it('varredura não derruba tarefa com trava viva, mesmo vencida: a máquina que está nascendo não fica órfã', async () => {
    const { store, runner, deps } = setup();
    let soltarEnsure;
    runner.ensure.mockImplementationOnce(() => new Promise((r) => { soltarEnsure = () => r({ status: 'running' }); }));
    const emAndamento = advance(deps);                       // pega a trava e fica esperando a máquina nascer
    await new Promise((r) => setTimeout(r, 0));
    store.rows.get('j1').deadline_at = Date.now() - 1;       // o prazo vence no meio
    expect(await sweepCanonicalJobs({ sql: {}, deps })).toEqual({ scanned: 1, failed: 0, cleaned: 0 });
    expect(runner.stop).not.toHaveBeenCalled();
    soltarEnsure();
    const out = await emAndamento;
    expect(out.job.status).toBe('recording');                // a requisição dona terminou o passo e sabe da máquina
    const depois = await advance(deps);                      // a próxima consulta vê o prazo e encerra direito
    expect(depois.job).toMatchObject({ status: 'failed', errorCode: 'timeout' });
    expect(runner.stop).toHaveBeenCalledWith('uc-canon-j1-a1');
  });

  it('máquina ausente na limpeza: fica pendente até ela aparecer e ser desligada, ou até passar o prazo dela', async () => {
    const { store, runner, deps } = setup({ status: 'failed', error_code: 'timeout', sandbox_name: 'uc-canon-j1-a1', cleanup_done: false });
    runner.stop.mockResolvedValueOnce('absent');                 // a criação ficou no ar: ainda não existe
    expect(await sweepCanonicalJobs({ sql: {}, deps })).toEqual({ scanned: 0, failed: 0, cleaned: 0 });
    expect(store.rows.get('j1').cleanup_done).toBe(false);
    expect(deps.settleOperation).toHaveBeenCalledWith(expect.objectContaining({ opStatus: 'failed' })); // dinheiro não espera
    runner.stop.mockResolvedValueOnce('stopped');                // nasceu depois: a varredura seguinte desliga
    expect(await sweepCanonicalJobs({ sql: {}, deps })).toEqual({ scanned: 0, failed: 0, cleaned: 1 });
    expect(store.rows.get('j1').cleanup_done).toBe(true);
  });

  it('máquina que nunca aparece: a ausência fecha a limpeza só depois do prazo da própria máquina', async () => {
    const { store, runner, deps } = setup({ status: 'failed', sandbox_name: 'uc-canon-j1-a1', cleanup_done: false, created_at: Date.now() - 32 * 60 * 1000 });
    runner.stop.mockResolvedValueOnce('absent');
    expect(await sweepCanonicalJobs({ sql: {}, deps })).toEqual({ scanned: 0, failed: 0, cleaned: 1 });
    expect(store.rows.get('j1').cleanup_done).toBe(true);
  });

  it('varredura retoma limpeza pendente de tarefa PRONTA: desliga e encerra a cobrança como entregue', async () => {
    const { store, runner, deps } = setup({ status: 'ready', sandbox_name: 'uc-canon-j1-a1', result_bundle_id: 'cb1', result_snapshot_id: 's2', cleanup_done: false });
    expect(await sweepCanonicalJobs({ sql: {}, deps })).toEqual({ scanned: 0, failed: 0, cleaned: 1 });
    expect(runner.stop).toHaveBeenCalledWith('uc-canon-j1-a1');
    expect(deps.settleOperation).toHaveBeenCalledWith(expect.objectContaining({ opStatus: 'settled' }));
    expect(store.rows.get('j1').cleanup_done).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/web-shell && npx vitest run lib/canonical/job-service.advance.test.js`
Expected: FAIL — `advanceCanonicalJob is not a function` / `does not provide an export named`.

- [ ] **Step 3: Write minimal implementation**

Acrescentar aos imports do topo de `lib/canonical/job-service.js`:

```js
import { randomUUID } from 'node:crypto';
import { createConfiguredBundleStore } from '../native-clone/bundle-store.js';
import { registerNativeBundle } from '../native-clone/register-bundle.js';
import { persistNativeBundleDescriptor } from '../motion-editor/edit-session-store.js';
import { PCT, parseProgressLog, pctFromVm } from './progress.js';
import { EXIT_MEANING, SANDBOX_TIMEOUT_MS, VM, createSandboxRunner, parseExitFile, sandboxNameFor } from './sandbox-runner.js';
import { chunkBySize, loadCapturePayload, loadCodePayload, loadNativeDescriptor } from './payload.js';
import { canonicalProducerOutput, readTarGz } from './output-bundle.js';
import { publishCanonical } from './publish.js';
```

Acrescentar ao fim do arquivo:

```js
// A trava dura MAIS que o tempo máximo da rota (maxDuration = 300 s): ela nunca vence enquanto a requisição dona
// ainda pode estar rodando. E toda escrita cercada que volta vazia = trava perdida → a requisição PARA (sem
// efeito externo: nem iniciar, nem desligar, nem cobrar).
export const LEASE_SECS = 330;
const LEASE_LOST = 'lease_lost';
const KNOWN_FAILURES = new Set(['capture_failed', 'sandbox_unavailable', 'recording_failed', 'timeout', 'publish_conflict', 'internal']);

function failure(code, detail) {
  return Object.assign(new Error(code), { code, detail });
}
function must(row) {
  if (!row) throw failure(LEASE_LOST);
  return row;
}
const text = (buf) => (buf ? Buffer.from(buf).toString('utf8') : '');

export function createCanonicalDeps(overrides = {}) {
  return {
    jobStore,
    runner: createSandboxRunner(),
    bundleStore: createConfiguredBundleStore(),
    loadCodePayload,
    loadCapturePayload,
    loadNativeDescriptor,
    readTarGz,
    registerNativeBundle,
    persistNativeBundleDescriptor,
    publishCanonical,
    settleOperation,
    newOwner: () => randomUUID(),
    ...overrides,
  };
}

function view(job) {
  const result = readyResult(job);
  return { job: publicCanonicalJobView(job), ...(result ? { result } : {}) };
}

async function settleJob({ sql, job, deps }) {
  if (!job.op_id) return;
  const ok = job.status === 'ready';
  const price = estimateOp(CANONICAL_OP);
  // settleOperation é cercado (só mexe em operação 'in_flight'): repetir é inofensivo.
  await deps.settleOperation({
    sql, userId: job.user_id, opId: job.op_id, op: CANONICAL_OP, boardId: job.board_id, nodeId: job.node_id,
    holdCredits: price, chargeCredits: ok ? price : 0, opStatus: ok ? 'settled' : 'failed',
    ...(ok ? { result: { snapshotId: job.result_snapshot_id } } : {}),
  });
}

// Limpeza de tarefa TERMINADA: encerrar a cobrança e desligar a máquina. Só marca `cleanup_done` quando as duas
// confirmam; se algo falhar, a varredura do cron repete (cada passo é idempotente).
// Máquina AUSENTE só prova "desligada" depois do prazo dela: uma criação que uma requisição morta deixou no ar
// ainda pode terminar e fazer a máquina nascer depois desta limpeza. Passado o prazo da própria máquina (30 min),
// ela não pode estar viva — aí a ausência fecha a limpeza.
const ABSENCE_PROOF_MS = SANDBOX_TIMEOUT_MS + 60_000;
async function finishCleanup({ sql, job, deps }) {
  try {
    await settleJob({ sql, job, deps });
    if (job.sandbox_name) {
      const found = await deps.runner.stop(job.sandbox_name);
      if (found === 'absent' && Date.now() - new Date(job.created_at).getTime() < ABSENCE_PROOF_MS) return false;
    }
    await deps.jobStore.markCleanupDone({ sql, jobId: job.id });
    return true;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[canonical] cleanup pending', job.id, error?.code || error?.message);
    return false;
  }
}

// Falha lê a linha ATUAL (um erro depois de uma transição não pode ficar preso na geração velha). Se a transição
// não for NOSSA (trava perdida), não toca em nada — o novo dono cuida da máquina e da cobrança.
async function failJob({ sql, job, owner, deps, code, detail }) {
  const store = deps.jobStore;
  const current = (await store.getOwnedJob({ sql, userId: job.user_id, jobId: job.id })) || job;
  if (store.TERMINAL.has(current.status)) return current;
  const moved = await store.moveJob({
    sql, jobId: job.id, owner, generation: current.generation, from: current.status, to: 'failed',
    patch: { error_code: code, error_detail: detail ? String(detail).slice(0, 500) : null },
  });
  if (!moved) return current;
  await finishCleanup({ sql, job: moved, deps });
  return moved;
}

async function retryOrFail({ sql, job, owner, deps, reason }) {
  if (job.attempt < 2) {
    const restarted = must(await deps.jobStore.restartJob({ sql, jobId: job.id, owner, generation: job.generation, from: job.status }));
    // a máquina velha só sai DEPOIS que o recomeço é nosso
    await deps.runner.stop(job.sandbox_name).catch(() => {});
    return restarted;
  }
  throw failure('sandbox_unavailable', reason);
}

async function provision({ sql, job, owner, deps }) {
  const store = deps.jobStore;
  let sandbox;
  try { sandbox = await deps.runner.ensure(job.sandbox_name); } catch (e) { throw failure('sandbox_unavailable', e?.message); }
  // A máquina é a verdade: o script escreve `iniciado` logo depois de pegar a trava dele. Se já está lá, uma
  // requisição anterior iniciou e morreu antes de gravar o estado — não reescrever, não iniciar de novo.
  if (await deps.runner.readFile(sandbox, VM.started)) {
    return must(await store.moveJob({ sql, jobId: job.id, owner, generation: job.generation, from: 'provisioning', to: 'recording', patch: { stage: 'started', progress_pct: PCT.started } }));
  }
  let current = must(await store.noteJob({ sql, jobId: job.id, owner, generation: job.generation, patch: { stage: 'created', progress_pct: PCT.created } }));
  const nativeDescriptor = await deps.loadNativeDescriptor({ sql, bundleId: job.native_bundle_id });
  const files = [...await deps.loadCodePayload(), ...await deps.loadCapturePayload({ store: deps.bundleStore, descriptor: nativeDescriptor })];
  for (const lote of chunkBySize(files)) await deps.runner.writeFiles(sandbox, lote);
  current = must(await store.noteJob({ sql, jobId: job.id, owner, generation: current.generation, patch: { stage: 'files', progress_pct: PCT.files } }));
  const commandId = await deps.runner.start(sandbox);
  return must(await store.moveJob({
    sql, jobId: job.id, owner, generation: current.generation, from: 'provisioning', to: 'recording',
    patch: { command_id: commandId, stage: 'started', progress_pct: PCT.started },
  }));
}

async function packageAndPublish({ sql, job, owner, deps }) {
  const sandbox = await deps.runner.find(job.sandbox_name);
  if (!deps.runner.isAlive(sandbox)) return retryOrFail({ sql, job, owner, deps, reason: 'sandbox gone before packaging' });
  const archive = await deps.runner.readFile(sandbox, VM.archive);
  if (!archive) throw failure('recording_failed', 'archive_missing');
  const files = await deps.readTarGz(archive);
  const nativeDescriptor = await deps.loadNativeDescriptor({ sql, bundleId: job.native_bundle_id });
  const output = canonicalProducerOutput({ files, nativeDescriptor });
  const descriptor = await deps.registerNativeBundle(output, { store: deps.bundleStore });
  await deps.persistNativeBundleDescriptor({ sql, descriptor });
  const html = text(files.find((f) => f.path === 'index.html').body);
  const { snapshotId } = await deps.publishCanonical({ sql, job, owner, descriptor, html });
  const ready = {
    ...job, status: 'ready', generation: job.generation + 1, progress_pct: 100,
    result_bundle_id: descriptor.bundleId, result_snapshot_id: snapshotId, lease_owner: null,
  };
  await finishCleanup({ sql, job: ready, deps });
  return ready;
}

async function record({ sql, job, owner, deps }) {
  const store = deps.jobStore;
  const sandbox = await deps.runner.find(job.sandbox_name);
  if (!deps.runner.isAlive(sandbox)) return retryOrFail({ sql, job, owner, deps, reason: `sandbox ${sandbox ? sandbox.status : 'missing'}` });
  const exitCode = parseExitFile(text(await deps.runner.readFile(sandbox, VM.done)));
  if (exitCode == null) {
    const pct = pctFromVm(parseProgressLog(text(await deps.runner.readFile(sandbox, VM.progress))));
    if (pct == null) return job;
    return must(await store.noteJob({ sql, jobId: job.id, owner, generation: job.generation, patch: { stage: 'recording', progress_pct: pct } }));
  }
  if (exitCode === 0) {
    const moved = must(await store.moveJob({ sql, jobId: job.id, owner, generation: job.generation, from: 'recording', to: 'packaging', patch: { stage: 'packaging', progress_pct: PCT.packaging } }));
    return packageAndPublish({ sql, job: moved, owner, deps });
  }
  const tail = text(await deps.runner.readFile(sandbox, VM.errors).catch(() => null));
  throw failure('recording_failed', `exit ${exitCode} (${EXIT_MEANING[exitCode] || 'unknown'}) ${tail.slice(-400)}`);
}

async function step({ sql, job, owner, deps }) {
  if (new Date(job.deadline_at).getTime() < Date.now()) throw failure('timeout', 'deadline');
  if (job.status === 'queued') {
    const moved = must(await deps.jobStore.moveJob({
      sql, jobId: job.id, owner, generation: job.generation, from: 'queued', to: 'provisioning',
      patch: { sandbox_name: sandboxNameFor(job.id, job.attempt), stage: 'creating' },
    }));
    return provision({ sql, job: moved, owner, deps });
  }
  if (job.status === 'provisioning') return provision({ sql, job, owner, deps });
  if (job.status === 'recording') return record({ sql, job, owner, deps });
  if (job.status === 'packaging') return packageAndPublish({ sql, job, owner, deps });
  return job;
}

export async function advanceCanonicalJob({ sql, userId, jobId, deps: given }) {
  const deps = given || createCanonicalDeps();
  const store = deps.jobStore;
  const job = await store.getOwnedJob({ sql, userId, jobId });
  if (!job) return { error: { code: 'not_found', status: 404 } };
  if (store.TERMINAL.has(job.status)) return view(job);
  const owner = deps.newOwner();
  const leased = await store.acquireLease({ sql, jobId, owner, ttlSecs: LEASE_SECS });
  if (!leased) return view(job); // outra requisição está trabalhando nesta tarefa
  let current = leased;
  try {
    current = await step({ sql, job: leased, owner, deps });
  } catch (error) {
    if (error?.code === LEASE_LOST) {
      current = (await store.getOwnedJob({ sql, userId, jobId })) || leased;
    } else {
      const code = KNOWN_FAILURES.has(error?.code) ? error.code : 'internal';
      current = await failJob({ sql, job: leased, owner, deps, code, detail: error?.detail || error?.message });
    }
  } finally {
    await store.releaseLease({ sql, jobId, owner }).catch(() => {});
  }
  return view(current);
}

export async function sweepCanonicalJobs({ sql, deps: given, limit = 50 }) {
  const deps = given || createCanonicalDeps();
  const overdue = await deps.jobStore.listOverdueJobs({ sql, limit });
  let failed = 0;
  for (const job of overdue) {
    if (await deps.jobStore.failOverdueJob({ sql, jobId: job.id, generation: job.generation, from: job.status })) failed += 1;
  }
  // Inclui as que acabaram de falhar acima e as terminadas cuja limpeza não confirmou.
  const pending = await deps.jobStore.listCleanupPending({ sql, limit });
  let cleaned = 0;
  for (const job of pending) if (await finishCleanup({ sql, job, deps })) cleaned += 1;
  return { scanned: overdue.length, failed, cleaned };
}
```

Nota: o armazém em memória do teste traz `ACTIVE`/`TERMINAL`; o módulo real `job-store.js` os exporta (Task 4),
então `deps.jobStore.TERMINAL` funciona nos dois. A rota de avançar tem `maxDuration = 300` (Task 8); se alguém
subir esse número, `LEASE_SECS` tem que continuar maior que ele.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/web-shell && npx vitest run lib/canonical/`
Expected: PASS em todos os arquivos de `lib/canonical/` (21 testes novos aqui).

- [ ] **Step 5: Commit**

```bash
git add packages/web-shell/lib/canonical/job-service.js packages/web-shell/lib/canonical/job-service.advance.test.js
git commit -m "feat(canonical): advance the job one short fenced step per poll; sweep overdue jobs"
```

---

### Task 8: Rotas, varredura no cron e scripts no pacote da função

**Files:**
- Create: `packages/web-shell/app/api/nodes/[id]/canonical-job/route.js`
- Create: `packages/web-shell/app/api/canonical-jobs/[id]/advance/route.js`
- Modify: `packages/web-shell/app/api/cron/reconcile-holds/route.js` (depois do bloco do challenge)
- Modify: `packages/web-shell/next.config.js` (ao lado de `outputFileTracingRoot`)
- Test: `packages/web-shell/app/api/canonical-jobs/routes.test.js`

**Interfaces:**
- Consumes: `canonicalEditEnabled`, `startCanonicalJob`, `advanceCanonicalJob`, `publicCanonicalJobView`,
  `sweepCanonicalJobs` (Tasks 6-7).
- Produces: `POST /api/nodes/:id/canonical-job` (header `idempotency-key`) → `{ job }`;
  `POST /api/canonical-jobs/:id/advance` → `{ job, result? }`; ambas `Cache-Control: no-store`; interruptor
  desligado → 404 `{ error: 'canonical_disabled' }`.

- [ ] **Step 1: Write the failing test**

```js
// packages/web-shell/app/api/canonical-jobs/routes.test.js
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../../lib/auth.js', () => ({ requireUser: vi.fn(async () => ({ user: { id: 42, plan: 'pro' } })) }));
const sqlMock = vi.fn(async () => []);
vi.mock('../../../lib/db.js', () => ({ db: vi.fn(async () => sqlMock) }));
vi.mock('../../../lib/canonical/job-service.js', () => ({
  canonicalEditEnabled: vi.fn(() => true),
  startCanonicalJob: vi.fn(),
  advanceCanonicalJob: vi.fn(),
  publicCanonicalJobView: (j) => ({ id: j.id, status: j.status }),
}));
const svc = await import('../../../lib/canonical/job-service.js');
const { POST: start } = await import('../nodes/[id]/canonical-job/route.js');
const { POST: advance } = await import('./[id]/advance/route.js');

const req = (url, { ticket = 'ticket-1' } = {}) => new Request(url, { method: 'POST', headers: ticket ? { 'idempotency-key': ticket } : {} });
const P = (id) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  svc.canonicalEditEnabled.mockReturnValue(true);
  sqlMock.mockResolvedValue([{ id: 'n1', board_id: 'b1', current_snapshot_id: 's1', current_snapshot_source: 'native-bundle', current_native_bundle_id: 'nb1' }]);
});
afterEach(() => vi.clearAllMocks());

describe('rotas da cópia editável', () => {
  it('interruptor desligado: 404 sem tocar o banco', async () => {
    svc.canonicalEditEnabled.mockReturnValue(false);
    const r1 = await start(req('http://t/api/nodes/n1/canonical-job'), P('n1'));
    const r2 = await advance(req('http://t/api/canonical-jobs/j1/advance'), P('j1'));
    expect(r1.status).toBe(404); expect(r2.status).toBe(404);
    expect((await r1.json()).error).toBe('canonical_disabled');
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('iniciar exige a etiqueta de idempotência', async () => {
    const res = await start(req('http://t/api/nodes/n1/canonical-job', { ticket: '' }), P('n1'));
    expect(res.status).toBe(400);
    expect(svc.startCanonicalJob).not.toHaveBeenCalled();
  });

  it('iniciar passa o node do dono e devolve a visão pública', async () => {
    svc.startCanonicalJob.mockResolvedValue({ job: { id: 'j1', status: 'queued' } });
    const res = await start(req('http://t/api/nodes/n1/canonical-job'), P('n1'));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ job: { id: 'j1', status: 'queued' } });
    expect(svc.startCanonicalJob).toHaveBeenCalledWith(expect.objectContaining({ userId: 42, idemKey: 'ticket-1', node: expect.objectContaining({ id: 'n1' }) }));
  });

  it('node de outro dono: 404', async () => {
    sqlMock.mockResolvedValue([]);
    const res = await start(req('http://t/api/nodes/n1/canonical-job'), P('n1'));
    expect(res.status).toBe(404);
  });

  it('erro tipado do serviço vira status', async () => {
    svc.startCanonicalJob.mockResolvedValue({ error: { code: 'canonical_not_applicable', status: 409 } });
    const res = await start(req('http://t/api/nodes/n1/canonical-job'), P('n1'));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'canonical_not_applicable' });
  });

  it('avançar devolve tarefa e resultado, no-store', async () => {
    svc.advanceCanonicalJob.mockResolvedValue({ job: { id: 'j1', status: 'ready' }, result: { snapshotId: 's2' } });
    const res = await advance(req('http://t/api/canonical-jobs/j1/advance'), P('j1'));
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ job: { id: 'j1', status: 'ready' }, result: { snapshotId: 's2' } });
    expect(svc.advanceCanonicalJob).toHaveBeenCalledWith(expect.objectContaining({ userId: 42, jobId: 'j1' }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/web-shell && npx vitest run app/api/canonical-jobs/routes.test.js`
Expected: FAIL — as rotas não resolvem.

- [ ] **Step 3: Write minimal implementation**

```js
// packages/web-shell/app/api/nodes/[id]/canonical-job/route.js
import { NextResponse } from 'next/server';
import { requireUser } from '../../../../../lib/auth.js';
import { db } from '../../../../../lib/db.js';
import { canonicalEditEnabled, publicCanonicalJobView, startCanonicalJob } from '../../../../../lib/canonical/job-service.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;
const NO_STORE = { 'Cache-Control': 'no-store' };

export async function POST(request, { params }) {
  if (!canonicalEditEnabled()) return NextResponse.json({ error: 'canonical_disabled' }, { status: 404, headers: NO_STORE });
  const { user, error } = await requireUser(request);
  if (error) return error;
  const idemKey = request.headers.get('idempotency-key');
  if (!idemKey || !idemKey.trim()) return NextResponse.json({ error: 'idempotency_key_required' }, { status: 400, headers: NO_STORE });
  const { id } = await params;
  const sql = await db();
  const rows = await sql`
    SELECT n.id, n.kind, n.board_id, n.current_snapshot_id,
           s.source AS current_snapshot_source, s.native_bundle_id AS current_native_bundle_id
      FROM nodes n
      JOIN boards b ON b.id = n.board_id
      LEFT JOIN snapshots s ON s.id = n.current_snapshot_id
     WHERE n.id = ${id} AND b.user_id = ${user.id}`;
  const node = rows[0];
  if (!node) return NextResponse.json({ error: 'not_found' }, { status: 404, headers: NO_STORE });
  const out = await startCanonicalJob({ sql, userId: user.id, node, idemKey: idemKey.trim() });
  if (out.error) {
    const { code, status, ...rest } = out.error;
    return NextResponse.json({ error: code, ...rest }, { status, headers: NO_STORE });
  }
  return NextResponse.json({ job: publicCanonicalJobView(out.job) }, { headers: NO_STORE });
}
```

```js
// packages/web-shell/app/api/canonical-jobs/[id]/advance/route.js
import { NextResponse } from 'next/server';
import { requireUser } from '../../../../../lib/auth.js';
import { db } from '../../../../../lib/db.js';
import { advanceCanonicalJob, canonicalEditEnabled } from '../../../../../lib/canonical/job-service.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// Um passo pode escrever a captura na máquina (dezenas de MB) ou registrar a cópia: cabe com folga em 300 s.
export const maxDuration = 300;
const NO_STORE = { 'Cache-Control': 'no-store' };

export async function POST(request, { params }) {
  if (!canonicalEditEnabled()) return NextResponse.json({ error: 'canonical_disabled' }, { status: 404, headers: NO_STORE });
  const { user, error } = await requireUser(request);
  if (error) return error;
  const { id } = await params;
  const sql = await db();
  const out = await advanceCanonicalJob({ sql, userId: user.id, jobId: id });
  if (out.error) {
    const { code, status } = out.error;
    return NextResponse.json({ error: code }, { status, headers: NO_STORE });
  }
  return NextResponse.json(out, { headers: NO_STORE });
}
```

Em `app/api/cron/reconcile-holds/route.js`, logo depois do `catch` do bloco do challenge (antes do `return NextResponse.json({ ok: true, ...`):

```js
    // Preparações da cópia editável vencidas (spec 2026-10-09 §4.1): desliga a máquina, marca 'failed',
    // devolve a reserva. Best-effort, como o challenge.
    let canonicalJobsFailed = 0;
    try {
      const { sweepCanonicalJobs } = await import('../../../../lib/canonical/job-service.js');
      const swept = await sweepCanonicalJobs({ sql });
      canonicalJobsFailed = swept.failed;
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[reconcile-holds] canonical sweep failed:', e?.code || e?.message);
    }
```

e trocar o `return` de sucesso por:

```js
    return NextResponse.json({ ok: true, ...summary, challengeJobsExpired, canonicalJobsFailed, ttlSecs: RECONCILE_TTL_SECS });
```

Em `next.config.js`, logo abaixo de `outputFileTracingRoot: ...,`:

```js
  // A preparação da cópia (spec 2026-10-09) LÊ estes arquivos do disco para mandá-los à máquina descartável —
  // leitura dinâmica que o rastreio do Next não enxerga sozinho.
  outputFileTracingIncludes: {
    '/api/canonical-jobs/[id]/advance': ['./scripts/*.mjs', './lib/motion-program/uncraft-motion.js'],
  },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/web-shell && npx vitest run app/api/canonical-jobs/routes.test.js next.config.test.js app/api/cron`
Expected: PASS (o `next.config.test.js` existente continua verde — as rotas novas não servem o runtime).

- [ ] **Step 5: Commit**

```bash
git add packages/web-shell/app/api/nodes/[id]/canonical-job/route.js packages/web-shell/app/api/canonical-jobs \
  packages/web-shell/app/api/cron/reconcile-holds/route.js packages/web-shell/next.config.js
git commit -m "feat(canonical): start/advance routes behind a server flag; sweep overdue jobs in cron"
```

---

### Task 9: Cliente — chamadas e consulta sem sobreposição

**Files:**
- Modify: `packages/web-shell/lib/canvas-api.js` (logo depois de `reconstructNode`, linhas ~193-197)
- Create: `packages/web-shell/lib/canonical/poller.js`
- Test: `packages/web-shell/lib/canonical/poller.test.js`

**Interfaces:**
- Produces: `api.startCanonicalJob(nodeId)` → `{ job }`; `api.advanceCanonicalJob(jobId)` → `{ job, result? }`;
  `createCanonicalPoller({ advance, intervalMs=2000, maxErrors=5, schedule, cancel, onUpdate })` →
  `{ run(jobId) → Promise<{ok:true, job, result} | {ok:false, code, job?}>, stop() }`.

- [ ] **Step 1: Write the failing test**

```js
// packages/web-shell/lib/canonical/poller.test.js
import { describe, expect, it, vi } from 'vitest';
import { createCanonicalPoller } from './poller.js';

// agenda imediata: cada "espera" vira a próxima volta do laço de microtarefas
const immediate = { schedule: (fn) => { Promise.resolve().then(fn); return 1; }, cancel: () => {} };

describe('consulta da preparação', () => {
  it('consulta até ficar pronta e devolve o resultado', async () => {
    const advance = vi.fn()
      .mockResolvedValueOnce({ job: { id: 'j', status: 'recording', progressPct: 30 } })
      .mockResolvedValueOnce({ job: { id: 'j', status: 'ready', progressPct: 100 }, result: { snapshotId: 's2' } });
    const onUpdate = vi.fn();
    const out = await createCanonicalPoller({ advance, onUpdate, ...immediate }).run('j');
    expect(out).toMatchObject({ ok: true, result: { snapshotId: 's2' } });
    expect(onUpdate).toHaveBeenCalledTimes(2);
    expect(advance).toHaveBeenCalledTimes(2);
  });

  it('falha da tarefa devolve o código', async () => {
    const advance = vi.fn().mockResolvedValue({ job: { id: 'j', status: 'failed', errorCode: 'timeout' } });
    expect(await createCanonicalPoller({ advance, ...immediate }).run('j')).toMatchObject({ ok: false, code: 'timeout' });
  });

  it('nunca sobrepõe consultas: a próxima só sai depois da resposta', async () => {
    let emVoo = 0; let pico = 0;
    const advance = vi.fn(async () => {
      emVoo += 1; pico = Math.max(pico, emVoo);
      await new Promise((r) => setTimeout(r, 5));
      emVoo -= 1;
      return advance.mock.calls.length < 3 ? { job: { status: 'recording' } } : { job: { status: 'ready' }, result: {} };
    });
    await createCanonicalPoller({ advance, ...immediate }).run('j');
    expect(pico).toBe(1);
  });

  it('erro de rede passageiro continua; cinco seguidos desistem', async () => {
    const flaky = vi.fn()
      .mockRejectedValueOnce(new Error('net'))
      .mockResolvedValueOnce({ job: { status: 'ready' }, result: { snapshotId: 's' } });
    expect((await createCanonicalPoller({ advance: flaky, ...immediate }).run('j')).ok).toBe(true);
    const dead = vi.fn().mockRejectedValue(Object.assign(new Error('net'), { code: 'internal' }));
    expect(await createCanonicalPoller({ advance: dead, ...immediate }).run('j')).toMatchObject({ ok: false, code: 'internal' });
    expect(dead).toHaveBeenCalledTimes(5);
  });

  it('stop no meio de uma consulta PENDENTE: cancela sem erro e não consulta de novo', async () => {
    let soltar;
    const advance = vi.fn(() => new Promise((r) => { soltar = r; }));
    const poller = createCanonicalPoller({ advance, ...immediate });
    const promessa = poller.run('j');
    poller.stop();
    expect(await promessa).toMatchObject({ ok: false, code: 'cancelled' });
    soltar({ job: { status: 'recording' } });
    await new Promise((r) => setTimeout(r, 10));
    expect(advance).toHaveBeenCalledTimes(1);
  });

  it('stop encerra como cancelado', async () => {
    const advance = vi.fn().mockResolvedValue({ job: { status: 'recording' } });
    const poller = createCanonicalPoller({ advance, schedule: (fn) => setTimeout(fn, 1), cancel: clearTimeout });
    const promessa = poller.run('j');
    await new Promise((r) => setTimeout(r, 0));
    poller.stop();
    expect(await promessa).toMatchObject({ ok: false, code: 'cancelled' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/web-shell && npx vitest run lib/canonical/poller.test.js`
Expected: FAIL — `./poller.js` não resolve.

- [ ] **Step 3: Write minimal implementation**

```js
// packages/web-shell/lib/canonical/poller.js
// Consulta da preparação (spec 2026-10-09 §4): uma por vez — a próxima só sai depois da resposta, porque cada
// consulta pode ser o passo que trabalha (até minutos). Erro de rede passageiro continua; cinco seguidos desistem.
// A conclusão de cada execução é idempotente: `stop()` no meio de uma consulta pendente resolve como cancelado e a
// resposta que chegar depois é ignorada.
export function createCanonicalPoller({
  advance,
  intervalMs = 2000,
  maxErrors = 5,
  schedule = (fn, ms) => setTimeout(fn, ms),
  cancel = (t) => clearTimeout(t),
  onUpdate = () => {},
}) {
  let timer = null;
  let active = null; // conclusão da execução corrente

  function clearTimer() {
    if (timer != null) cancel(timer);
    timer = null;
  }

  function stop() {
    clearTimer();
    if (active) active({ ok: false, code: 'cancelled' });
  }

  function run(jobId) {
    let errors = 0;
    return new Promise((resolve) => {
      let done = false;
      const finish = (value) => {
        if (done) return;
        done = true;
        if (active === finish) active = null;
        clearTimer();
        resolve(value);
      };
      active = finish;
      const tick = async () => {
        timer = null;
        if (done) return;
        let out;
        try {
          out = await advance(jobId);
          errors = 0;
        } catch (e) {
          if (done) return;
          errors += 1;
          if (errors >= maxErrors || e?.code === 'not_found') { finish({ ok: false, code: e?.code || 'internal' }); return; }
          timer = schedule(tick, intervalMs);
          return;
        }
        if (done) return;
        const job = out?.job;
        if (job) onUpdate(job);
        if (job?.status === 'ready' && out.result) { finish({ ok: true, job, result: out.result }); return; }
        if (job?.status === 'failed') { finish({ ok: false, code: job.errorCode || 'internal', job }); return; }
        timer = schedule(tick, intervalMs);
      };
      tick();
    });
  }

  return { run, stop };
}
```

Em `lib/canvas-api.js`, logo depois da entrada `reconstructNode: ...`:

```js
  // Cópia editável no Edit (spec 2026-10-09). Iniciar leva etiqueta (reenvio não cria segunda tarefa);
  // avançar é idempotente por construção (cada consulta só faz o passo da vez).
  startCanonicalJob: (nodeId) => withTicket(`canonical:${nodeId}`, (ticket) =>
    fetch(`/api/nodes/${nodeId}/canonical-job`, withIdemHeader({ ...COMMON, method: 'POST' }, ticket)).then(jsonOrThrow)),
  advanceCanonicalJob: (jobId) =>
    fetch(`/api/canonical-jobs/${jobId}/advance`, { ...COMMON, method: 'POST' }).then(jsonOrThrow),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/web-shell && npx vitest run lib/canonical/poller.test.js lib/canvas-api.test.js`
Expected: PASS (se `canvas-api.test.js` não existir, só o do poller roda — conferir que ele aparece na saída).

- [ ] **Step 5: Commit**

```bash
git add packages/web-shell/lib/canonical/poller.js packages/web-shell/lib/canonical/poller.test.js packages/web-shell/lib/canvas-api.js
git commit -m "feat(canonical): client calls and a non-overlapping poller"
```

---

### Task 10: Estado da preparação por node (hook)

**Files:**
- Create: `packages/web-shell/components/useCanonicalPrep.js`
- Test: `packages/web-shell/components/useCanonicalPrep.test.jsx`

**Interfaces:**
- Consumes: `createCanonicalPoller` (Task 9), `capturePhasePct`, `monotonicPct` (Task 2).
- Produces: `useCanonicalPrep({ api })` → `{ prep: Map<nodeId, {status:'running'|'failed', pct:number, errorCode}>,
  run(nodeId, { capture?: () => Promise<void> }) → Promise<{ok, result?, code?}>, dismiss(nodeId) }`.
  `run` relança erros de `capture()` e de `api.startCanonicalJob` (o chamador trata desafio de bot e cobrança).

- [ ] **Step 1: Write the failing test**

```jsx
// packages/web-shell/components/useCanonicalPrep.test.jsx
import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useCanonicalPrep } from './useCanonicalPrep.js';

describe('useCanonicalPrep', () => {
  it('sem captura começa em 10, sobe com a tarefa e termina pronta', async () => {
    const api = {
      startCanonicalJob: vi.fn(async () => ({ job: { id: 'j1', status: 'queued', progressPct: 10 } })),
      advanceCanonicalJob: vi.fn(async () => ({ job: { id: 'j1', status: 'ready', progressPct: 100 }, result: { snapshotId: 's2' } })),
    };
    const { result } = renderHook(() => useCanonicalPrep({ api }));
    let outcome;
    await act(async () => { outcome = await result.current.run('n1'); });
    expect(outcome).toMatchObject({ ok: true, result: { snapshotId: 's2' } });
    expect(result.current.prep.get('n1')).toMatchObject({ status: 'running', pct: 100 });
    act(() => result.current.dismiss('n1'));
    expect(result.current.prep.has('n1')).toBe(false);
  });

  it('falha fica no node com o código, para as duas escolhas', async () => {
    const api = {
      startCanonicalJob: vi.fn(async () => ({ job: { id: 'j1', status: 'queued', progressPct: 10 } })),
      advanceCanonicalJob: vi.fn(async () => ({ job: { id: 'j1', status: 'failed', progressPct: 57, errorCode: 'recording_failed' } })),
    };
    const { result } = renderHook(() => useCanonicalPrep({ api }));
    await act(async () => { await result.current.run('n1'); });
    expect(result.current.prep.get('n1')).toMatchObject({ status: 'failed', errorCode: 'recording_failed', pct: 57 });
  });

  it('o número nunca volta, mesmo se a tarefa relatar menos', async () => {
    const api = {
      startCanonicalJob: vi.fn(async () => ({ job: { id: 'j1', status: 'recording', progressPct: 68 } })),
      advanceCanonicalJob: vi.fn()
        .mockResolvedValueOnce({ job: { id: 'j1', status: 'recording', progressPct: 57 } })
        .mockResolvedValueOnce({ job: { id: 'j1', status: 'failed', progressPct: 57, errorCode: 'timeout' } }),
    };
    const { result } = renderHook(() => useCanonicalPrep({ api }));
    await act(async () => { await result.current.run('n1'); });
    expect(result.current.prep.get('n1').pct).toBe(68);
  });

  it('erro da captura sobe para o chamador e não deixa estado no node', async () => {
    const api = { startCanonicalJob: vi.fn(), advanceCanonicalJob: vi.fn() };
    const { result } = renderHook(() => useCanonicalPrep({ api }));
    const erro = Object.assign(new Error('challenge'), { challenge: { url: 'https://x' } });
    await act(async () => {
      await expect(result.current.run('n1', { capture: async () => { throw erro; } })).rejects.toBe(erro);
    });
    expect(result.current.prep.has('n1')).toBe(false);
    expect(api.startCanonicalJob).not.toHaveBeenCalled();
  });
});
```

(O poller usa `setTimeout` real de 2 s entre consultas; nestes testes cada tarefa termina na 1ª ou 2ª consulta. Se o
tempo do teste incomodar, envolver o teste do "nunca volta" com `vi.useFakeTimers({ shouldAdvanceTime: true })`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/web-shell && npx vitest run components/useCanonicalPrep.test.jsx`
Expected: FAIL — `./useCanonicalPrep.js` não resolve.

- [ ] **Step 3: Write minimal implementation**

```js
// packages/web-shell/components/useCanonicalPrep.js
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createCanonicalPoller } from '../lib/canonical/poller.js';
import { capturePhasePct, monotonicPct } from '../lib/canonical/progress.js';

// Estado da preparação da cópia por node (spec 2026-10-09 §0/§4.3): o número que o node mostra e, em falha,
// o código para as duas escolhas. O número nunca volta.
export function useCanonicalPrep({ api }) {
  const [prep, setPrep] = useState(() => new Map());
  const pollers = useRef(new Map());

  const patch = useCallback((nodeId, next) => {
    setPrep((prev) => {
      const map = new Map(prev);
      if (next == null) { map.delete(nodeId); return map; }
      const cur = map.get(nodeId);
      map.set(nodeId, { ...cur, ...next, pct: monotonicPct(cur?.pct, next.pct ?? cur?.pct) });
      return map;
    });
  }, []);

  useEffect(() => () => { for (const p of pollers.current.values()) p.stop(); }, []);

  const run = useCallback(async (nodeId, { capture = null } = {}) => {
    patch(nodeId, { status: 'running', pct: capture ? 0 : 10, errorCode: null });
    try {
      if (capture) {
        const t0 = Date.now();
        const tick = setInterval(() => patch(nodeId, { pct: capturePhasePct(Date.now() - t0) }), 500);
        try { await capture(); } finally { clearInterval(tick); }
        patch(nodeId, { pct: 10 });
      }
      const started = await api.startCanonicalJob(nodeId);
      patch(nodeId, { pct: started?.job?.progressPct });
      const poller = createCanonicalPoller({
        advance: api.advanceCanonicalJob,
        onUpdate: (job) => patch(nodeId, { pct: job.progressPct }),
      });
      pollers.current.set(nodeId, poller);
      try {
        const outcome = await poller.run(started.job.id);
        if (!outcome.ok && outcome.code !== 'cancelled') patch(nodeId, { status: 'failed', errorCode: outcome.code });
        return outcome;
      } finally {
        pollers.current.delete(nodeId);
      }
    } catch (error) {
      patch(nodeId, null);
      throw error;
    }
  }, [api, patch]);

  const dismiss = useCallback((nodeId) => {
    pollers.current.get(nodeId)?.stop();
    patch(nodeId, null);
  }, [patch]);

  return { prep, run, dismiss };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/web-shell && npx vitest run components/useCanonicalPrep.test.jsx`
Expected: PASS (4 testes).

- [ ] **Step 5: Commit**

```bash
git add packages/web-shell/components/useCanonicalPrep.js packages/web-shell/components/useCanonicalPrep.test.jsx
git commit -m "feat(canonical): per-node preparation state that never goes back"
```

---

### Task 11: O que o node mostra (borrado + número + anel + falha com escolha)

**Files:**
- Create: `packages/web-shell/lib/canonical/error-copy.js`
- Create: `packages/web-shell/components/CanonicalPrepOverlay.jsx`
- Modify: `packages/web-shell/components/CanvasNode.jsx` (props na assinatura ~378; `generating`/`ringFrame` ~1166-1181; classe da raiz ~1196; render logo depois do `<NodeProgressRing>` existente ~1225)
- Modify: `packages/web-shell/app/globals.css` (depois do bloco `.cnode-gen-overlay`, ~linha 5731)
- Test: `packages/web-shell/components/CanonicalPrepOverlay.test.jsx`, `packages/web-shell/components/CanvasNode.test.jsx`

**Interfaces:**
- Produces: `canonicalErrorCopy(code) → { title, detail }`; `<CanonicalPrepOverlay prep onRetry onOpenLive />`;
  `CanvasNode` aceita `canonicalPrep` (`{status, pct, errorCode}|null`), `onCanonicalRetry`, `onCanonicalOpenLive`.

- [ ] **Step 1: Write the failing tests**

```jsx
// packages/web-shell/components/CanonicalPrepOverlay.test.jsx
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import CanonicalPrepOverlay from './CanonicalPrepOverlay.jsx';
import { canonicalErrorCopy } from '../lib/canonical/error-copy.js';

describe('CanonicalPrepOverlay', () => {
  it('mostra o número grande como barra de progresso acessível', () => {
    render(<CanonicalPrepOverlay prep={{ status: 'running', pct: 57.4 }} />);
    const bar = screen.getByRole('progressbar', { name: 'Preparing editable copy' });
    expect(bar).toHaveAttribute('aria-valuenow', '57');
    expect(bar).toHaveTextContent('57%');
  });

  it('falha mostra o motivo e as duas escolhas, sem arrastar o node', () => {
    const onRetry = vi.fn(); const onOpenLive = vi.fn(); const onParentDown = vi.fn();
    render(<div onMouseDown={onParentDown}><CanonicalPrepOverlay prep={{ status: 'failed', errorCode: 'timeout' }} onRetry={onRetry} onOpenLive={onOpenLive} /></div>);
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't prepare the editable copy");
    expect(screen.getByRole('alert')).toHaveTextContent('This took longer than expected.');
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Try again' }));
    expect(onParentDown).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open live clone instead' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onOpenLive).toHaveBeenCalledTimes(1);
  });

  it('código desconhecido tem texto genérico; nada para mostrar sem estado', () => {
    expect(canonicalErrorCopy('qualquer').detail).toBe('Something went wrong while preparing it.');
    const { container } = render(<CanonicalPrepOverlay prep={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
```

Em `components/CanvasNode.test.jsx`, o mock de `./NodeProgressRing.jsx` passa a expor o `pct` (trocar o mock existente):

```jsx
vi.mock('./NodeProgressRing.jsx', () => ({
  NodeProgressRing: ({ pct }) => <div data-testid="progress-ring" data-pct={pct} />,
  useGenerationProgress: () => 0,
}));
```

e acrescentar ao `describe` existente:

```jsx
  it('preparando a cópia: node borrado, número e anel com a porcentagem real', () => {
    const { container } = renderNode({}, { editing: false, canonicalPrep: { status: 'running', pct: 42 } });
    expect(container.querySelector('.cnode.canonical-prep')).not.toBeNull();
    expect(screen.getByRole('progressbar', { name: 'Preparing editable copy' })).toHaveAttribute('aria-valuenow', '42');
    expect(screen.getByTestId('progress-ring')).toHaveAttribute('data-pct', '42');
  });

  it('falha da cópia: escolhas no node, sem anel', () => {
    const onCanonicalOpenLive = vi.fn();
    renderNode({}, { editing: false, canonicalPrep: { status: 'failed', pct: 57, errorCode: 'recording_failed' }, onCanonicalOpenLive });
    expect(screen.queryByTestId('progress-ring')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open live clone instead' }));
    expect(onCanonicalOpenLive).toHaveBeenCalledTimes(1);
  });
```

(`renderNode(overrides, props)` já repassa `props` para o `<CanvasNode>` — conferir no topo do arquivo; se o helper
não espalhar `{...props}`, acrescentar `{...props}` no JSX dele.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/web-shell && npx vitest run components/CanonicalPrepOverlay.test.jsx components/CanvasNode.test.jsx`
Expected: FAIL — overlay não resolve; os dois testes novos do CanvasNode falham (sem classe/sem progressbar).

- [ ] **Step 3: Write minimal implementation**

```js
// packages/web-shell/lib/canonical/error-copy.js
// Texto de produto (inglês) para cada falha tipada da preparação (spec 2026-10-09 §4.4).
const DETAIL = Object.freeze({
  capture_failed: "We couldn't read the captured page.",
  sandbox_unavailable: 'Our build machine is unavailable right now.',
  recording_failed: "We couldn't record this site's motion.",
  timeout: 'This took longer than expected.',
  publish_conflict: 'This node changed while the copy was being prepared.',
});

export function canonicalErrorCopy(code) {
  return { title: "Couldn't prepare the editable copy", detail: DETAIL[code] || 'Something went wrong while preparing it.' };
}
```

```jsx
// packages/web-shell/components/CanonicalPrepOverlay.jsx
'use client';

import { canonicalErrorCopy } from '../lib/canonical/error-copy.js';

// O que o node mostra enquanto a cópia editável é preparada (spec 2026-10-09 §0): número grande no centro sobre
// o site borrado (o borrado é a classe `.canonical-prep` na raiz do node); em falha, motivo + duas escolhas.
// Botões param o mousedown para não arrastar o node.
const stop = (e) => e.stopPropagation();

export default function CanonicalPrepOverlay({ prep, onRetry, onOpenLive }) {
  if (!prep) return null;
  if (prep.status === 'failed') {
    const copy = canonicalErrorCopy(prep.errorCode);
    return (
      <div className="cnode-canonical cnode-canonical-failed" role="alert">
        <strong className="cnode-canonical-title">{copy.title}</strong>
        <span className="cnode-canonical-detail">{copy.detail}</span>
        <div className="cnode-canonical-actions">
          <button type="button" className="popup-btn popup-btn-primary" onMouseDown={stop} onClick={(e) => { e.stopPropagation(); onRetry?.(); }}>
            Try again
          </button>
          <button type="button" className="popup-btn popup-btn-outline" onMouseDown={stop} onClick={(e) => { e.stopPropagation(); onOpenLive?.(); }}>
            Open live clone instead
          </button>
        </div>
      </div>
    );
  }
  const pct = Math.max(0, Math.min(100, Math.round(prep.pct || 0)));
  return (
    <div
      className="cnode-canonical"
      role="progressbar"
      aria-label="Preparing editable copy"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
    >
      <span className="cnode-canonical-pct">{pct}<span className="cnode-canonical-unit">%</span></span>
      <span className="cnode-canonical-label">Preparing editable copy</span>
    </div>
  );
}
```

Em `components/CanvasNode.jsx`:

1. Import no topo (junto dos outros componentes): `import CanonicalPrepOverlay from './CanonicalPrepOverlay.jsx';`
2. Na assinatura de `CanvasNode`, depois de `getRunFromHereEst`: `, canonicalPrep = null, onCanonicalRetry, onCanonicalOpenLive`
3. Trocar o bloco de `generating` + `genPct` + `ringFrame` por:

```jsx
  // Preparação da cópia editável (spec 2026-10-09): tem o PRÓPRIO número (real, da tarefa) e substitui o anel
  // estimado por tempo e a mensagem de carregamento.
  const canonicalActive = !!canonicalPrep;
  const canonicalRunning = canonicalPrep?.status === 'running';
  const generating = !canonicalActive && (
    (node._loading && !node._challenge && !node._failed) ||
    node.meta?.status === 'generating' ||
    !!runStatus);
  const genPct = useGenerationProgress(generating, estimatedDurationMs(node));
  const ringActive = generating || canonicalRunning;

  const [ringFrame, setRingFrame] = useState(null);
  useLayoutEffect(() => {
    if (!ringActive) { setRingFrame(null); return; }
    const el = cnodeRef.current;
    if (el) setRingFrame({ w: el.offsetWidth, h: el.offsetHeight });
  }, [ringActive, node.width, node.height]);
```

(manter os comentários originais acima de cada trecho.)

4. Na `className` da raiz, acrescentar ao fim do template: `${canonicalActive ? ' canonical-prep' : ''}`
5. Logo depois do `{generating && (<NodeProgressRing ... />)}` existente:

```jsx
      {canonicalActive && (
        <CanonicalPrepOverlay prep={canonicalPrep} onRetry={onCanonicalRetry} onOpenLive={onCanonicalOpenLive} />
      )}
      {canonicalRunning && (
        <NodeProgressRing
          pct={canonicalPrep.pct}
          width={ringFrame?.w || node.width}
          height={ringFrame?.h || node.height || Math.round(node.width * 9 / 16)}
        />
      )}
```

Em `app/globals.css`, depois do bloco de `.cnode-gen-overlay`:

```css
/* Cópia editável no Edit (spec 2026-10-09 §0): o site atual borrado no fundo, o número grande no centro e o
   contorno do node como barra. `filter` só no node que prepara — nunca backdrop-filter dentro do mundo
   zoomado (lição 148b). */
.cnode.canonical-prep .cnode-body { filter: blur(14px) saturate(0.85); }
.cnode-canonical {
  position: absolute;
  inset: 0;
  z-index: 2;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  background: rgba(10, 10, 10, 0.35);
  border-radius: inherit;
  pointer-events: none;
}
.cnode-canonical-pct {
  font-size: clamp(32px, calc(0.22 * var(--cnode-h)), 160px);
  font-weight: 300;
  line-height: 1;
  letter-spacing: -0.02em;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}
.cnode-canonical-unit { font-size: 0.45em; margin-left: 0.04em; color: var(--text-secondary); }
.cnode-canonical-label { font-size: calc(14px * var(--chrome-scale, 1)); color: var(--text-secondary); }
.cnode-canonical-failed { pointer-events: auto; background: rgba(10, 10, 10, 0.72); padding: 24px; text-align: center; }
.cnode-canonical-title { font-size: calc(16px * var(--chrome-scale, 1)); color: var(--text-primary); }
.cnode-canonical-detail { font-size: calc(13px * var(--chrome-scale, 1)); color: var(--text-secondary); }
.cnode-canonical-actions { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/web-shell && npx vitest run components/CanonicalPrepOverlay.test.jsx components/CanvasNode.test.jsx`
Expected: PASS (todos, incluindo os testes antigos do CanvasNode).

- [ ] **Step 5: Commit**

```bash
git add packages/web-shell/lib/canonical/error-copy.js packages/web-shell/components/CanonicalPrepOverlay.jsx \
  packages/web-shell/components/CanonicalPrepOverlay.test.jsx packages/web-shell/components/CanvasNode.jsx \
  packages/web-shell/components/CanvasNode.test.jsx packages/web-shell/app/globals.css
git commit -m "feat(canonical): node shows blurred site, big percentage and ring; failure with two choices"
```

---

### Task 12: Fiação do Edit no canvas

**Files:**
- Create: `packages/web-shell/lib/canonical/edit-entry.js`
- Test: `packages/web-shell/lib/canonical/edit-entry.test.js`
- Modify: `packages/web-shell/components/CanvasNodeItem.jsx` (props destruturadas e repassadas)
- Modify: `packages/web-shell/components/CanvasClient.jsx` (imports; perto de `const [nodes, setNodes]` linha 223;
  `handleEditingToggle` linha ~4661; `nodeHandlersRef.current` linha ~6238; render dos nodes linha ~6741)

**Interfaces:**
- Consumes: `EDIT_ROUTE` (`lib/edit-action-decision.js`), `useCanonicalPrep` (Task 10), props do `CanvasNode` (Task 11).
- Produces: `CANONICAL_ENTRY`, `canonicalEditClientEnabled(value)`, `planCanonicalEntry({ node, route, engine, enabled })`,
  `readyNodeFrom(latestNodes, fallbackNode, result, apply)` → node pronto, aplicado ao node ATUAL da lista.

- [ ] **Step 1: Write the failing test**

```js
// packages/web-shell/lib/canonical/edit-entry.test.js
import { describe, expect, it } from 'vitest';
import { EDIT_ROUTE } from '../edit-action-decision.js';
import { applyReconstructionResultToNode } from '../node-editor-kind.js';
import { CANONICAL_ENTRY, canonicalEditClientEnabled, planCanonicalEntry, readyNodeFrom } from './edit-entry.js';

const site = (source) => ({ kind: 'site', current_snapshot_source: source });

describe('Edit com a cópia editável', () => {
  it('interruptor do canvas', () => {
    expect(canonicalEditClientEnabled('1')).toBe(true);
    expect(canonicalEditClientEnabled('true')).toBe(true);
    expect(canonicalEditClientEnabled('')).toBe(false);
    expect(canonicalEditClientEnabled(undefined)).toBe(false);
  });

  it('desligado ou com motor nominal: fluxo de hoje', () => {
    expect(planCanonicalEntry({ node: site('native-bundle'), route: EDIT_ROUTE.OPEN, enabled: false })).toBe(CANONICAL_ENTRY.OFF);
    expect(planCanonicalEntry({ node: site(null), route: EDIT_ROUTE.RECONSTRUCT, engine: 'iter9', enabled: true })).toBe(CANONICAL_ENTRY.OFF);
  });

  it('captura nativa nunca editada: prepara a cópia', () => {
    expect(planCanonicalEntry({ node: site('native-bundle'), route: EDIT_ROUTE.OPEN, enabled: true })).toBe(CANONICAL_ENTRY.PREPARE);
  });

  it('sem captura ainda: captura e depois prepara', () => {
    expect(planCanonicalEntry({ node: site('capture'), route: EDIT_ROUTE.RECONSTRUCT, enabled: true })).toBe(CANONICAL_ENTRY.CAPTURE_THEN_PREPARE);
  });

  it('já é a cópia, ou já tem edições no nativo: abre como hoje', () => {
    expect(planCanonicalEntry({ node: site('canonical'), route: EDIT_ROUTE.OPEN, enabled: true })).toBe(CANONICAL_ENTRY.OFF);
    expect(planCanonicalEntry({ node: site('native-edit'), route: EDIT_ROUTE.OPEN, enabled: true })).toBe(CANONICAL_ENTRY.OFF);
  });

  it('rotas de bloqueio seguem como hoje', () => {
    for (const route of [EDIT_ROUTE.REPAIR_NEEDED, EDIT_ROUTE.PLAN_REQUIRED, EDIT_ROUTE.NATIVE_UNAVAILABLE]) {
      expect(planCanonicalEntry({ node: site('native-bundle'), route, enabled: true })).toBe(CANONICAL_ENTRY.OFF);
    }
  });

  it('só tipos que abrem no editor nativo', () => {
    expect(planCanonicalEntry({ node: { kind: 'image', current_snapshot_source: 'native-bundle' }, route: EDIT_ROUTE.OPEN, enabled: true })).toBe(CANONICAL_ENTRY.OFF);
  });

  it('a cópia que chega minutos depois mantém a posição para onde o usuário moveu o node', () => {
    const clicado = { id: 'n1', kind: 'site', pos_x: 0, pos_y: 0, current_snapshot_source: 'native-bundle', meta: {} };
    const atual = { ...clicado, pos_x: 900, pos_y: 400, meta: { name: 'Renamed' } };
    const result = { kind: 'native', snapshotId: 's2', snapshotSource: 'canonical', bundleDescriptor: { bundleId: 'b2' }, motionManifest: { schemaVersion: 2 } };
    const pronto = readyNodeFrom([atual], clicado, result, applyReconstructionResultToNode);
    expect(pronto).toMatchObject({ pos_x: 900, pos_y: 400, current_snapshot_source: 'canonical', current_native_bundle_id: 'b2' });
    expect(pronto.meta.name).toBe('Renamed');
    expect(readyNodeFrom([], clicado, result, applyReconstructionResultToNode).pos_x).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/web-shell && npx vitest run lib/canonical/edit-entry.test.js`
Expected: FAIL — `./edit-entry.js` não resolve.

- [ ] **Step 3: Write minimal implementation**

```js
// packages/web-shell/lib/canonical/edit-entry.js
// O Edit com a cópia editável (spec 2026-10-09 §0/§9): a decisão é pura e consome a rota que o
// `planEditEntry` já calculou — nunca reinventa a regra de linhagem nem de plano.
import { EDIT_ROUTE } from '../edit-action-decision.js';

export const CANONICAL_ENTRY = Object.freeze({
  OFF: 'off',
  PREPARE: 'prepare',
  CAPTURE_THEN_PREPARE: 'capture-then-prepare',
});

// Mesmos tipos que `resolveNodeEditorKind` abre no editor nativo.
const EDITABLE_KINDS = new Set(['site', 'template', 'chunk']);

export function canonicalEditClientEnabled(value = process.env.NEXT_PUBLIC_CANONICAL_EDIT) {
  return /^(1|true)$/i.test(String(value || ''));
}

export function planCanonicalEntry({ node, route, engine = null, enabled }) {
  if (!enabled || engine || !node || !EDITABLE_KINDS.has(node.kind)) return CANONICAL_ENTRY.OFF;
  if (route === EDIT_ROUTE.RECONSTRUCT) return CANONICAL_ENTRY.CAPTURE_THEN_PREPARE;
  if (route === EDIT_ROUTE.OPEN && node.current_snapshot_source === 'native-bundle') return CANONICAL_ENTRY.PREPARE;
  return CANONICAL_ENTRY.OFF;
}

// A preparação leva minutos: o resultado se aplica ao node ATUAL (posição, nome, meta), nunca ao capturado no clique.
export function readyNodeFrom(latestNodes, fallbackNode, result, apply) {
  const fresh = (latestNodes || []).find((n) => n.id === fallbackNode.id) || fallbackNode;
  return apply(fresh, result);
}
```

Em `components/CanvasNodeItem.jsx`: acrescentar `canonicalPrep` na lista destruturada de props e, no JSX do
`<CanvasNode>`, logo depois de `runStatus={runStatus}`:

```jsx
      canonicalPrep={canonicalPrep}
      onCanonicalRetry={() => h().retryCanonicalPrep(node.id)}
      onCanonicalOpenLive={() => h().openLiveInsteadOfCanonical(node.id)}
```

Em `components/CanvasClient.jsx`:

1. Imports (junto dos outros de `../lib/` e `./`):

```js
import { useCanonicalPrep } from './useCanonicalPrep.js';
import { CANONICAL_ENTRY, canonicalEditClientEnabled, planCanonicalEntry, readyNodeFrom } from '../lib/canonical/edit-entry.js';
```

2. No nível do módulo, ao lado de `NATIVE_MOTION_CANVAS_EDIT` (linha ~210):

```js
const CANONICAL_EDIT = canonicalEditClientEnabled();
```

3. Logo abaixo de `const [nodes, setNodes] = useState(initialNodes || []);` (linha 223):

```js
  // A preparação da cópia leva minutos: o resultado se aplica ao node ATUAL (posição, nome), nunca ao
  // capturado no clique.
  const nodesLatestRef = useRef(nodes);
  nodesLatestRef.current = nodes;
  const canonical = useCanonicalPrep({ api });
```

4. Uma função nova, logo antes de `async function handleEditingToggle(`:

```js
  async function prepareCanonicalCopy(node, { capture }) {
    const nodeId = node.id;
    editPreparationRef.current.add(nodeId);
    const partiuClone = Date.now();
    try {
      const outcome = await canonical.run(nodeId, {
        capture: capture ? async () => {
          const result = await api.reconstructNode(nodeId, { engine: null });
          marcarEsperaDoClone(nodeId, Date.now() - partiuClone, 'native', result?.cloneTelemetry, result?.meta?.captureReport);
          flashNodeDebit(nodeId, result?.credits);
          setNodes((prev) => prev.map((n) => (n.id === nodeId ? applyReconstructionResultToNode(n, result) : n)));
        } : null,
      });
      if (!outcome.ok) return; // o node mostra o motivo e as duas escolhas
      const ready = readyNodeFrom(nodesLatestRef.current, node, outcome.result, applyReconstructionResultToNode);
      setNodes((prev) => prev.map((n) => (n.id === nodeId ? applyReconstructionResultToNode(n, outcome.result) : n)));
      canonical.dismiss(nodeId);
      enterEditMode(ready, editorKindForNode(ready));
    } catch (e) {
      canonical.dismiss(nodeId);
      if (e?.challenge) {
        let host = 'this site';
        try { host = new URL(e.challenge.url || node?.origin_url || '').hostname.replace(/^www\./, ''); } catch { /* keep default */ }
        setChallengeNotice({ nodeId, host, purpose: 'edit' });
      } else if (!handleBillingError(e)) {
        toast.error(`Could not prepare this site for editing: ${e.message}`);
      }
    } finally {
      editPreparationRef.current.delete(nodeId);
    }
  }
```

5. Em `handleEditingToggle`, logo DEPOIS do bloco `const { route, engine: engineOverride } = planEditEntry({...});`
e ANTES do primeiro `if (route === ...)`:

```js
      const canonicalEntry = planCanonicalEntry({ node, route, engine: engineOverride, enabled: CANONICAL_EDIT });
      if (canonicalEntry !== CANONICAL_ENTRY.OFF) {
        await prepareCanonicalCopy(node, { capture: canonicalEntry === CANONICAL_ENTRY.CAPTURE_THEN_PREPARE });
        return;
      }
```

6. Em `nodeHandlersRef.current = { ... }` (linha ~6238), acrescentar:

```js
    retryCanonicalPrep: (nodeId) => { canonical.dismiss(nodeId); handleEditingToggle(nodeId, true); },
    openLiveInsteadOfCanonical: (nodeId) => {
      canonical.dismiss(nodeId);
      const target = nodesLatestRef.current.find((n) => n.id === nodeId);
      if (target) enterEditMode(target, editorKindForNode(target));
    },
```

7. No `<CanvasNodeItem ...>` (linha ~6741), depois de `runStatus={runStatus.get(n.id) || null}`:

```jsx
              canonicalPrep={canonical.prep.get(n.id) || null}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/web-shell && npx vitest run lib/canonical/edit-entry.test.js components/ && npx vitest run 2>&1 | tail -5`
Expected: PASS; suíte inteira sem `failed` e com a contagem da Task 0 + os testes novos.

- [ ] **Step 5: Build e commit**

Run: `cd packages/web-shell && npx next build 2>&1 | tail -15`
Expected: `✓ Compiled successfully` e a rota `/api/canonical-jobs/[id]/advance` na lista.

```bash
git add packages/web-shell/lib/canonical/edit-entry.js packages/web-shell/lib/canonical/edit-entry.test.js \
  packages/web-shell/components/CanvasNodeItem.jsx packages/web-shell/components/CanvasClient.jsx
git commit -m "feat(canonical): Edit prepares the editable copy behind the canvas flag"
```

---

### Task 13: Prova ao vivo (máquina real, farmminerals e landonorris)

Sem código novo de produto. Cada número e cada foto daqui entram no relatório ao Adilson. **Antes de começar:
avisar o Adilson que a primeira subida do servidor cria a tabela `canonical_jobs` no banco do produto (só
acréscimo) e que cada prova liga uma máquina virtual de ~6 min na conta da Vercel.**

**Files:** só scripts locais não versionados em `packages/web-shell/_canonica-*.mjs` (padrão `_*.mjs` do repo).

- [ ] **Step 1: Ligar os interruptores e as credenciais da máquina no `.env.local` do worktree, sem imprimir segredo**

```bash
cd /Users/adilsonporto/Desktop/IA/Uncraft-m1/packages/web-shell
node -e '
const fs=require("fs"),os=require("os");
const p=JSON.parse(fs.readFileSync(".vercel/project.json","utf8"));
const t=JSON.parse(fs.readFileSync(os.homedir()+"/Library/Application Support/com.vercel.cli/auth.json","utf8")).token;
const linhas=["UNCRAFT_CANONICAL_EDIT=1","NEXT_PUBLIC_CANONICAL_EDIT=1","UNCRAFT_SANDBOX_TEAM_ID="+p.orgId,"UNCRAFT_SANDBOX_PROJECT_ID="+p.projectId,"UNCRAFT_SANDBOX_TOKEN="+t];
fs.appendFileSync(".env.local","\n"+linhas.join("\n")+"\n",{mode:0o600});
console.log("ok: 5 variáveis acrescentadas");'
```

- [ ] **Step 2: Conferir o SDK contra a máquina real antes do canvas** (o teste usou um SDK falso; aqui se prova
  `getOrCreate` por nome, `get` de nome inexistente → `null`, comando destacado e `stop`)

Escrever `_canonica-sdk.mjs` que importa `createSandboxRunner` com `env: process.env`, chama `find('uc-canon-inexistente-a1')`
(esperado `null`), `ensure('uc-canon-prova-a1')`, escreve em `VM.script` (`/vercel/sandbox/run.sh`, modo 0o755) o
`buildRunScript()` com a linha do `npm install` em diante trocada por `exit 0`, chama `start` DUAS vezes seguidas
(a segunda tem que sair pela trava), lê `VM.done` até `{"codigo":0}` e `VM.started` uma vez só, e `stop`. Rodar
com `node --env-file=.env.local _canonica-sdk.mjs`.
Expected: `find` devolve `null` (se lançar, ajustar `isNotFound` em `sandbox-runner.js` ao formato real do erro +
teste correspondente, e só então seguir); os demais passos completam; nenhuma máquina fica ligada (conferir com
`Sandbox.list`).

- [ ] **Step 3: Subir o servidor e fazer login assinado**

```bash
cd /Users/adilsonporto/Desktop/IA/Uncraft-m1/packages/web-shell && bun run dev
```

Script `_canonica-viva.mjs` (Playwright, Chromium local): define `JWT_SECRET` no ambiente ANTES de importar
`lib/auth.js` (a constante é capturada no import), cria o cookie `uncraft_sess` com `createToken(user)` do usuário de
dev, cria um board (`POST /api/boards`) e um node `{ kind: 'site', originUrl: 'https://farmminerals.com/' }`
(`POST /api/nodes`), abre `/canvas` nesse board, clica no Edit do node e tira **três fotos**: (a) durante a captura
(número < 10), (b) no meio da gravação (número entre 15 e 85, site borrado, anel), (c) com o editor aberto na cópia.
Mede o tempo do clique até o editor abrir.
Expected: as três fotos mostram o que o §0 da spec descreve; o editor abre a cópia (no inspetor do runtime, o
documento tem `vendor/uncraft-motion.js` e `window.__uncraftMotion`); tempo total anotado (meta ≤ 8 min).

- [ ] **Step 4: Repetir com https://landonorris.com/** (canvas pesado; foi o site que reprovou com 2 vCPU)

Expected: pronto; tempo anotado; animações tocando na cópia (foto do editor + uma rolagem).

- [ ] **Step 5: Provar o recomeço do zero**

Durante uma preparação, no meio da gravação, desligar a máquina pelo nome (`_canonica-matar.mjs`: `Sandbox.get({name})`
+ `stop()`, nome lido da tarefa no banco). Expected: a tarefa volta para `queued` com `attempt = 2`, cria
`uc-canon-<id>-a2`, termina pronta; o número não volta para trás na tela.

- [ ] **Step 6: Provar a falha com escolha**

Com `UNCRAFT_SANDBOX_TOKEN` trocado por um valor inválido (reiniciar o servidor), clicar Edit num node com captura.
Expected: o node mostra "Couldn't prepare the editable copy" + "Our build machine is unavailable right now." e os dois
botões; "Open live clone instead" abre o editor nativo de hoje; nada cobrado (a reserva aparece como `failed` em
`operations`). Restaurar o token.

- [ ] **Step 7: Medir a montagem sem rede de saída** (spec §4.2: "a medir em M1, não afirmado")

Script `_canonica-sem-rede.mjs` no padrão do experimento de 2026-10-09 (`scratchpad/sbx/rodar.mjs`): numa máquina de
4 vCPU, instalar como o `run.sh` faz, chamar `sandbox.updateNetworkPolicy('deny-all')` (SDK 3.6.1) e rodar o
`normalizar-clone.mjs` com `UNCRAFT_RASTRO`; depois repetir com a rede ligada. Comparar as duas saídas com
`node scripts/comparar-gravacoes.mjs <comRede> <semRede>`.
Expected: anotar o resultado (fichas, rastro, página) sem decidir nada — se ficar dentro da variação natural, a
decisão de desligar a rede vira uma task futura com o número; se não, fica registrado por que a rede segue ligada.

- [ ] **Step 8: Limpeza e registro**

Conferir que nenhuma máquina ficou ligada (`Sandbox.list`) e nenhum snapshot de disco foi criado. Anotar no
relatório: tempos (clique→pronto) dos dois sites, fotos, e qualquer diferença entre o esperado e o visto.

---

### Task 14: Auditoria adversarial do ramo

- [ ] **Step 1: Montar o pacote da auditoria** (prosa, escopado — nunca `--mode diff` neste repo)

```bash
cd /Users/adilsonporto/Desktop/IA/Uncraft-m1
B=/private/tmp/claude-501/-Users-adilsonporto-Desktop-IA-Uncraft/6d9ad5bd-fbda-42c0-916c-06dee511177d/scratchpad/audit-m1-r1.md
BASE=$(git merge-base HEAD feat/verbatim-gate)
{ echo "# Auditoria M1 — cópia editável no Edit"; echo; sed -n 1,200p docs/superpowers/specs/2026-10-09-copia-editavel-no-edit-design.md; echo; echo '## Diff'; echo '```diff'; git diff "$BASE" -- packages/web-shell ':!packages/web-shell/bun.lock'; echo '```'; } > "$B"
```

- [ ] **Step 2: Rodar**

```bash
~/.claude/bin/codex-adversary.sh --mode prose --model gpt-6-astra --effort high --timeout 1700 --file "$B" \
  --focus "Auditoria adversarial do M1. Procure: corridas entre consultas concorrentes e a varredura; máquina órfã ou cobrança presa; publicação por cima de node que mudou; vazamento de credencial para a máquina; passo que excede o tempo da função; UI que mente sobre progresso ou falha. Cada achado: severidade P0/P1/P2, arquivo:linha, cenário concreto, correção mínima. Se nada acima de P2, diga MERGE OK."
```

- [ ] **Step 3: Para cada achado: reproduzir com um teste vermelho, corrigir, ver verde, commitar** (teto de 5 rodadas;
  parar antes se o tema se repetir ou precisar de decisão de produto). Rodar a suíte inteira e o `next build` no fim.

---

## Auditoria do plano (Codex gpt-6-astra, 2026-10-09)

- **r1 — 5 achados, todos corrigidos:** comando duplicado na janela iniciar→gravar (a verdade do andamento passou
  a ser a máquina: trava atômica no script + `iniciado` + `fim.json`); trava que vencia com a dona viva (330 s >
  300 s da rota; escrita cercada vazia = parar sem efeito externo); limpeza que se perdia depois da transição
  (`cleanup_done` + varredura); reserva partilhada devolvida por engano; cancelamento do poller com consulta pendente.
- **r2 — 1 achado, corrigido:** a varredura revogava trava viva (`failOverdueJob` agora respeita a trava).
- **r3 — 1 achado, corrigido:** criação de máquina com resultado incerto (ausência só fecha a limpeza depois do
  prazo da própria máquina).
- **Parado na r3 pela regra do teto:** as três últimas rodadas foram o MESMO tema (máquina órfã). Resíduo
  declarado: qualquer máquina que escape de todas as cercas acima se desliga sozinha no `timeout` de 30 min dela.

## Fora do M1 (registrado para M2–M5)

- Cena 3D (`--sem-plano` sai, posição por ordem de camadas, segundo domínio) — M2.
- Programa embutido no documento, materialização a cada salvamento, `canonical-edit`, criação lendo a cópia — M3.
  Até lá, salvar uma edição na cópia grava `native-edit` sobre o pacote da cópia (o editor de hoje), e a criação a
  partir dele segue a regra de frescor de hoje — por isso o interruptor fica só em desenvolvimento.
- Linha do tempo sobre as fichas — M4. No M1 o painel de movimento pode listar os tweens que o NOSSO tocador cria;
  editar ali não é suportado ainda.
- Conversão de nodes `native-edit` — M5.
- Antes de ligar para usuários: deploy de verdade (OIDC da Vercel no lugar das três variáveis, `process.cwd()` da
  função apontando o pacote, `outputFileTracingIncludes` conferido no build), plano Hobby × Pro com o custo medido.
