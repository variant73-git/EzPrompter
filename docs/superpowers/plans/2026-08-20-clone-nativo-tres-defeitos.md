# Três defeitos do clone nativo/canvas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (A) Reabrir Edit após Save sem re-clonar nem cobrar; (B) imagens do clone nativo não quebram mais durante a sessão de edição (token TTL) e a captura fecha `srcset`; (C) zoom do edit mode não descentraliza o site nem persiste câmera corrompida.

**Architecture:** (A) classificador estrutural compartilhado `classifyNativeLineage(node)` → `native-ready | legacy | native-inconsistent` usado por policy, dev-toggles e rota (a rota passa a selecionar as colunas do bundle e a pular ANTES do billing). (B) TTL de token de edição sobe para 4h com revogação real já existente no gateway (sessão `active` verificada por request + fechamento em commit/discard) + `expires_at` da sessão passa a ser escrito e verificado; captura força o carregamento dos candidatos de `srcset`/CSS `url()` absolutos DENTRO da página (entram pela interceptação normal, com SSRF/limites) e o relatório é persistido sanitizado. (C) câmera normal não é persistida durante o edit; câmera pré-edit é restaurada para TODOS os editor kinds; view persistida cujo scale foi clampado é descartada; âncora de zoom unificada com o frame de entrada; atalhos do ZoomControls desativados em edit. Piso 0.04 MANTIDO (decisão validada com Sol).

**Tech Stack:** Next.js (packages/web-shell), Vitest, Playwright (captura), bun.

**Spec:** advise do Sol 2026-08-20 (transcript da sessão; parecer completo no output `bm3psoq0a`) + diagnóstico dos 3 agentes de investigação.

## Global Constraints

- Rodar testes com `bun` (web-shell usa bun; bun.lock é source of truth). Suíte: `bunx vitest run` em `packages/web-shell`.
- TDD: RED observado antes de cada implementação.
- NÃO adicionar `allow-same-origin` ao sandbox do iframe (invariante testada).
- NÃO inverter o teste `reconstruction-policy.test.js` de `source='edit'` (legado continua exigindo upgrade); adicionar casos novos.
- Piso de zoom do edit mode continua 0.04.
- Texto user-facing em INGLÊS.
- Auditoria do Sol antes do commit final de cada parte (adversarial-review, bundle escopado `--mode prose --file <diff>`).

---

## Parte A — Defeito 3: re-clone após Save

### Task A1: classificador `classifyNativeLineage`

**Files:**
- Modify: `packages/web-shell/lib/node-editor-kind.js`
- Test: `packages/web-shell/lib/node-editor-kind.test.js`

**Interfaces:**
- Produces: `classifyNativeLineage(node)` → `'native-ready' | 'legacy' | 'native-inconsistent'`; `NATIVE_LINEAGE = Object.freeze({ READY:'native-ready', LEGACY:'legacy', INCONSISTENT:'native-inconsistent' })`; `NATIVE_SNAPSHOT_SOURCES = Object.freeze(['native-bundle','native-edit'])`.

- [ ] **A1.1 failing tests** — em `node-editor-kind.test.js`:

```js
import { classifyNativeLineage, NATIVE_LINEAGE } from './node-editor-kind.js';

describe('classifyNativeLineage', () => {
  const BUNDLE = '123e4567-e89b-42d3-a456-426614174000';
  it('native-bundle snapshot with bundle+manifest v2 is native-ready', () => {
    expect(classifyNativeLineage({ current_snapshot_source: 'native-bundle', current_native_bundle_id: BUNDLE, current_motion_manifest_version: 2 })).toBe(NATIVE_LINEAGE.READY);
  });
  it('native-edit snapshot (post-Save) with bundle+manifest v2 is native-ready', () => {
    expect(classifyNativeLineage({ current_snapshot_source: 'native-edit', current_native_bundle_id: BUNDLE, current_motion_manifest_version: 2 })).toBe(NATIVE_LINEAGE.READY);
  });
  it('legacy edit snapshot without native lineage is legacy', () => {
    expect(classifyNativeLineage({ current_snapshot_source: 'edit', current_native_bundle_id: null, current_motion_manifest_version: null })).toBe(NATIVE_LINEAGE.LEGACY);
  });
  it('claims native but bundle id malformed → native-inconsistent', () => {
    expect(classifyNativeLineage({ current_snapshot_source: 'native-edit', current_native_bundle_id: 'not-a-uuid', current_motion_manifest_version: 2 })).toBe(NATIVE_LINEAGE.INCONSISTENT);
  });
  it('claims native but manifest version wrong → native-inconsistent', () => {
    expect(classifyNativeLineage({ current_snapshot_source: 'native-bundle', current_native_bundle_id: BUNDLE, current_motion_manifest_version: 1 })).toBe(NATIVE_LINEAGE.INCONSISTENT);
  });
  it('bundle id present but source legacy → native-inconsistent (claims lineage)', () => {
    expect(classifyNativeLineage({ current_snapshot_source: 'edit', current_native_bundle_id: BUNDLE, current_motion_manifest_version: 2 })).toBe(NATIVE_LINEAGE.INCONSISTENT);
  });
});
```

- [ ] **A1.2** rodar `bunx vitest run lib/node-editor-kind.test.js` — FAIL (export ausente).
- [ ] **A1.3 implementação** em `node-editor-kind.js` (reusa `UUID_PATTERN` e `NATIVE_MOTION_MANIFEST_VERSION` já existentes):

```js
export const NATIVE_LINEAGE = Object.freeze({ READY: 'native-ready', LEGACY: 'legacy', INCONSISTENT: 'native-inconsistent' });
export const NATIVE_SNAPSHOT_SOURCES = Object.freeze(['native-bundle', 'native-edit']);

// Structural classifier (Sol advise 2026-08-20): readiness is decided by the
// STRUCTURE (bundle id + manifest version), source strings serve as the claim.
// A node that claims native lineage but whose structure doesn't close is
// INCONSISTENT — an integrity failure, never an authorization to re-charge.
export function classifyNativeLineage(node) {
  const source = node?.current_snapshot_source;
  const claimsNative = NATIVE_SNAPSHOT_SOURCES.includes(source) || node?.current_native_bundle_id != null;
  if (!claimsNative) return NATIVE_LINEAGE.LEGACY;
  const structureOk = UUID_PATTERN.test(String(node?.current_native_bundle_id || ''))
    && Number(node?.current_motion_manifest_version) === NATIVE_MOTION_MANIFEST_VERSION
    && NATIVE_SNAPSHOT_SOURCES.includes(source);
  return structureOk ? NATIVE_LINEAGE.READY : NATIVE_LINEAGE.INCONSISTENT;
}
```

- [ ] **A1.4** testes passam; suíte do arquivo verde.
- [ ] **A1.5 Commit** `fix(edit): classificador estrutural de linhagem nativa (native-ready/legacy/native-inconsistent)`

### Task A2: policy usa o classificador (short-circuit antes do deferred)

**Files:**
- Modify: `packages/web-shell/lib/reconstruction-policy.js`
- Test: `packages/web-shell/lib/reconstruction-policy.test.js`

**Interfaces:**
- Consumes: `classifyNativeLineage`, `NATIVE_LINEAGE` de `./node-editor-kind.js`.
- Produces: `reconstructionReason` devolve `null` para `native-ready` no role `edit` ANTES de `needsDeferredReconstruction`; devolve `'native-inconsistent'` (reason novo, não-billável) para inconsistente no role `edit`.

- [ ] **A2.1 failing tests** (ADICIONAR, sem tocar os existentes de `source='edit'`):

```js
const BUNDLE = '123e4567-e89b-42d3-a456-426614174000';
const nativeReady = (source) => ({
  kind: 'site', origin_url: 'https://x.com',
  current_snapshot_source: source, current_native_bundle_id: BUNDLE,
  current_motion_manifest_version: 2,
  meta: { animatedDetected: true },   // stale flag MUST NOT force a re-clone
});
it('edit on a native-edit (saved) node reconstructs nothing, even with stale animatedDetected', () => {
  expect(reconstructionReason({ node: nativeReady('native-edit'), role: 'edit' })).toBe(null);
});
it('edit on a native-bundle node reconstructs nothing', () => {
  expect(reconstructionReason({ node: nativeReady('native-bundle'), role: 'edit' })).toBe(null);
});
it('edit on an inconsistent native node yields native-inconsistent (repair, not billable clone)', () => {
  const broken = { ...nativeReady('native-edit'), current_native_bundle_id: 'nope' };
  expect(reconstructionReason({ node: broken, role: 'edit' })).toBe('native-inconsistent');
});
it('target/source roles keep deferred policy untouched for native nodes', () => {
  expect(reconstructionReason({ node: nativeReady('native-edit'), role: 'target' })).toBe(null);
});
```

- [ ] **A2.2** RED observado.
- [ ] **A2.3 implementação** em `reconstruction-policy.js`:

```js
import { classifyNativeLineage, NATIVE_LINEAGE } from './node-editor-kind.js';

export function reconstructionReason({ node, role, edgePayload } = {}) {
  if (role === 'edit' && node?.kind === 'site' && node?.origin_url && !isIter9Reconstruction(node)) {
    const lineage = classifyNativeLineage(node);
    // Short-circuit BEFORE needsDeferredReconstruction: a stale
    // animatedDetected/live-reference flag must not re-clone a ready node.
    if (lineage === NATIVE_LINEAGE.READY) return null;
    if (lineage === NATIVE_LINEAGE.INCONSISTENT) return 'native-inconsistent';
    return 'edit'; // legacy: product rule 2026-08-17 (auto-upgrade) unchanged
  }
  if (!needsDeferredReconstruction(node)) return null;
  if (role === 'edit') return 'edit';
  if (role === 'target') return 'transform-target';
  if (role === 'source' && edgeNeedsEditableRuntime(edgePayload)) return 'runtime-source';
  return null;
}
```

`editNeedsNativeUpgrade` privada morre absorvida (mesma guarda de kind/origin/iter9 no topo). `shouldReconstructForAction` continua `reason !== null` — note que `native-inconsistent` conta como "ação necessária" para o gate de plano do cliente NÃO abrir edit quebrado; a rota trata o reason sem cobrar (Task A3).

- [ ] **A2.4** testes novos passam E os antigos de `source='edit'` continuam passando sem edição.
- [ ] **A2.5 Commit** `fix(edit): save nativo não re-clona — policy classifica linhagem antes do deferred`

### Task A3: rota /reconstruct — colunas do bundle, skip antes do billing, inconsistente sem cobrança

**Files:**
- Modify: `packages/web-shell/app/api/nodes/[id]/reconstruct/route.js`
- Test: `packages/web-shell/app/api/nodes/[id]/reconstruct/route.test.js` (existe? se não, criar seguindo o padrão de `runtime-session/route.test.js` — mock de `db`/`requireUser`)

**Interfaces:**
- Consumes: `reconstructionReason` (novo comportamento), `classifyNativeLineage`.
- Produces: SELECT ganha `s.native_bundle_id AS current_native_bundle_id, s.motion_manifest_version AS current_motion_manifest_version`; skip (`engine == null && !shouldReconstructForAction`) roda ANTES do gate de plano e do rate limit; reason `native-inconsistent` com `engine == null` → `409 { error: 'native_inconsistent' }` sem billing.

- [ ] **A3.1 failing tests**: (a) node com snapshot `native-edit` + bundle + v2 → resposta `skipped: true`, `reconstructSiteNode` NÃO chamado, nenhuma checagem de rate; (b) node inconsistente → 409 `native_inconsistent`, `reconstructSiteNode` NÃO chamado; (c) `engine:'iter9'` nominal continua executando mesmo pronto (comportamento 183 preservado). Mockar `deferred-reconstruction.js` e `billing/rate-limit.js` com `vi.mock` class-based conforme padrão do repo.
- [ ] **A3.2** RED observado.
- [ ] **A3.3 implementação**: mover o bloco de parse do `engine` + skip para antes de `canUseCloneEdit`; adicionar as 2 colunas ao SELECT; branch:

```js
const reason = reconstructionReason({ node, role: 'edit' });
if (engine == null && reason === null) { /* skipped response igual à atual */ }
if (engine == null && reason === 'native-inconsistent') {
  return NextResponse.json({ error: 'native_inconsistent' }, { status: 409 });
}
// plan gate + rate limit + reconstructSiteNode só a partir daqui
```

- [ ] **A3.4** testes passam; `bunx vitest run app/api/nodes` verde.
- [ ] **A3.5 Commit** `fix(edit): rota reconstruct decide com as colunas do bundle e pula antes do billing`

### Task A4: dev-toggles + guarda do cliente

**Files:**
- Modify: `packages/web-shell/lib/dev-toggles.js`
- Modify: `packages/web-shell/components/CanvasClient.jsx` (handleEditingToggle)
- Test: `packages/web-shell/lib/dev-toggles.test.js`

**Interfaces:**
- Consumes: `classifyNativeLineage`, `NATIVE_LINEAGE`.
- Produces: `resolveEditEngineOverride` anula override `'native'` quando `classifyNativeLineage(node) === NATIVE_LINEAGE.READY` (não mais `source === 'native-bundle'`). Cliente: reason `native-inconsistent` → toast error "This clone needs repair — re-clone it from the node menu." e NÃO chama a API; native-ready com flag off (editorKind LEGACY) → toast "Native editing is unavailable in this build." e não abre editor legado vazio.

- [ ] **A4.1 failing test** em `dev-toggles.test.js`:

```js
it('stored native override resolves to null for a saved native-edit node', () => {
  const node = { current_snapshot_source: 'native-edit', current_native_bundle_id: '123e4567-e89b-42d3-a456-426614174000', current_motion_manifest_version: 2 };
  expect(resolveEditEngineOverride(node, 'native')).toBe(null);
});
```

- [ ] **A4.2** RED; implementar; verde.
- [ ] **A4.3** guarda do cliente em `handleEditingToggle` (antes do fluxo de reconstruct):

```js
const lineage = classifyNativeLineage(node);
if (!engineOverride && lineage === NATIVE_LINEAGE.INCONSISTENT) {
  toast.error('This clone needs repair — re-clone it from the node menu.');
  return;
}
if (!engineOverride && lineage === NATIVE_LINEAGE.READY && editorKind !== NODE_EDITOR_KIND.NATIVE) {
  toast.error('Native editing is unavailable in this build.');
  return;
}
```

- [ ] **A4.4** suíte inteira da web-shell verde (`bunx vitest run`).
- [ ] **A4.5 Commit** `fix(edit): dev override e cliente respeitam linhagem nativa`

---

## Parte B — Defeito 1: imagens quebradas (token TTL) + fechamento de srcset

### Task B1: TTL de edição 4h com teto novo e testes

**Files:**
- Modify: `packages/web-shell/lib/motion-editor/runtime-session-token.js`
- Modify: `packages/web-shell/app/api/nodes/[id]/runtime-session/route.js`
- Test: `packages/web-shell/lib/motion-editor/runtime-session-token.test.js`

**Interfaces:**
- Produces: `RUNTIME_SESSION_MAX_TTL_SECONDS = 4*60*60`; `RUNTIME_SESSION_EDIT_TTL_SECONDS = 4*60*60`; default continua `2*60`. Rota emite `ttlSeconds: RUNTIME_SESSION_EDIT_TTL_SECONDS`.

- [ ] **B1.1 failing tests**: emitir com `ttlSeconds: RUNTIME_SESSION_EDIT_TTL_SECONDS` → verifica OK e `exp - iat === 14400`; token com `exp - iat` acima do teto novo → `invalid` (teto continua verificado dos DOIS lados); default sem ttl continua 120s.
- [ ] **B1.2** RED; implementar constantes + `ttlSeconds` na rota; verde.
- [ ] **B1.3** comentário de dívida arquitetural no `runtime-session-token.js`:

```js
// DEBT (Sol advise 2026-08-20): the long-lived edit token is a bearer in the
// URL path with CORS *. Revocation is REAL — the gateway checks the edit
// session row (status='active', node/bundle/current-snapshot scope) on every
// request, and commit/discard/expiry close it — but the target design is a
// short entry token + a separate revocable asset lease. Do not extend this
// TTL further without building the lease.
```

- [ ] **B1.4 Commit** `fix(runtime): token de edição vive a sessão (4h) — revogação continua na sessão`

### Task B2: `expires_at` da sessão escrito e verificado

**Files:**
- Modify: `packages/web-shell/lib/motion-editor/edit-session-store.js` (open/resume escrevem `expires_at = NOW() + interval '4 hours'`; resume estende)
- Modify: `packages/web-shell/app/api/runtime/[token]/[...path]/route.js` (query ganha `AND e.expires_at > NOW()`)
- Test: `packages/web-shell/lib/motion-editor/edit-session-store.test.js` + teste do gateway (`app/api/runtime/[token]/[...path]/route.test.js` se existir; senão teste do store apenas + caso no teste da rota existente)

- [ ] **B2.1 failing tests**: open seta `expiresAt` não-nulo ~4h à frente; resume atualiza `expires_at`; gateway nega sessão com `expires_at` no passado (reason `session_scope_mismatch` serve — sem reason novo).
- [ ] **B2.2** RED; implementar; verde. Cuidado: mocks de sql do repo são template-tag fakes — seguir o padrão dos testes existentes do store.
- [ ] **B2.3 Commit** `fix(runtime): edit session expira de verdade (expires_at escrito e verificado no gateway)`

### Task B3: captura fecha srcset/CSS url() forçando carregamento na página

**Files:**
- Modify: `packages/web-shell/lib/native-clone/capture-bundle.js`
- Test: `packages/web-shell/lib/native-clone/capture-bundle.test.js`

**Interfaces:**
- Produces: após o scroll e antes de `collecting`, um passo `onProgress({ etapa: 'closing-refs' })` roda `page.evaluate` que coleta e faz `fetch` (com `cache: 'no-cache'` NÃO — usar default para aproveitar interceptação) de todo candidato ainda não carregado de: `img[srcset]`, `source[srcset]`, `link[rel=preload][imagesrcset]`, atributos `data-srcset`, e URLs absolutas `url(...)`/`image-set(...)` de TODAS as CSSRules acessíveis (`document.styleSheets`, try/catch por folha cross-origin). Parsing de srcset NO BROWSER (split por vírgula é proibido — data URLs têm vírgula; usar o parser por regex de candidato `/(?:^|,)\s*([^\s,]+)(\s+[^,]+)?/g` sobre o valor, que é o formato candidato = URL sem vírgula não-escapada + descriptor). Cada fetch entra pela interceptação `page.on('response')` normal — SSRF, limites e relatório já se aplicam. Cap: 300 candidatos extras.

- [ ] **B3.1 failing test** (unit, sem browser): extrair o parser para função exportada `srcsetCandidateUrls(value)` e testar:

```js
it('parses srcset candidates including width descriptors', () => {
  expect(srcsetCandidateUrls('https://a/x.avif 500w, ./y.avif 1542w')).toEqual(['https://a/x.avif', './y.avif']);
});
it('does not split data URLs on commas', () => {
  expect(srcsetCandidateUrls('data:image/png;base64,AAA 1x, https://a/z.png 2x')).toEqual(['data:image/png;base64,AAA', 'https://a/z.png']);
});
```

(implementar `srcsetCandidateUrls` com varredura por token: split em vírgulas que precedem whitespace+URL — algoritmo do spec WHATWG simplificado: consumir até vírgula que não esteja dentro de um candidato; documentar limitação.)

- [ ] **B3.2** RED; implementar parser exportado; verde.
- [ ] **B3.3** integrar o passo `closing-refs` no `captureNativeBundle` (o `page.evaluate` recebe a fonte do parser via `toString()` NÃO — declarar a função DENTRO do evaluate para não depender de serialização de closure; duplicação aceita e apontada por comentário para o teste unitário).
- [ ] **B3.4** teste de integração existente do capture (se houver com Playwright real) continua verde; rodar `bunx vitest run lib/native-clone`.
- [ ] **B3.5 Commit** `fix(native-clone): captura fecha srcset e backgrounds CSS carregando candidatos na página`

### Task B4: relatório persistido sanitizado

**Files:**
- Modify: `packages/web-shell/lib/deferred-reconstruction.js` (onde `materialized.output` é lido — persistir em `meta.captureReport`)
- Test: `packages/web-shell/lib/deferred-reconstruction.test.js` (ou o teste que cobre o caminho native — localizar por `typeSample`)

**Interfaces:**
- Produces: `meta.captureReport = { files, bytes, discarded, discardedHosts }` onde `discardedHosts` = até 10 hosts únicos de `relatorio.descartados` (NUNCA a URL inteira — pode carregar query/token; achado do Sol).

- [ ] **B4.1 failing test**: resultado native com `relatorio.descartados` vira `meta.captureReport` com hosts sanitizados.
- [ ] **B4.2** RED; implementar; verde.
- [ ] **B4.3 Commit** `fix(native-clone): relatório de captura persiste sanitizado no meta do snapshot`

---

## Parte C — Defeito 2: zoom do edit mode

### Task C1: view persistida corrompida é descartada; constantes centralizadas

**Files:**
- Modify: `packages/web-shell/lib/canvas-view.js`
- Test: `packages/web-shell/lib/canvas-view.test.js` (criar se não existir)

**Interfaces:**
- Produces: `parseCanvasView` devolve `null` quando o clamp ALTERARIA o scale (posição gravada para um scale que não vai ser aplicado = câmera incoerente; o mount cai no fit padrão). Exports novos: `CANVAS_EDIT_MIN_SCALE = 0.04`, `CANVAS_WHEEL_MAX_SCALE = 2.5` (consumidos pela C3).

- [ ] **C1.1 failing tests**:

```js
it('discards a stored view whose scale is outside canvas bounds (position is incoherent)', () => {
  expect(parseCanvasView(JSON.stringify({ positionX: 40000, positionY: -3000, scale: 0.04 }))).toBe(null);
});
it('keeps a stored view within bounds', () => {
  expect(parseCanvasView(JSON.stringify({ positionX: 10, positionY: 10, scale: 0.5 }))).toEqual({ positionX: 10, positionY: 10, scale: 0.5 });
});
```

- [ ] **C1.2** RED; implementar (`if (clamped !== scale) return null`); verde.
- [ ] **C1.3 Commit** `fix(canvas): câmera persistida fora dos limites é descartada, não meio-clampada`

### Task C2: não persistir câmera durante edit; restaurar pré-edit para todos os kinds

**Files:**
- Modify: `packages/web-shell/components/CanvasClient.jsx`

Mudanças:
1. Ref `editingNodeIdRef` sincronizada com o estado (`useEffect(() => { editingNodeIdRef.current = editingNodeId; }, [editingNodeId])`).
2. No bloco de persistência do `onTransformed` (linha ~6519): `if (editingNodeIdRef.current) { /* edit camera never persists */ } else { ...gravação atual... }`.
3. `enterEditMode`: snapshot de câmera pré-edit para TODOS os kinds (hoje só NATIVE tem `nativeEditRestoreRef.camera`): novo ref `preEditCameraRef.current = { nodeId: node.id, camera: window.__uncraftZoom?.getState?.() || null }`.
4. `exitEditMode`: restaurar `preEditCameraRef` para o kind legado também (o caminho NATIVE existente continua; deduplicar: o restore legado só roda quando `nativeEditRestoreRef` não tratou o node).

- [ ] **C2.1** implementar (não há teste unitário viável do componente inteiro; a suíte de componentes existente precisa continuar verde).
- [ ] **C2.2** `bunx vitest run components` verde.
- [ ] **C2.3 Commit** `fix(canvas): câmera do edit não vaza pra persistência; pré-edit restaurada em todos os editores`

### Task C3: âncora única de zoom em edit + atalhos consolidados

**Files:**
- Modify: `packages/web-shell/lib/node-viewport.js` (export `editFrameAnchor({ viewportWidth, viewportHeight, leftReserve, rightReserve, bottom })` → `{ cx, cy }` com a MESMA matemática de centro usada por `computeNodeEditFrame`)
- Modify: `packages/web-shell/components/CanvasClient.jsx` (`zoomAtPoint` e `setAbs` usam `editFrameAnchor` com `reserves.bottom ?? 18` — hoje `cy` hardcoda `46 + (H-64)/2` e ignora o bottom de 200 do editor native → deriva de ~91px por notch)
- Modify: `packages/web-shell/components/ZoomControls.jsx` (prop nova `active`; quando `false`, o `useEffect` do keydown não registra listener)
- Modify: `packages/web-shell/components/CanvasClient.jsx` (passar `active={!editingNodeId}` ao ZoomControls)
- Test: `packages/web-shell/lib/node-viewport.test.js`

- [ ] **C3.1 failing test**: `editFrameAnchor` devolve o mesmo centro que o frame calculado por `computeNodeEditFrame` para um node de referência (asserção de consistência — o pivô do zoom É o centro do frame de entrada):

```js
it('zoom anchor equals the edit-frame center (same reserves)', () => {
  const args = { viewportWidth: 1440, viewportHeight: 900, leftReserve: 300, rightReserve: 320, bottom: 200 };
  const anchor = editFrameAnchor(args);
  const frame = computeNodeEditFrame({ pos_x: 0, pos_y: 0, width: 1280, height: 800 }, args);
  const centerX = frame.positionX + (0 + 1280 / 2) * frame.scale;
  const centerY = frame.positionY + (0 + 800 / 2) * frame.scale;
  expect(anchor.cx).toBeCloseTo(centerX, 5);
  expect(anchor.cy).toBeCloseTo(centerY, 5);
});
```

- [ ] **C3.2** RED; implementar `editFrameAnchor` extraindo a matemática de `computeNodeEditFrame`; verde.
- [ ] **C3.3** trocar as duas âncoras hardcoded do `CanvasClient.jsx` (linhas ~748-752 e ~797-801) por `editFrameAnchor` com as reserves reais do node (incluindo `bottom`).
- [ ] **C3.4** `ZoomControls` com prop `active`; registrar listener só quando ativo. Rodar `bunx vitest run` completo.
- [ ] **C3.5 Commit** `fix(canvas): pivô de zoom em edit = centro do frame de entrada; atalhos ⌘± inertes em edit`

---

## Fechamento

- [ ] **F1**: suíte completa `bunx vitest run` verde; `bun run build` (ou `next build` conforme scripts) OK.
- [ ] **F2**: smoke real — `npm run dev` na 3030: clonar/abrir farmminerals, (a) Save → Edit reabre SEM "Preparing editable site…" e sem débito; (b) sessão de edit > 2 min → rolar → imagens seguem vivas; (c) zoom out máximo em edit → zoom in → site continua sob o pivô; sair do edit → câmera pré-edit restaurada. TIRAR SCREENSHOT (regra: mostrar, não medir).
- [ ] **F3**: adversarial-review (Sol) do diff completo; corrigir achados; MERGE OK antes do commit final.
- [ ] **F4**: [SALVAR] — checkpoint de memória + CLAUDE.md item novo + vault.
