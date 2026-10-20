# Alças e guias no editor da cópia — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** devolver ao editor nativo (cópia editável e clone animado, no canvas) a caixa de seleção com 8 alças e as 9 guias
de espaçamento do editor antigo, com paridade total, cada gesto virando UMA edição desfeita por um Ctrl+Z e reaplicada
ao reabrir.

**Architecture:** uma camada nova (`runtime-overlay-source.js`) é serializada JUNTO com a ponte e roda dentro da página,
numa raiz de sombra fechada; ela desenha e cuida do arraste, mas só faz PRÉVIA. Ao soltar, a ponte avisa o editor de fora
(`overlay-gesture-ended`), que monta a edição com um montador de lote puro (`overlay-batch.js`) e a manda de volta por
`apply-transaction` com o `gestureId`; a ponte, no mesmo turno, devolve os valores de antes e aplica. Uma regra única
(um gesto vivo por vez; todo outro escritor cancela antes) protege contra edições ressuscitadas.

**Tech Stack:** JavaScript (ESM), React (controller do editor), Vitest (jsdom + node), playwright-core (Chromium real).

**Spec:** `docs/superpowers/specs/2026-10-20-alcas-e-guias-no-editor-da-copia-design.md` (ler §5–§8 antes de cada task).

## Global Constraints

- A ponte e a camada são SERIALIZADAS por `Function.prototype.toString()` e injetadas na página: **nenhum `import` e
  nenhuma referência a variável de fora** dentro de `nativeMotionRuntimeBridge`, `instalarCamada` ou das funções de
  `overlay-math.js`. Toda função de `overlay-math.js` é autossuficiente.
- Texto de produto (tooltips, avisos) em **inglês**.
- Paridade com `packages/editor-core/src/editor.js`: limiar 2 px (alça) e 3 px (guia); mínimo 20 px; Cmd/Ctrl encaixa
  de 8 em 8; Shift = 4 lados do grupo; Alt = espelho; setas 1 / Shift 10 / Cmd 8; tecla G; campo aceita `20`, `20px`,
  `rem`, `em`, `%`, `+5`, `-3`; guia só aparece com valor > 0; cantos quando alguma margem ≥ 2 px.
- Visual do antigo: seleção `#0095FF`, alças 12 px, guias `#FF00DD` hachuradas, rótulo "W × H" (CSS `editor.css`
  1747–1994, portado para dentro da raiz de sombra).
- Escrita SEM `!important`. Margem/espaçamento/gap sempre em **longhands**; `gap` → só `column-gap` (eixo x) ou
  `row-gap` (eixo y).
- **Um gesto = uma transação = um Ctrl+Z.** A camada nunca escolhe escopo de tela (é o editor de fora).
- **Regra única:** no máximo um gesto vivo (`ativo` | `aguardando`); novo gesto não começa; todo outro escritor cancela
  o gesto antes (§6.2.7 da spec).
- Cada commit passa pela auditoria do Astra antes (`~/.claude/bin/codex-adversary.sh --mode prose --model gpt-6-astra
  --effort high --timeout 1700 --file <bundle>`), teto de 5 rodadas por tema; nunca `--mode diff`.
- Trabalho no worktree `.claude/worktrees/alcas` (ramo `feat/alcas-e-guias`, a partir do `main`); dependências por link
  simbólico; comandos de teste rodam de `packages/web-shell`.

## Review Focus

1. **Elemento `display:inline`** (link ou `span` de texto): largura/altura não valem → a alça não pode aparecer ativa nem
   gravar nada; esperado: quadradinhos apagados com "Inline elements can't be resized". Teste na Task 6.
2. **Nós internos de SVG** (`path`, `g`): largura não vale → alças apagadas com o motivo; o próprio `<svg>` redimensiona.
   Teste na Task 6.
3. **Tamanho que não muda** (`flex-basis`, `aspect-ratio`, grade que estica): o estado candidato não muda de tamanho →
   o gesto é recusado com "This element's size is set by its layout" e nada fica gravado. Teste na Task 6.
4. **Elemento dentro de um contêiner com rolagem própria:** a caixa acompanha a rolagem interna (laço por quadro).
   Teste na Task 11.
5. **Elemento com `transform: scale()`:** a caixa segue o retângulo visível e o arraste não lança erro; a largura gravada
   é a do arraste em px da página (paridade com o antigo). Teste na Task 11.

---

## Arquivos

| arquivo | papel |
|---|---|
| `lib/motion-editor/overlay-math.js` (novo) | contas puras e serializáveis: redimensionar, destravar, guias, cantos, campo, setas, posição perto da borda |
| `lib/motion-editor/responsive-edit.js` (novo) | `responsivePropertyName`, `responsiveBindingFromPatch`, `responsiveStoredValue` (saem do controller) |
| `lib/motion-editor/overlay-batch.js` (novo) | `buildOverlayBatch` — lote por elemento × propriedade, com a tabela por tela |
| `lib/motion-editor/responsive-manifest.js` | `responsiveManifestForSettlement` — aplica só a mudança da transação na tabela ATUAL |
| `lib/motion-editor/runtime-overlay-source.js` (novo) | `instalarCamada(ponte, M)` — desenho, raiz de sombra, ponteiro, teclado da camada |
| `lib/motion-editor/runtime-bridge-source.js` | gancho da camada, `ehNosso`, gestos (estados, elegibilidade, aplicar com `gestureId`), regra única, repasse de desfazer |
| `components/motion-editor/useNativeMotionController.js` | recebe `overlay-gesture-ended`, monta o lote, bloqueia desfazer em `aguardando`, envia escala e teclas |
| testes | `overlay-math.test.js`, `overlay-batch.test.js`, `responsive-manifest.test.js` (+casos), `runtime-overlay.test.js` (jsdom), `runtime-overlay.browser.test.js` (Chromium), `useNativeMotionController` (+casos) |

---

### Task 0: Ambiente

- [ ] **Step 1:** criar o worktree e os links.

```bash
cd /Users/adilsonporto/Desktop/IA/Uncraft
git worktree add -b feat/alcas-e-guias .claude/worktrees/alcas main
ln -s /Users/adilsonporto/Desktop/IA/Uncraft/packages/web-shell/node_modules .claude/worktrees/alcas/packages/web-shell/node_modules
ln -s /Users/adilsonporto/Desktop/IA/Uncraft/packages/design-eval/node_modules .claude/worktrees/alcas/packages/design-eval/node_modules
cd .claude/worktrees/alcas/packages/web-shell && npx vitest run lib/motion-editor > /tmp/base-motion.log 2>&1; tail -3 /tmp/base-motion.log
```
Expected: suíte de `lib/motion-editor` verde (anotar o total como linha de base).

---

### Task 1: Tabela por tela atualizada POR MUDANÇA na confirmação (Astra r5 #2)

Defeito existente: `releaseSettled` faz `replaceResponsiveManifest(entry.meta.responsiveManifest)` com o RETRATO tirado
ao montar a edição; uma segunda edição montada antes da 1ª confirmar apaga a 1ª ao reabrir.

**Files:**
- Modify: `lib/motion-editor/responsive-manifest.js` (nova função exportada)
- Modify: `components/motion-editor/useNativeMotionController.js` (`releaseSettled`, perto da linha 919)
- Test: `lib/motion-editor/responsive-manifest.test.js`

**Interfaces:**
- Produces: `responsiveManifestForSettlement(currentManifest, entry) → manifest` — `entry = { meta:{operation}, transaction, payload? }`;
  para `apply`/`redo` aplica `patches` para frente, para `undo` aplica os patches da transação desfeita para trás.

- [ ] **Step 1: teste que falha (a perda de edição)**

```js
// em lib/motion-editor/responsive-manifest.test.js
import { responsiveManifestForSettlement, withResponsiveMetadata, createResponsiveManifest, setResponsivePropertyValue, responsivePropertyKey } from './responsive-manifest.js';

describe('tabela por tela na confirmação', () => {
  const base = () => setResponsivePropertyValue(createResponsiveManifest(), { propertyKey: responsivePropertyKey('u-a', 'width'), deviceId: 'desktop', value: '100px', descriptor: { mode: 'shared' } });
  const comMarca = (property, value, beforeEntry, afterEntry) => withResponsiveMetadata(
    { id: `p-${property}`, elementId: 'u-a', kind: 'style', property, before: '', value },
    { propertyKey: responsivePropertyKey('u-a', property), mode: 'shared', deviceId: 'desktop', beforeEntry, afterEntry },
  );
  it('duas edições montadas antes da 1ª confirmar não se apagam', () => {
    const inicial = base();
    const chaveW = responsivePropertyKey('u-a', 'width');
    const depoisA = setResponsivePropertyValue(inicial, { propertyKey: chaveW, deviceId: 'desktop', value: '150px', descriptor: { mode: 'shared' } });
    const a = { meta: { operation: 'apply' }, transaction: { patches: [comMarca('width', '150px', inicial.properties[chaveW], depoisA.properties[chaveW])] } };
    const chaveC = responsivePropertyKey('u-a', 'color');
    const depoisB = setResponsivePropertyValue(inicial, { propertyKey: chaveC, deviceId: 'desktop', value: 'red', descriptor: { mode: 'shared' } });
    const b = { meta: { operation: 'apply' }, transaction: { patches: [comMarca('color', 'red', null, depoisB.properties[chaveC])] } };
    let atual = responsiveManifestForSettlement(inicial, a);
    atual = responsiveManifestForSettlement(atual, b);
    expect(atual.properties[chaveW]).toEqual(depoisA.properties[chaveW]);
    expect(atual.properties[chaveC]).toEqual(depoisB.properties[chaveC]);
  });
  it('desfazer volta só a mudança daquela transação', () => {
    const inicial = base();
    const chaveW = responsivePropertyKey('u-a', 'width');
    const depoisA = setResponsivePropertyValue(inicial, { propertyKey: chaveW, deviceId: 'desktop', value: '150px', descriptor: { mode: 'shared' } });
    const patch = comMarca('width', '150px', inicial.properties[chaveW], depoisA.properties[chaveW]);
    const aplicado = responsiveManifestForSettlement(inicial, { meta: { operation: 'apply' }, transaction: { patches: [patch] } });
    const desfeito = responsiveManifestForSettlement(aplicado, { meta: { operation: 'undo' }, transaction: { patches: [patch] } });
    expect(desfeito.properties[chaveW]).toEqual(inicial.properties[chaveW]);
  });
});
```
- [ ] **Step 2:** `npx vitest run lib/motion-editor/responsive-manifest.test.js` → FAIL (`responsiveManifestForSettlement is not a function`).
- [ ] **Step 3: implementar**

```js
// lib/motion-editor/responsive-manifest.js — aplica só a mudança da transação sobre a tabela ATUAL (nunca um retrato
// tirado ao montar: uma edição montada antes da anterior confirmar apagava a anterior ao reabrir — Astra r5 #2)
export function responsiveManifestForSettlement(currentManifest, entry) {
  const patches = entry?.transaction?.patches || [];
  const direction = entry?.meta?.operation === 'undo' ? 'backward' : 'forward';
  return responsiveManifestAfterPatches(currentManifest, patches, direction);
}
```
No undo, o `entry.transaction` que o ledger guarda é a INVERSA; para o desfazer usar os patches originais, o controller
passa `{ meta, transaction: { patches: entry.meta.undoneTransactionPatches } }` (Step 4).
- [ ] **Step 4: ligar no controller.** Em `undo()` (≈1681) e `redo()` guardar na meta da entrada os patches ORIGINAIS:
  `transactionLedgerRef.current.stage(transaction, { operation: 'undo', transactionId: latest.transaction.id, undoneTransactionPatches: latest.transaction.patches, ... })`
  e no `redo` `redoneTransactionPatches: next.transaction.patches`. Em `releaseSettled`, trocar
  `if (entry.meta.responsiveManifest) replaceResponsiveManifest(entry.meta.responsiveManifest);` por:

```js
        if (entry.meta.responsiveManifest || entry.meta.undoneTransactionPatches || entry.meta.redoneTransactionPatches) {
          // os patches MONTADOS aqui (com a marca de tela), não os devolvidos pela ponte
          const patches = entry.meta.undoneTransactionPatches || entry.meta.redoneTransactionPatches || entry.transaction.patches;
          replaceResponsiveManifest(responsiveManifestForSettlement(responsiveManifestRef.current, { meta: entry.meta, transaction: { patches } }));
        }
```
  e importar `responsiveManifestForSettlement`.
- [ ] **Step 5:** `npx vitest run lib/motion-editor components/motion-editor > /tmp/t1.log 2>&1; tail -4 /tmp/t1.log` → tudo verde.
- [ ] **Step 6:** auditoria do Astra (bundle: diff + "perda de edição na tabela por tela"); commit
  `fix(motion-editor): per-screen table settles by change, not by snapshot`.

---

### Task 2: Montador de lote por elemento × propriedade (Astra r1 #3, r2 #1)

**Files:**
- Create: `lib/motion-editor/responsive-edit.js` (mover `responsivePropertyName`, `responsiveBindingFromPatch`,
  `responsiveStoredValue` de `useNativeMotionController.js` 168–192, sem mudar o comportamento; o controller passa a importar)
- Create: `lib/motion-editor/overlay-batch.js`
- Test: `lib/motion-editor/overlay-batch.test.js`

**Interfaces:**
- Consumes: `responsive-manifest.js` (`parseResponsiveManifest`, `resolveResponsiveProperty`, `responsivePropertyKey`,
  `setResponsivePropertyMode`, `setResponsivePropertyValue`, `withResponsiveMetadata`), `protocol.js` `createPatch`.
- Produces: `buildOverlayBatch({ manifest, deviceId, changes, descriptorFor }) → { ok:true, patches, nextManifest } | { ok:false, reason }`
  — `changes = [{ elementId, property, before, value }]` (property em hífen); `descriptorFor(elementId, property) → descriptor|null`.

- [ ] **Step 1: testes que falham**

```js
// lib/motion-editor/overlay-batch.test.js
import { describe, expect, it } from 'vitest';
import { buildOverlayBatch } from './overlay-batch.js';
import { createResponsiveManifest, responsivePropertyKey, setResponsivePropertyValue, responsiveManifestAfterPatches } from './responsive-manifest.js';

const comValor = (m, el, prop, value) => setResponsivePropertyValue(m, { propertyKey: responsivePropertyKey(el, prop), deviceId: 'desktop', value, descriptor: { mode: 'shared' } });

describe('montador de lote da camada', () => {
  it('cada par elemento × propriedade leva a SUA chave e o SEU antes/depois (r2 #1)', () => {
    let m = comValor(createResponsiveManifest(), 'u-a', 'width', '100px');
    m = comValor(m, 'u-a', 'height', '100px');
    const r = buildOverlayBatch({ manifest: m, deviceId: 'desktop', descriptorFor: () => null, changes: [
      { elementId: 'u-a', property: 'width', before: '100px', value: '150px' },
      { elementId: 'u-a', property: 'height', before: '100px', value: '200px' },
      { elementId: 'u-pai', property: 'overflow', before: '', value: 'visible' },
    ] });
    expect(r.ok).toBe(true);
    expect(r.patches.map((p) => p.responsive.propertyKey)).toEqual([
      responsivePropertyKey('u-a', 'width'), responsivePropertyKey('u-a', 'height'), responsivePropertyKey('u-pai', 'overflow'),
    ]);
    // reabrir reconcilia a tabela DEPOIS dos patches: as duas medidas novas sobrevivem
    const reaberta = responsiveManifestAfterPatches(m, r.patches, 'forward');
    expect(reaberta.properties[responsivePropertyKey('u-a', 'width')]).toEqual(r.nextManifest.properties[responsivePropertyKey('u-a', 'width')]);
    expect(reaberta.properties[responsivePropertyKey('u-a', 'height')]).toEqual(r.nextManifest.properties[responsivePropertyKey('u-a', 'height')]);
    expect(r.patches.every((p) => p.kind === 'style' && p.before !== undefined)).toBe(true);
  });
  it('propriedade em modo calculado recusa o lote inteiro', () => {
    const r = buildOverlayBatch({ manifest: createResponsiveManifest(), deviceId: 'desktop',
      descriptorFor: () => ({ mode: 'computed' }),
      changes: [{ elementId: 'u-a', property: 'width', before: '', value: '10px' }] });
    expect(r).toEqual({ ok: false, reason: 'computed_scope' });
  });
  it('lote vazio ou sem efeito é recusado', () => {
    expect(buildOverlayBatch({ manifest: null, deviceId: 'desktop', descriptorFor: () => null, changes: [] })).toEqual({ ok: false, reason: 'empty_batch' });
    expect(buildOverlayBatch({ manifest: null, deviceId: 'desktop', descriptorFor: () => null, changes: [{ elementId: 'u-a', property: 'width', before: '10px', value: '10px' }] })).toEqual({ ok: false, reason: 'no_effect' });
  });
});
```
- [ ] **Step 2:** `npx vitest run lib/motion-editor/overlay-batch.test.js` → FAIL (módulo inexistente).
- [ ] **Step 3: implementar** (`responsive-edit.js` = as três funções copiadas verbatim do controller com `export`;
  o controller importa delas e apaga as cópias locais)

```js
// lib/motion-editor/overlay-batch.js — a edição de um gesto da camada (spec §6.2.3). Igual ao caminho do painel
// (`applyResponsiveEdit`), mas POR PAR elemento × propriedade: o do painel usa `selected.id` e a marca de UMA
// propriedade para todos os patches, e ao reabrir a altura voltava ao valor antigo (Astra r2 #1).
import { createPatch } from './protocol.js';
import { parseResponsiveManifest, resolveResponsiveProperty, responsivePropertyKey, setResponsivePropertyMode, setResponsivePropertyValue, withResponsiveMetadata } from './responsive-manifest.js';
import { responsiveBindingFromPatch, responsivePropertyName, responsiveStoredValue } from './responsive-edit.js';

export function buildOverlayBatch({ manifest, deviceId, changes, descriptorFor }) {
  const efetivas = (changes || []).filter((c) => c && c.elementId && c.property && String(c.before ?? '') !== String(c.value ?? ''));
  if (!changes || !changes.length) return { ok: false, reason: 'empty_batch' };
  if (!efetivas.length) return { ok: false, reason: 'no_effect' };
  let atual = parseResponsiveManifest(manifest);
  const patches = [];
  for (const change of efetivas) {
    const normalized = responsivePropertyName(change.property);
    const descriptor = descriptorFor(change.elementId, normalized) || null;
    const propertyKey = responsivePropertyKey(change.elementId, normalized);
    const beforeEntry = atual.properties?.[propertyKey] || null;
    const patch = createPatch({ elementId: change.elementId, kind: 'style', property: change.property, before: change.before ?? '', value: change.value ?? '' });
    const binding = responsiveBindingFromPatch(patch);
    const scope = resolveResponsiveProperty(atual, { propertyKey, deviceId, fallbackValue: patch.before, descriptor });
    if (scope?.mode === 'computed' || descriptor?.mode === 'computed') return { ok: false, reason: 'computed_scope' };
    let base = atual;
    if (!beforeEntry && scope?.mode === 'per-device') {
      base = setResponsivePropertyMode(base, { propertyKey, mode: 'per-device', deviceId, visibleValue: patch.before, binding, descriptor });
    }
    atual = setResponsivePropertyValue(base, {
      propertyKey, deviceId, value: responsiveStoredValue(patch, patch.value), binding,
      descriptor: { ...descriptor, mode: scope?.mode || descriptor?.mode || 'shared' }, provenance: scope?.provenance,
    });
    const afterEntry = atual.properties[propertyKey];
    patches.push(withResponsiveMetadata(patch, { propertyKey, mode: afterEntry.mode, deviceId, beforeEntry, afterEntry }));
  }
  return { ok: true, patches, nextManifest: atual };
}
```
- [ ] **Step 4:** `npx vitest run lib/motion-editor/overlay-batch.test.js components/motion-editor` → verde (o controller
  continua passando com as funções movidas).
- [ ] **Step 5:** Astra; commit `feat(motion-editor): per element×property batch builder for overlay gestures`.

---

### Task 3: Contas puras da camada (`overlay-math.js`)

**Files:** Create `lib/motion-editor/overlay-math.js`; Test `lib/motion-editor/overlay-math.test.js`.

**Interfaces — Produces** (todas autossuficientes; `alvo` é `'self'` ou `'parent'`; propriedades em hífen):
- `GUIAS` (constante, objeto congelado) — ver código.
- `resizeChanges({ dir, dx, dy, start }) → [{alvo, property, value}]` — `start = { width, height, marginLeft, marginTop, left, top, position }`.
- `unlockChanges({ dir, computed, rect, parent }) → [{alvo, property, value}]` — `computed = { maxWidth, maxHeight, minWidth, minHeight, width, height, flexGrow, boxSizing }`, `parent = { display, overflow } | null`.
- `guideAxis(key, parentFlexDirection) → 'x'|'y'`
- `guideChanges({ key, start, dx, dy, axis, mods, initial }) → { value, changes }` — `mods = { shift, alt, meta, ctrl }`, `initial = { mt, mr, … }` (valores calculados em px).
- `cornerChanges({ corner, start, dx, dy, mods }) → changes` — `start = { marginTop, marginRight, marginBottom, marginLeft }`.
- `parseGuideInput({ text, current, rootFontSize, fontSize, parentWidth }) → number|null`
- `nudgeValue({ key, arrow, axis, mods, current }) → number|null`
- `placeControls({ box, viewport, handle, label }) → { handles: {nw:{x,y},…}, label: {x,y,inside} }`

- [ ] **Step 1: testes que falham** (paridade com o antigo, linha a linha)

```js
// lib/motion-editor/overlay-math.test.js
import { describe, expect, it } from 'vitest';
import * as M from './overlay-math.js';

const start = { width: 200, height: 100, marginLeft: 10, marginTop: 5, left: 0, top: 0, position: 'static' };
describe('redimensionar (editor.js 10738-10830)', () => {
  it('leste aumenta a largura e grava as duas medidas', () => {
    expect(M.resizeChanges({ dir: 'e', dx: 30, dy: 0, start })).toEqual([
      { alvo: 'self', property: 'width', value: '230px' }, { alvo: 'self', property: 'height', value: '100px' }]);
  });
  it('oeste compensa na margem (elemento não posicionado) e mantém o lado direito', () => {
    expect(M.resizeChanges({ dir: 'w', dx: 30, dy: 0, start })).toContainEqual({ alvo: 'self', property: 'margin-left', value: '40px' });
  });
  it('norte compensa no top quando posicionado', () => {
    expect(M.resizeChanges({ dir: 'n', dx: 0, dy: 20, start: { ...start, position: 'relative', top: 8 } })).toContainEqual({ alvo: 'self', property: 'top', value: '28px' });
  });
  it('mínimo de 20 px', () => {
    expect(M.resizeChanges({ dir: 'se', dx: -500, dy: -500, start })[0]).toEqual({ alvo: 'self', property: 'width', value: '20px' });
  });
});
describe('destravar (editor.js 10671-10736)', () => {
  const computed = { maxWidth: '300px', maxHeight: 'none', minWidth: '50px', minHeight: '0px', width: '200px', height: '100px', flexGrow: '1', boxSizing: 'content-box' };
  it('tira os limites, zera o mínimo no eixo, solta o flex-grow, conta a borda e libera o corte do pai', () => {
    expect(M.unlockChanges({ dir: 'e', computed, rect: { width: 200, height: 100 }, parent: { display: 'flex', overflow: 'hidden' } })).toEqual([
      { alvo: 'self', property: 'max-width', value: 'none' },
      { alvo: 'self', property: 'min-width', value: '0' },
      { alvo: 'self', property: 'flex-grow', value: '0' },
      { alvo: 'self', property: 'box-sizing', value: 'border-box' },
      { alvo: 'parent', property: 'overflow', value: 'visible' },
    ]);
  });
  it('nada a destravar → lista vazia', () => {
    expect(M.unlockChanges({ dir: 's', computed: { ...computed, maxWidth: 'none', minWidth: '0px', flexGrow: '0', boxSizing: 'border-box' }, rect: { width: 1, height: 1 }, parent: null })).toEqual([]);
  });
});
describe('guias (editor.js 9035-9157)', () => {
  const initial = { mt: 8, mr: 8, mb: 8, ml: 8, pt: 4, pr: 4, pb: 4, pl: 4 };
  it('margem de baixo cresce para baixo; Cmd encaixa de 8', () => {
    expect(M.guideChanges({ key: 'mb', start: 8, dx: 0, dy: 13, axis: 'y', mods: {}, initial }).value).toBe(21);
    expect(M.guideChanges({ key: 'mb', start: 8, dx: 0, dy: 13, axis: 'y', mods: { meta: true }, initial }).value).toBe(24);
  });
  it('Shift muda os 4 lados; Alt espelha', () => {
    expect(M.guideChanges({ key: 'pt', start: 4, dx: 0, dy: 6, axis: 'y', mods: { shift: true }, initial }).changes.map((c) => c.property))
      .toEqual(['padding-top', 'padding-right', 'padding-bottom', 'padding-left']);
    expect(M.guideChanges({ key: 'ml', start: 8, dx: -4, dy: 0, axis: 'x', mods: { alt: true }, initial }).changes)
      .toEqual([{ alvo: 'self', property: 'margin-left', value: '12px' }, { alvo: 'self', property: 'margin-right', value: '12px' }]);
  });
  it('nunca abaixo de zero; gap escreve só o longhand do eixo e mexe no pai', () => {
    expect(M.guideChanges({ key: 'pt', start: 4, dx: 0, dy: -50, axis: 'y', mods: {}, initial }).value).toBe(0);
    expect(M.guideChanges({ key: 'gap', start: 10, dx: 5, dy: 0, axis: 'x', mods: {}, initial }).changes).toEqual([{ alvo: 'parent', property: 'column-gap', value: '15px' }]);
    expect(M.guideChanges({ key: 'gap', start: 10, dx: 0, dy: 5, axis: 'y', mods: {}, initial }).changes).toEqual([{ alvo: 'parent', property: 'row-gap', value: '15px' }]);
  });
  it('eixo do gap pelo flex-direction do pai', () => {
    expect(M.guideAxis('gap', 'row-reverse')).toBe('x'); expect(M.guideAxis('gap', 'column')).toBe('y'); expect(M.guideAxis('ml', 'column')).toBe('x');
  });
});
describe('cantos (editor.js 9160-9220)', () => {
  it('sudeste muda margem de baixo e direita, com encaixe de 8', () => {
    expect(M.cornerChanges({ corner: 'se', start: { marginTop: 0, marginRight: 4, marginBottom: 4, marginLeft: 0 }, dx: 5, dy: 13, mods: { ctrl: true } })).toEqual([
      { alvo: 'self', property: 'margin-bottom', value: '16px' }, { alvo: 'self', property: 'margin-right', value: '8px' }]);
  });
});
describe('campo de digitar (editor.js 8963-9033)', () => {
  const base = { current: 12, rootFontSize: 16, fontSize: 20, parentWidth: 400 };
  it.each([['20', 20], ['20px', 20], ['1.5rem', 24], ['2em', 40], ['10%', 40], ['+5', 17], ['-3', 9], ['-50', 0], ['abc', null], ['', null]])('%s → %s', (text, esperado) => {
    expect(M.parseGuideInput({ ...base, text })).toBe(esperado);
  });
});
describe('setas (editor.js 10493-10529)', () => {
  it('seta para baixo na margem de baixo aumenta 1; Shift 10; Cmd 8; seta do outro eixo não faz nada', () => {
    expect(M.nudgeValue({ key: 'mb', arrow: 'ArrowDown', axis: 'y', mods: {}, current: 4 })).toBe(5);
    expect(M.nudgeValue({ key: 'mb', arrow: 'ArrowDown', axis: 'y', mods: { shift: true }, current: 4 })).toBe(14);
    expect(M.nudgeValue({ key: 'mt', arrow: 'ArrowDown', axis: 'y', mods: { meta: true }, current: 4 })).toBe(0);
    expect(M.nudgeValue({ key: 'mb', arrow: 'ArrowLeft', axis: 'y', mods: {}, current: 4 })).toBeNull();
  });
});
describe('perto da borda (Astra r1 #7)', () => {
  it('rótulo vai para dentro e alças ficam inteiras quando a caixa encosta no topo/esquerda', () => {
    const r = M.placeControls({ box: { x: 0, y: 0, width: 300, height: 120 }, viewport: { width: 1280, height: 800 }, handle: 12, label: { width: 60, height: 18 } });
    expect(r.label.inside).toBe(true);
    expect(r.handles.nw).toEqual({ x: 0, y: 0 });
    expect(r.handles.se).toEqual({ x: 294, y: 114 });
  });
  it('longe da borda: paridade (alça a −6 px, rótulo acima)', () => {
    const r = M.placeControls({ box: { x: 100, y: 100, width: 300, height: 120 }, viewport: { width: 1280, height: 800 }, handle: 12, label: { width: 60, height: 18 } });
    expect(r.handles.nw).toEqual({ x: 94, y: 94 });
    expect(r.label.inside).toBe(false);
  });
});
describe('serializável', () => {
  it('cada função funciona recriada só do texto (sem nada de fora)', () => {
    for (const [nome, fn] of Object.entries(M)) {
      if (typeof fn !== 'function') continue;
      const recriada = new Function(`return (${fn.toString()})`)();
      expect(typeof recriada, nome).toBe('function');
    }
    const r = new Function(`return (${M.resizeChanges.toString()})`)()({ dir: 'e', dx: 30, dy: 0, start });
    expect(r[0].value).toBe('230px');
  });
});
```
- [ ] **Step 2:** `npx vitest run lib/motion-editor/overlay-math.test.js` → FAIL (módulo inexistente).
- [ ] **Step 3: implementar** (cada função copia as tabelas que usa — sem constantes de módulo dentro das funções)

```js
// lib/motion-editor/overlay-math.js — contas da camada de alças e guias (spec 2026-10-20 §5), portadas do editor antigo
// (packages/editor-core/src/editor.js). ⚠️ Cada função é AUTOSSUFICIENTE: a ponte as serializa com toString() e injeta
// na página; uma referência a algo de fora quebraria só lá dentro (o teste "serializável" pega).

export const GUIAS = Object.freeze({
  props: { mt: 'margin-top', mr: 'margin-right', mb: 'margin-bottom', ml: 'margin-left', pt: 'padding-top', pr: 'padding-right', pb: 'padding-bottom', pl: 'padding-left' },
  eixo: { mt: 'y', mb: 'y', pt: 'y', pb: 'y', ml: 'x', mr: 'x', pl: 'x', pr: 'x', gap: 'auto' },
  sentido: { mt: -1, mb: 1, pt: 1, pb: -1, ml: -1, mr: 1, pl: 1, pr: -1, gap: 1 },
  espelho: { mt: 'mb', mb: 'mt', ml: 'mr', mr: 'ml', pt: 'pb', pb: 'pt', pl: 'pr', pr: 'pl' },
});

export function resizeChanges({ dir, dx, dy, start }) {
  let w = start.width; let h = start.height;
  if (dir.indexOf('e') !== -1) w += dx;
  if (dir.indexOf('w') !== -1) w -= dx;
  if (dir.indexOf('s') !== -1) h += dy;
  if (dir.indexOf('n') !== -1) h -= dy;
  const newW = Math.max(20, Math.round(w)); const newH = Math.max(20, Math.round(h));
  const usesCoords = ['absolute', 'fixed', 'sticky', 'relative'].indexOf(start.position) !== -1;
  const out = [{ alvo: 'self', property: 'width', value: `${newW}px` }, { alvo: 'self', property: 'height', value: `${newH}px` }];
  if (dir.indexOf('w') !== -1) out.push(usesCoords
    ? { alvo: 'self', property: 'left', value: `${Math.round(start.left + (start.width - newW))}px` }
    : { alvo: 'self', property: 'margin-left', value: `${Math.round(start.marginLeft + (start.width - newW))}px` });
  if (dir.indexOf('n') !== -1) out.push(usesCoords
    ? { alvo: 'self', property: 'top', value: `${Math.round(start.top + (start.height - newH))}px` }
    : { alvo: 'self', property: 'margin-top', value: `${Math.round(start.marginTop + (start.height - newH))}px` });
  return out;
}

export function unlockChanges({ dir, computed, rect, parent }) {
  const out = [];
  if (computed.maxWidth !== 'none' && computed.maxWidth !== '0px') out.push({ alvo: 'self', property: 'max-width', value: 'none' });
  if (computed.maxHeight !== 'none' && computed.maxHeight !== '0px') out.push({ alvo: 'self', property: 'max-height', value: 'none' });
  if ((dir.indexOf('w') !== -1 || dir.indexOf('e') !== -1) && computed.minWidth && computed.minWidth !== '0px') out.push({ alvo: 'self', property: 'min-width', value: '0' });
  if ((dir.indexOf('n') !== -1 || dir.indexOf('s') !== -1) && computed.minHeight && computed.minHeight !== '0px') out.push({ alvo: 'self', property: 'min-height', value: '0' });
  if (computed.width === 'auto' || String(computed.width).indexOf('%') !== -1) out.push({ alvo: 'self', property: 'width', value: `${Math.round(rect.width)}px` });
  if (computed.height === 'auto' || String(computed.height).indexOf('%') !== -1) out.push({ alvo: 'self', property: 'height', value: `${Math.round(rect.height)}px` });
  const paiFlex = parent && (parent.display === 'flex' || parent.display === 'inline-flex');
  if (paiFlex && (parseFloat(computed.flexGrow) || 0) > 0) out.push({ alvo: 'self', property: 'flex-grow', value: '0' });
  if (computed.boxSizing !== 'border-box') out.push({ alvo: 'self', property: 'box-sizing', value: 'border-box' });
  if (parent && parent.overflow === 'hidden') out.push({ alvo: 'parent', property: 'overflow', value: 'visible' });
  return out;
}

export function guideAxis(key, parentFlexDirection) {
  const eixo = { mt: 'y', mb: 'y', pt: 'y', pb: 'y', ml: 'x', mr: 'x', pl: 'x', pr: 'x', gap: 'auto' }[key];
  if (eixo !== 'auto') return eixo;
  return parentFlexDirection === 'row' || parentFlexDirection === 'row-reverse' ? 'x' : 'y';
}

export function guideChanges({ key, start, dx, dy, axis, mods, initial }) {
  const props = { mt: 'margin-top', mr: 'margin-right', mb: 'margin-bottom', ml: 'margin-left', pt: 'padding-top', pr: 'padding-right', pb: 'padding-bottom', pl: 'padding-left' };
  const sentido = { mt: -1, mb: 1, pt: 1, pb: -1, ml: -1, mr: 1, pl: 1, pr: -1, gap: 1 }[key];
  const espelho = { mt: 'mb', mb: 'mt', ml: 'mr', mr: 'ml', pt: 'pb', pb: 'pt', pl: 'pr', pr: 'pl' }[key];
  const grupo = ['mt', 'mr', 'mb', 'ml'].indexOf(key) !== -1 ? ['mt', 'mr', 'mb', 'ml'] : ['pt', 'pr', 'pb', 'pl'].indexOf(key) !== -1 ? ['pt', 'pr', 'pb', 'pl'] : null;
  const delta = (axis === 'x' ? dx : dy) * sentido;
  let value = Math.max(0, Math.round(start + delta));
  if (mods && (mods.meta || mods.ctrl)) value = Math.round(value / 8) * 8;
  const px = `${value}px`;
  if (key === 'gap') return { value, changes: [{ alvo: 'parent', property: axis === 'x' ? 'column-gap' : 'row-gap', value: px }] };
  if (mods && mods.shift && grupo) return { value, changes: grupo.map((k) => ({ alvo: 'self', property: props[k], value: px })) };
  if (mods && mods.alt && espelho) return { value, changes: [{ alvo: 'self', property: props[key], value: px }, { alvo: 'self', property: props[espelho], value: px }] };
  void initial;
  return { value, changes: [{ alvo: 'self', property: props[key], value: px }] };
}

export function cornerChanges({ corner, start, dx, dy, mods }) {
  const cfg = {
    nw: { props: ['margin-top', 'margin-left'], y: 'marginTop', x: 'marginLeft', signY: -1, signX: -1 },
    ne: { props: ['margin-top', 'margin-right'], y: 'marginTop', x: 'marginRight', signY: -1, signX: 1 },
    se: { props: ['margin-bottom', 'margin-right'], y: 'marginBottom', x: 'marginRight', signY: 1, signX: 1 },
    sw: { props: ['margin-bottom', 'margin-left'], y: 'marginBottom', x: 'marginLeft', signY: 1, signX: -1 },
  }[corner];
  let ny = Math.max(0, Math.round(start[cfg.y] + dy * cfg.signY));
  let nx = Math.max(0, Math.round(start[cfg.x] + dx * cfg.signX));
  if (mods && (mods.meta || mods.ctrl)) { ny = Math.round(ny / 8) * 8; nx = Math.round(nx / 8) * 8; }
  return [{ alvo: 'self', property: cfg.props[0], value: `${ny}px` }, { alvo: 'self', property: cfg.props[1], value: `${nx}px` }];
}

export function parseGuideInput({ text, current, rootFontSize, fontSize, parentWidth }) {
  const v = String(text || '').trim();
  let num = null;
  if (/^[+-]\s*[0-9.]+$/.test(v)) { const d = parseFloat(v.replace(/\s+/g, '')); num = Number.isNaN(d) ? null : current + d; }
  else {
    const m = v.match(/^([0-9.]+)\s*(px|rem|em|%)?$/i);
    if (m) {
      const n = parseFloat(m[1]); const unit = (m[2] || 'px').toLowerCase();
      if (!Number.isNaN(n)) num = unit === 'px' ? n : unit === 'rem' ? n * (rootFontSize || 16) : unit === 'em' ? n * (fontSize || 16) : (n / 100) * (parentWidth || 0);
    }
  }
  return num == null ? null : Math.max(0, Math.round(num));
}

export function nudgeValue({ key, arrow, axis, mods, current }) {
  const sentido = { mt: -1, mb: 1, pt: 1, pb: -1, ml: -1, mr: 1, pl: 1, pr: -1, gap: 1 }[key];
  const tela = axis === 'y' ? (arrow === 'ArrowDown' ? 1 : arrow === 'ArrowUp' ? -1 : 0) : (arrow === 'ArrowRight' ? 1 : arrow === 'ArrowLeft' ? -1 : 0);
  if (!tela) return null;
  const passo = mods && mods.shift ? 10 : (mods && (mods.meta || mods.ctrl)) ? 8 : 1;
  return Math.max(0, current + tela * sentido * passo);
}

export function placeControls({ box, viewport, handle, label }) {
  const meio = handle / 2;
  const prender = (v, min, max) => Math.min(Math.max(v, min), Math.max(min, max));
  const pos = (cx, cy) => ({ x: Math.round(prender(cx - meio, 0, viewport.width - handle)), y: Math.round(prender(cy - meio, 0, viewport.height - handle)) });
  const l = box.x; const t = box.y; const r = box.x + box.width; const b = box.y + box.height; const mx = box.x + box.width / 2; const my = box.y + box.height / 2;
  const handles = { nw: pos(l, t), n: pos(mx, t), ne: pos(r, t), e: pos(r, my), se: pos(r, b), s: pos(mx, b), sw: pos(l, b), w: pos(l, my) };
  const inside = t - label.height - 4 < 0;
  return { handles, label: { x: Math.round(prender(l, 0, viewport.width - label.width)), y: Math.round(inside ? t + 4 : t - label.height - 4), inside } };
}
```
⚠️ `resizeChanges`, `guideChanges`… usam literais repetidos de propósito (autossuficiência). `GUIAS` é só para o
módulo de fora (testes/host); a camada recebe as funções, não a constante.
- [ ] **Step 4:** `npx vitest run lib/motion-editor/overlay-math.test.js` → verde. Conferir que `placeControls` dá
  `nw {x:94,y:94}` longe da borda (paridade `posMap` −6 px).
- [ ] **Step 5:** Astra; commit `feat(motion-editor): pure, serializable math for handles and spacing guides`.

---

### Task 4: Camada injetada, isolada e desenhando a seleção (sem arraste)

**Files:**
- Create: `lib/motion-editor/runtime-overlay-source.js` (`export function instalarCamada(ponte, M)`)
- Modify: `lib/motion-editor/runtime-bridge-source.js` — `nativeMotionRuntimeBridge(instalarCamadaFn, M)`; `getRuntimeBridgeSource()`;
  `ehNosso`; pular a camada em `chooseElement` (6938), `resolveVisibleTarget` (6922), `collectAssets` (6248),
  `collectDocumentProfile` (6215) e em TODO handler de documento de `boot()` (8841–8972); `installStyles` deixa de pintar
  o contorno quando a camada está ativa; comando `set-overlay-scale`.
- Test: `lib/motion-editor/runtime-overlay.test.js` (jsdom).

**Interfaces:**
- Consumes: Task 3 (`M` = `{ resizeChanges, unlockChanges, guideAxis, guideChanges, cornerChanges, parseGuideInput, nudgeValue, placeControls }`).
- Produces (ponte → camada, objeto `ponte`): `doc`, `selecionado()`, `aoMudar(cb)` (seleção/modo/edição de texto),
  `modo()`, `editandoTexto()`, `idDe(el)`, `selecionarEm(x, y)`, `escala()`; e (Task 5) `elegivel`, `iniciarGesto`,
  `previa`, `terminarGesto`, `cancelarGesto`, `gestoVivo()`.
- Produces (camada → ponte): `{ raiz, redesenhar(), destruir(), alternarGuias(), definirEscala(n) }`.

- [ ] **Step 1: teste que falha** (boot igual ao de `runtime-bridge-source.test.js`, copiado para o arquivo novo)

```js
// lib/motion-editor/runtime-overlay.test.js
import { afterEach, describe, expect, it } from 'vitest';
import { MOTION_EDITOR_PROTOCOL, MOTION_EDITOR_PROTOCOL_V2, SUPPORTED_MOTION_EDITOR_PROTOCOLS, commandV2 } from './protocol.js';
import { getRuntimeBridgeSource } from './runtime-bridge-source.js';

function boot() {
  document.body.innerHTML = '<main id="m"><div id="a" data-uncraft-id="u-a" style="width:200px">A</div><div id="b" data-uncraft-id="u-b">B</div></main>';
  const config = document.createElement('script'); config.type = 'application/json'; config.dataset.uncraftRuntimeConfig = 'true';
  config.textContent = JSON.stringify({ initialManifest: { schemaVersion: 2, baseBundleId: 'bundle-fixture', transactions: [] }, runtimeSessionId: 'session-fixture', runtimeFingerprint: 'sha256:fixture', sessionNonce: 'nonce-fixture-123456' });
  document.head.appendChild(config);
  const messages = []; const original = window.postMessage; window.postMessage = (m) => messages.push(m);
  window.eval(getRuntimeBridgeSource());
  const ready = messages.filter((m) => m.type === 'runtime-ready').pop();
  const context = { sessionNonce: 'nonce-fixture-123456', runtimeGeneration: ready.payload.runtimeGeneration, bundleId: 'bundle-fixture', sessionId: 'session-fixture' };
  const origin = 'https://app.uncraft.test';
  window.dispatchEvent(new MessageEvent('message', { source: window, origin, data: { protocol: MOTION_EDITOR_PROTOCOL, protocolVersion: MOTION_EDITOR_PROTOCOL, supportedProtocols: SUPPORTED_MOTION_EDITOR_PROTOCOLS, source: 'host', type: 'negotiate-protocol', requestId: 'n1', ...context, payload: { selectedProtocol: MOTION_EDITOR_PROTOCOL_V2 } } }));
  const send = (type, payload, requestId = `r-${Math.random()}`) => window.dispatchEvent(new MessageEvent('message', { source: window, origin, data: commandV2(type, payload, { ...context, requestId }) }));
  return { messages, send, restore: () => { window.__uncraftMotionBridge?.teardown?.(); window.postMessage = original; document.head.querySelectorAll('[data-uncraft-runtime-config]').forEach((n) => n.remove()); } };
}

describe('camada de alças e guias — instalação e isolamento', () => {
  let rt; afterEach(() => rt?.restore());
  it('instala UMA raiz <uncraft-overlay> com sombra fechada e pointer-events none', () => {
    rt = boot();
    const raizes = document.querySelectorAll('uncraft-overlay');
    expect(raizes).toHaveLength(1);
    expect(raizes[0].shadowRoot).toBeNull();               // fechada
    expect(raizes[0].style.pointerEvents).toBe('none');
    expect(raizes[0].hasAttribute('data-uncraft-overlay')).toBe(true);
  });
  it('a camada não aparece no inventário nem no perfil do documento', () => {
    rt = boot(); rt.send('refresh-inventory', {});
    const inv = rt.messages.filter((m) => m.type === 'inventory-changed').pop();
    expect(JSON.stringify(inv.payload)).not.toMatch(/uncraft-overlay/);
  });
  it('selecionar troca o contorno pela caixa da camada', () => {
    rt = boot(); rt.send('select-element', { elementId: 'u-a' });
    const css = Array.from(document.querySelectorAll('style[data-uncraft-runtime-bridge]')).map((s) => s.textContent).join('\n');
    expect(css).toMatch(/html:not\(\[data-uncraft-overlay-ativa\]\)\[data-uncraft-editor-mode="edit"\] \[data-uncraft-selected="true"\]/);
    expect(document.documentElement.dataset.uncraftOverlayAtiva).toBe('true');
    expect(window.__uncraftMotionBridge.overlay.estado().caixaVisivel).toBe(true);
  });
  it('set-overlay-scale chega à camada', () => {
    rt = boot(); rt.send('set-overlay-scale', { scale: 0.5 });
    expect(window.__uncraftMotionBridge.overlay.estado().escala).toBe(0.5);
  });
  it('clique na raiz da camada nunca vira seleção dela', () => {
    rt = boot(); const raiz = document.querySelector('uncraft-overlay');
    raiz.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    const sel = rt.messages.filter((m) => m.type === 'selection-changed').pop();
    expect(sel?.payload?.element?.tagName).not.toBe('uncraft-overlay');
  });
});
```
- [ ] **Step 2:** `npx vitest run lib/motion-editor/runtime-overlay.test.js` → FAIL (nenhuma `uncraft-overlay`).
- [ ] **Step 3: serialização conjunta** — em `runtime-bridge-source.js`, no fim:

```js
import { instalarCamada } from './runtime-overlay-source.js';
import * as M from './overlay-math.js';

const FUNCOES_DA_CAMADA = ['resizeChanges', 'unlockChanges', 'guideAxis', 'guideChanges', 'cornerChanges', 'parseGuideInput', 'nudgeValue', 'placeControls'];
export function getRuntimeBridgeSource() {
  const contas = FUNCOES_DA_CAMADA.map((nome) => `${nome}: (${M[nome].toString()})`).join(',\n');
  return `;(function(){ const M = {${contas}}; const instalar = (${instalarCamada.toString()}); (${nativeMotionRuntimeBridge.toString()})(instalar, M); })();`;
}
```
⚠️ O cabeçalho do arquivo diz "Keep this file free of imports": a regra é que NADA DENTRO de
`nativeMotionRuntimeBridge` use import — os imports do módulo só montam o texto. Atualizar o comentário do cabeçalho.
- [ ] **Step 4: a função da ponte recebe a camada.** `function nativeMotionRuntimeBridge(instalarCamadaFn, M) {` e, em
  `boot()`, depois de `installStyles()`:

```js
    const raizDaCamada = { el: null };
    const ehNosso = (no) => {
      const raiz = raizDaCamada.el;
      if (!raiz || !no) return false;
      if (no === raiz) return true;
      try { return typeof raiz.contains === 'function' && raiz.contains(no); } catch (_) { return false; }
    };
    ehNossoRef.fn = ehNosso;   // `let ehNossoRef = { fn: () => false }` no topo da ponte, usado pelos leitores
    if (typeof instalarCamadaFn === 'function') {
      try {
        camada = instalarCamadaFn(ponteDaCamada(), M);
        raizDaCamada.el = camada && camada.raiz;
      } catch (_) { camada = null; }
    }
```
  com `let camada = null;` no topo e `ponteDaCamada()` devolvendo o objeto `ponte` da Interface (as funções de gesto
  entram na Task 5 — por ora `elegivel: () => ({ ok: false, motivo: 'not_ready' })`). `selecionado()` lê
  `findElement(selectedId)`; `aoMudar(cb)` guarda o callback e `select()`, `enterPreviewMode()`, `leavePreviewMode()`,
  `enterInlineTextEdit()` e `finishInlineTextEdit()` chamam `notificarCamada()`.
- [ ] **Step 5: leitores pulam a camada.** No início de `chooseElement`, `resolveVisibleTarget`: `if (ehNossoRef.fn(target)) return null;`.
  Em `collectAssets` e `collectDocumentProfile`, filtrar `el => !ehNossoRef.fn(el)` em todo `querySelectorAll`. Em cada
  `on(document, …)` de `boot()` (pointermove, pointerleave, pointerdown, pointerup, click, dblclick, keydown,
  focusout, submit, auxclick): primeira linha `if (ehNossoRef.fn(event.target)) return;` (keydown: só se o alvo é a camada).
- [ ] **Step 6: contorno → caixa.** Em `installStyles`, os dois blocos de `outline` passam a valer só com
  `html:not([data-uncraft-overlay-ativa])`; a camada marca `document.documentElement.dataset.uncraftOverlayAtiva = 'true'`
  ao instalar e apaga ao destruir. Comando novo no despacho: `else if (message.type === 'set-overlay-scale') camada?.definirEscala(Number(payload.scale) || 1);`.
  `window.__uncraftMotionBridge.overlay = camada && { estado: camada.estado }` (gancho de diagnóstico/teste).
- [ ] **Step 7: a camada** (`runtime-overlay-source.js`, autossuficiente):

```js
// Camada de alças e guias (spec 2026-10-20 §4-§5). Roda DENTRO da página, serializada junto com a ponte: nada aqui pode
// referenciar algo de fora desta função. Só desenha e faz prévia; quem confirma é o editor de fora (§6.2).
export function instalarCamada(ponte, M) {
  const doc = ponte.doc;
  const raiz = doc.createElement('uncraft-overlay');
  raiz.setAttribute('data-uncraft-overlay', '');
  Object.assign(raiz.style, { position: 'fixed', inset: '0', zIndex: '2147483647', pointerEvents: 'none', display: 'block' });
  const sombra = raiz.attachShadow({ mode: 'closed' });
  const estilo = doc.createElement('style');
  estilo.textContent = CSS_DA_CAMADA;   // const no topo da função: o CSS de editor.css 1747-1994 com os nomes trocados (Step 8)
  sombra.appendChild(estilo);
  const mk = (cls) => { const d = doc.createElement('div'); d.className = cls; sombra.appendChild(d); return d; };
  const hoverBox = mk('u-hover'); const parentBox = mk('u-parent'); const selBox = mk('u-sel'); const selLabel = mk('u-sel-label');
  const DIRS = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  const CURSOR = { nw: 'nwse', n: 'ns', ne: 'nesw', e: 'ew', se: 'nwse', s: 'ns', sw: 'nesw', w: 'ew' };
  const handles = {};
  DIRS.forEach((d) => { const h = mk('u-handle'); h.dataset.dir = d; h.style.cursor = `${CURSOR[d]}-resize`; handles[d] = h; });
  let escala = 1; let guiasVisiveis = true; let quadro = 0; let destruida = false;
  const aplicarCaixa = (el, box) => {
    if (!box) { el.style.display = 'none'; return; }
    Object.assign(el.style, { display: 'block', left: `${box.x}px`, top: `${box.y}px`, width: `${box.width}px`, height: `${box.height}px` });
  };
  const caixaDe = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; };
  function redesenhar() {
    const el = ponte.modo() === 'edit' && !ponte.editandoTexto() ? ponte.selecionado() : null;
    const box = caixaDe(el);
    aplicarCaixa(selBox, box);
    aplicarCaixa(parentBox, el && el.parentElement && el.parentElement !== doc.body ? caixaDe(el.parentElement) : null);
    if (box) {
      const vp = { width: doc.documentElement.clientWidth, height: doc.documentElement.clientHeight };
      const lugar = M.placeControls({ box, viewport: vp, handle: 12 / escala, label: { width: 70 / escala, height: 18 / escala } });
      DIRS.forEach((d) => { Object.assign(handles[d].style, { display: 'block', left: `${lugar.handles[d].x}px`, top: `${lugar.handles[d].y}px` }); });
      selLabel.textContent = `${Math.round(box.width)} × ${Math.round(box.height)}`;
      Object.assign(selLabel.style, { display: 'block', left: `${lugar.label.x}px`, top: `${lugar.label.y}px` });
    } else { DIRS.forEach((d) => { handles[d].style.display = 'none'; }); selLabel.style.display = 'none'; }
    // guias: Task 8
  }
  function laco() { if (destruida) return; redesenhar(); quadro = doc.defaultView.requestAnimationFrame(laco); }
  ponte.aoMudar(() => redesenhar());
  doc.body.appendChild(raiz);
  doc.documentElement.dataset.uncraftOverlayAtiva = 'true';
  quadro = doc.defaultView.requestAnimationFrame(laco);
  return {
    raiz,
    redesenhar,
    definirEscala(n) { escala = n > 0 ? n : 1; raiz.style.setProperty('--u-escala', String(escala)); redesenhar(); },
    alternarGuias() { guiasVisiveis = !guiasVisiveis; redesenhar(); },
    estado() { return { caixaVisivel: selBox.style.display === 'block', escala, guiasVisiveis }; },
    destruir() { destruida = true; doc.defaultView.cancelAnimationFrame(quadro); raiz.remove(); delete doc.documentElement.dataset.uncraftOverlayAtiva; },
  };
}
```
  O laço por quadro só redesenha quando há seleção (a função sai cedo sem ela — §6.1); `document.hidden` → não agenda.
- [ ] **Step 8: CSS.** Copiar `packages/editor-core/src/editor.css` 1747–1834 (caixas e alças) para a constante
  `CSS_DA_CAMADA` com os nomes: `.rb-sel-hover`→`.u-hover`, `.rb-sel-box`→`.u-sel`, `.rb-sel-label`→`.u-sel-label`,
  `.rb-sel-handle`→`.u-handle`, `.rb-sel-parent`→`.u-parent`; acrescentar `position:fixed; box-sizing:border-box` em todos
  e `pointer-events:auto` só em `.u-handle`; tamanhos fixos (12 px, bordas, fonte do rótulo) multiplicados por
  `calc(… / var(--u-escala, 1))`. As linhas 1836–1994 (guias) entram na Task 8 com `.rb-spacing-*`→`.u-guia-*`.
- [ ] **Step 9:** `npx vitest run lib/motion-editor/runtime-overlay.test.js lib/motion-editor/runtime-bridge-source.test.js > /tmp/t4.log 2>&1; tail -4 /tmp/t4.log` → verde (os testes antigos da ponte continuam passando com a ponte recebendo os dois parâmetros).
- [ ] **Step 10:** Astra; commit `feat(motion-editor): overlay layer injected with the bridge, isolated, draws the selection`.

---

### Task 5: Gestos na ponte — estados, aplicar com `gestureId`, recusa `gesture_inactive`

**Files:** Modify `lib/motion-editor/runtime-bridge-source.js`; Test `lib/motion-editor/runtime-overlay.test.js`.

**Interfaces — Produces** (no objeto `ponte`):
- `iniciarGesto(changesAlvo) → { ok:true, gestureId } | { ok:false, motivo }` — `changesAlvo = [{ el, property }]`; guarda
  `before = el.style.getPropertyValue(property)` de cada um; estado `ativo`; recusa `gesture_busy` se já há gesto vivo.
- `previa(gestureId, changes)` — `changes = [{ el, property, value }]`; escreve `el.style.setProperty(property, value)`.
- `terminarGesto(gestureId, changes)` — estado `aguardando`; emite `overlay-gesture-ended { gestureId, changes:[{ elementId, property, before, value }] }`; arma relógio de 10 s.
- `cancelarGesto(gestureId, motivo)` — devolve os antes, estado `cancelado`, emite `overlay-gesture-canceled { gestureId, reason }`.
- `gestoVivo() → boolean`.
- Mensagem nova do editor de fora: `apply-transaction { transaction, gestureId }`.

- [ ] **Step 1: testes que falham**

```js
// em runtime-overlay.test.js
describe('gestos — estados e confirmação', () => {
  let rt; afterEach(() => rt?.restore());
  const ponte = () => window.__uncraftMotionBridge.overlay.ponteParaTeste();
  // transação montada pelas MESMAS funções do editor de fora (passa por assertTransaction)
  const transacao = (value) => createTransaction({ patches: [createPatch({ elementId: 'u-a', kind: 'style', property: 'width', before: '200px', value })], source: 'overlay' });
  it('soltar deixa a prévia; a confirmação devolve o antes e aplica no mesmo turno (before = antes do gesto)', () => {
    rt = boot(); const a = document.getElementById('a');
    const g = ponte().iniciarGesto([{ el: a, property: 'width' }]);
    ponte().previa(g.gestureId, [{ el: a, property: 'width', value: '260px' }]);
    ponte().terminarGesto(g.gestureId, [{ el: a, property: 'width', value: '260px' }]);
    expect(a.style.width).toBe('260px');
    const fim = rt.messages.filter((m) => m.type === 'overlay-gesture-ended').pop();
    expect(fim.payload.changes).toEqual([{ elementId: 'u-a', property: 'width', before: '200px', value: '260px' }]);
    rt.send('apply-transaction', { transaction: transacao('260px'), gestureId: g.gestureId });
    const ok = rt.messages.filter((m) => m.type === 'transaction-committed').pop();
    expect(ok.payload.transaction.patches[0].before).toBe('200px');
    expect(a.style.width).toBe('260px');
  });
  it('confirmação que chega depois do cancelamento é recusada com o id da transação (r2 #2)', () => {
    rt = boot(); const a = document.getElementById('a');
    const g = ponte().iniciarGesto([{ el: a, property: 'width' }]);
    ponte().terminarGesto(g.gestureId, [{ el: a, property: 'width', value: '300px' }]);
    ponte().cancelarGesto(g.gestureId, 'escape');
    expect(a.style.width).toBe('200px');
    const tardia = transacao('300px');
    rt.send('apply-transaction', { transaction: tardia, gestureId: g.gestureId });
    const nao = rt.messages.filter((m) => m.type === 'transaction-rejected').pop();
    expect(nao.payload.transactionId).toBe(tardia.id);
    expect(nao.payload.code).toBe('gesture_inactive');
    expect(a.style.width).toBe('200px');
  });
  it('um gesto vivo por vez (r4)', () => {
    rt = boot(); const a = document.getElementById('a');
    const g = ponte().iniciarGesto([{ el: a, property: 'width' }]);
    ponte().terminarGesto(g.gestureId, [{ el: a, property: 'width', value: '300px' }]);
    expect(ponte().iniciarGesto([{ el: a, property: 'width' }])).toEqual({ ok: false, motivo: 'gesture_busy' });
  });
  it('gesto órfão por 10 s volta sozinho', () => {
    vi.useFakeTimers(); rt = boot(); const a = document.getElementById('a');
    const g = ponte().iniciarGesto([{ el: a, property: 'width' }]);
    ponte().previa(g.gestureId, [{ el: a, property: 'width', value: '300px' }]);
    ponte().terminarGesto(g.gestureId, [{ el: a, property: 'width', value: '300px' }]);
    vi.advanceTimersByTime(10_001);
    expect(a.style.width).toBe('200px'); expect(ponte().gestoVivo()).toBe(false);
    vi.useRealTimers();
  });
});
```
  (importar `vi` de `vitest`, `createPatch` de `./protocol.js` e `createTransaction` de `./transaction.js` no topo). `ponteParaTeste()` é exposto em `window.__uncraftMotionBridge.overlay` — gancho de
  teste/diagnóstico, como o resto de `__uncraftMotionBridge`.
- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3: implementar** — no escopo da ponte:

```js
  // Gestos da camada (spec §6.2): ativo → aguardando → confirmado | cancelado, sem volta. No máximo UM vivo (§6.2.7).
  const gestosDaCamada = new Map();
  let gestoVivoId = null;
  function gestoVivo() { const g = gestoVivoId && gestosDaCamada.get(gestoVivoId); return !!g && (g.estado === 'ativo' || g.estado === 'aguardando'); }
  function devolverAntes(g) {
    for (let i = g.antes.length - 1; i >= 0; i -= 1) {
      const a = g.antes[i];
      try { if (a.valor === '') a.el.style.removeProperty(a.property); else a.el.style.setProperty(a.property, a.valor); } catch (_) {}
    }
  }
  function encerrar(g, estado) { g.estado = estado; if (g.relogio) clearTimeout(g.relogio); g.relogio = null; if (gestoVivoId === g.id) gestoVivoId = null; }
  function iniciarGestoDaCamada(alvos) {
    if (gestoVivo()) return { ok: false, motivo: 'gesture_busy' };
    pausarTocadorParaGesto();                                   // Task 6
    const id = randomIdentity('overlay-gesture');
    const antes = alvos.map(({ el, property }) => ({ el, property, valor: el.style.getPropertyValue(property) }));
    gestosDaCamada.set(id, { id, estado: 'ativo', antes, relogio: null });
    gestoVivoId = id;
    return { ok: true, gestureId: id };
  }
  function previaDoGesto(id, changes) {
    const g = gestosDaCamada.get(id); if (!g || g.estado !== 'ativo') return;
    changes.forEach(({ el, property, value }) => { try { el.style.setProperty(property, value); } catch (_) {} });
  }
  function terminarGestoDaCamada(id, changes) {
    const g = gestosDaCamada.get(id); if (!g || g.estado !== 'ativo') return;
    g.estado = 'aguardando';
    g.relogio = setTimeout(() => cancelarGestoDaCamada(id, 'timeout'), 10000);
    const antesDe = (el, property) => { const a = g.antes.find((x) => x.el === el && x.property === property); return a ? a.valor : ''; };
    emit('overlay-gesture-ended', {
      gestureId: id,
      changes: changes.map(({ el, property, value }) => ({ elementId: ensureElementId(el), property, before: antesDe(el, property), value })),
    }, { protocol: PROTOCOL_V2 });
  }
  function cancelarGestoDaCamada(id, motivo) {
    const g = gestosDaCamada.get(id); if (!g || (g.estado !== 'ativo' && g.estado !== 'aguardando')) return;
    devolverAntes(g); encerrar(g, 'cancelado');
    emit('overlay-gesture-canceled', { gestureId: id, reason: motivo }, { protocol: PROTOCOL_V2 });
    camada?.redesenhar();
  }
  function aplicarGestoDaCamada(message, payload) {
    const g = gestosDaCamada.get(payload.gestureId);
    if (!g || g.estado !== 'aguardando') {
      rejectTransaction(message, payload.transaction?.id || null, bridgeError('gesture_inactive', 'The gesture is no longer active.'));
      return;
    }
    devolverAntes(g);                                  // MESMO turno: sem pintura entre devolver e aplicar
    encerrar(g, 'confirmado');
    commitTransaction(message, payload.transaction, 'apply');
  }
```
  e no despacho: `if (message.type === 'apply-transaction') { if (payload.gestureId) aplicarGestoDaCamada(message, payload); else commitTransaction(message, payload.transaction, 'apply'); }`.
  Conferir em `rejectTransaction` que o payload leva `transactionId` e `code` (é o que o ledger do editor de fora usa para fechar a entrada); se o nome do campo for outro, usar o do arquivo e ajustar o teste.
- [ ] **Step 4:** rodar → verde. Rodar também `runtime-bridge-source.test.js` → verde.
- [ ] **Step 5:** Astra; commit `feat(motion-editor): overlay gesture lifecycle in the bridge (one live gesture, late confirmations refused)`.

---

### Task 6: Elegibilidade por gesto, regra única e tocador (Astra r1 #2, #5; r3; r4; r5 #1)

**Files:** Modify `lib/motion-editor/runtime-bridge-source.js`; Test `lib/motion-editor/runtime-overlay.test.js`.

**Interfaces — Produces:** `ponte.elegivel(el, mudancas) → { ok:true } | { ok:false, motivo }` — `mudancas = [{ el, property, value }]`
(o conjunto INTEIRO do gesto). Motivos e textos (inglês, para o tooltip):
`layout_locked` "Locked by the 3D scene" · `inline_element` "Inline elements can't be resized" · `svg_inner` "This part of an
SVG can't be resized" · `motion_owned` "Driven by an animation — edit it in Motion" · `cleared_by_motion` "An animation
resets this when it ends" · `priority_conflict` "The site forces this value" · `layout_controlled` "This element's size
is set by its layout" · `gesture_busy` "Saving…".

- [ ] **Step 1: testes que falham**

```js
describe('elegibilidade e regra única', () => {
  let rt; afterEach(() => rt?.restore());
  const ponte = () => window.__uncraftMotionBridge.overlay.ponteParaTeste();
  it('canais expandidos: animação de row-gap no pai bloqueia o gap daquele eixo (r1 #5)', () => {
    rt = boot(); const m = document.getElementById('m');
    window.__uncraftMotionBridge.overlay.injetarTrilhasParaTeste(m, [{ property: 'rowGap' }]);
    expect(ponte().elegivel(m, [{ el: m, property: 'row-gap', value: '10px' }])).toEqual({ ok: false, motivo: 'motion_owned' });
  });
  it('clearProps:"all" conta como dono de tudo (r5 #1)', () => {
    rt = boot(); const a = document.getElementById('a');
    window.__uncraftMotionBridge.overlay.injetarLimpezaParaTeste(a, 'all');
    expect(ponte().elegivel(a, [{ el: a, property: 'width', value: '300px' }])).toEqual({ ok: false, motivo: 'cleared_by_motion' });
  });
  it('elemento inline e nó interno de SVG recusam o redimensionar (review focus 1, 2)', () => {
    rt = boot();
    document.body.insertAdjacentHTML('beforeend', '<span id="s" data-uncraft-id="u-s">x</span><svg id="v" data-uncraft-id="u-v"><path id="p" data-uncraft-id="u-p" d="M0 0"/></svg>');
    const s = document.getElementById('s'); const p = document.getElementById('p');
    expect(ponte().elegivel(s, [{ el: s, property: 'width', value: '30px' }]).motivo).toBe('inline_element');
    expect(ponte().elegivel(p, [{ el: p, property: 'width', value: '30px' }]).motivo).toBe('svg_inner');
  });
  it('desfazer no meio do gesto cancela o gesto ANTES (r3)', () => {
    rt = boot(); const a = document.getElementById('a');
    const g = ponte().iniciarGesto([{ el: a, property: 'width' }]);
    ponte().previa(g.gestureId, [{ el: a, property: 'width', value: '400px' }]);
    rt.send('rollback-transaction', { transaction: { id: 'tx-undo', requestId: 'q-undo', source: 'undo', patches: [{ id: 'p', elementId: 'u-a', kind: 'style', property: 'color', before: 'red', value: '' }] } });
    expect(ponte().gestoVivo()).toBe(false);
    expect(a.style.width).toBe('200px');
    expect(rt.messages.some((m) => m.type === 'overlay-gesture-canceled' && m.payload.reason === 'host:rollback-transaction')).toBe(true);
  });
  it.each(['select-element', 'set-mode', 'playback', 'seek-motion', 'scrub-intro', 'scroll-to', 'apply-patches', 'refresh', 'begin-scrub'])('%s com gesto vivo cancela o gesto primeiro', (tipo) => {
    rt = boot(); const a = document.getElementById('a');
    const g = ponte().iniciarGesto([{ el: a, property: 'width' }]);
    ponte().previa(g.gestureId, [{ el: a, property: 'width', value: '400px' }]);
    rt.send(tipo, {});
    expect(ponte().gestoVivo()).toBe(false);
  });
  it.each(['health-check', 'describe-element', 'inspect-selected', 'refresh-inventory', 'set-overlay-scale'])('%s só lê e NÃO cancela', (tipo) => {
    rt = boot(); const a = document.getElementById('a');
    ponte().iniciarGesto([{ el: a, property: 'width' }]);
    rt.send(tipo, {});
    expect(ponte().gestoVivo()).toBe(true);
  });
  it('Ctrl+Z dentro da página vai para o editor de fora (r1 #6); com o campo aberto, não', () => {
    rt = boot();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    expect(rt.messages.some((m) => m.type === 'history-key' && m.payload.action === 'undo')).toBe(true);
  });
});
```
- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3: elegibilidade** — reaproveitar `validarEscritaDeEstilo` (9302) com um canal expandido e um estado candidato:

```js
  // Canais que cada escrita toca (Astra r1 #5): shorthand e longhands disputam o mesmo canal.
  const CANAIS_EXPANDIDOS = {
    gap: ['gap', 'rowgap', 'columngap'], rowgap: ['gap', 'rowgap'], columngap: ['gap', 'columngap'],
    margin: ['margin', 'margintop', 'marginright', 'marginbottom', 'marginleft'],
    padding: ['padding', 'paddingtop', 'paddingright', 'paddingbottom', 'paddingleft'],
    inset: ['inset', 'top', 'right', 'bottom', 'left'],
  };
  const canaisDe = (nome) => {
    const n = String(nome || '').toLowerCase().replace(/-/g, '');
    const direto = CANAIS_EXPANDIDOS[n]; if (direto) return direto;
    for (const [mae, filhos] of Object.entries(CANAIS_EXPANDIDOS)) if (filhos.indexOf(n) !== -1 && mae !== n) return [n, mae];
    return [n];
  };
  function limpezaDoTocador(el) {           // clearProps das animações vivas do elemento (excluído das trilhas — 638)
    const gsap = window.gsap; const props = new Set();
    try { (gsap && gsap.getTweensOf ? gsap.getTweensOf(el) : []).forEach((t) => {
      const c = t && t.vars && t.vars.clearProps; if (!c) return;
      String(c === true ? 'all' : c).split(',').forEach((p) => props.add(p.trim().toLowerCase().replace(/-/g, '')));
    }); } catch (_) {}
    (limpezasInjetadasParaTeste.get(el) || []).forEach((p) => props.add(p));
    return props;
  }
  // opcoes.ignorarGesto: revalidar o PRÓPRIO gesto vivo (fim do arraste); opcoes.semMedirTamanho: no fim, a prévia já
  // mostra o tamanho final — medir "mudou?" contra ela recusaria todo redimensionar; o tamanho só se mede no 1º movimento
  function elegivelParaCamada(el, mudancas, opcoes = {}) {
    if (gestoVivo() && opcoes.ignorarGesto !== gestoVivoId) return { ok: false, motivo: 'gesture_busy' };
    for (const { el: alvo, property } of mudancas) {
      const css = property.toLowerCase();
      if (escritaTravada(alvo, css)) return { ok: false, motivo: 'layout_locked' };
      const tamanho = css === 'width' || css === 'height';
      if (tamanho && alvo instanceof SVGElement && alvo.tagName.toLowerCase() !== 'svg') return { ok: false, motivo: 'svg_inner' };
      if (tamanho && getComputedStyle(alvo).display === 'inline') return { ok: false, motivo: 'inline_element' };
      const limpa = limpezaDoTocador(alvo);
      if (limpa.has('all') || canaisDe(css).some((c) => limpa.has(c))) return { ok: false, motivo: 'cleared_by_motion' };
      const canais = canaisDe(css);
      const clips = inspectMotion(alvo) || [];
      for (const clip of clips) for (const track of (clip.tracks || [])) {
        const t = String(semanticProperty(track.property) || '').toLowerCase().replace(/-/g, '');
        if (canais.indexOf(t) !== -1) return { ok: false, motivo: 'motion_owned' };
      }
      for (const t of (trilhasInjetadasParaTeste.get(alvo) || [])) if (canais.indexOf(String(t.property).toLowerCase().replace(/-/g, '')) !== -1) return { ok: false, motivo: 'motion_owned' };
    }
    return candidatoMuda(mudancas, opcoes);
  }
  // Estado candidato COMPLETO (Astra r1 #2): aplica TODAS as mudanças juntas, mede, devolve tudo — e só aceita se o
  // calculado de cada propriedade bate com o pedido (senão o site força o valor) e se um gesto de tamanho muda o tamanho.
  function candidatoMuda(mudancas, opcoes = {}) {
    const antes = mudancas.map(({ el, property }) => ({ el, property, valor: el.style.getPropertyValue(property), caixa: el.getBoundingClientRect() }));
    try {
      mudancas.forEach(({ el, property, value }) => el.style.setProperty(property, value));
      for (const { el, property, value } of mudancas) {
        const calc = getComputedStyle(el).getPropertyValue(property).trim();
        if (/px$/.test(value) && calc && /px$/.test(calc) && Math.abs(parseFloat(calc) - parseFloat(value)) > 0.5) return { ok: false, motivo: 'priority_conflict' };
      }
      const tamanho = mudancas.filter((m) => m.property === 'width' || m.property === 'height');
      if (tamanho.length && !opcoes.semMedirTamanho) {
        const mudou = tamanho.some((m) => { const a = antes.find((x) => x.el === m.el); const r = m.el.getBoundingClientRect(); return Math.abs(r.width - a.caixa.width) > 0.5 || Math.abs(r.height - a.caixa.height) > 0.5; });
        if (!mudou) return { ok: false, motivo: 'layout_controlled' };
      }
      return { ok: true };
    } finally {
      for (let i = antes.length - 1; i >= 0; i -= 1) { const a = antes[i]; if (a.valor === '') a.el.style.removeProperty(a.property); else a.el.style.setProperty(a.property, a.valor); }
    }
  }
```
  `trilhasInjetadasParaTeste`/`limpezasInjetadasParaTeste` = `WeakMap`s expostos só pelos ganchos `injetarTrilhasParaTeste`
  / `injetarLimpezaParaTeste` de `__uncraftMotionBridge.overlay` (jsdom não tem GSAP). Em jsdom `getBoundingClientRect`
  é zero: o teste de `layout_controlled` vive no navegador real (Task 11); no jsdom, `candidatoMuda` só roda os casos acima.
  A camada chama `elegivel` com o gesto do 1º movimento (mudanças da prévia inicial) e de novo antes de `terminarGesto`.
- [ ] **Step 4: regra única** — no começo do tratamento de comando v2 (logo depois da validação de `validV2Command`):

```js
    const SO_LEITURA = new Set(['health-check', 'describe-element', 'inspect-selected', 'refresh-inventory', 'set-overlay-scale', 'toggle-guides', 'request-announce', 'upload-result', 'set-interaction']);
    // `overlay-gesture-cancel` (o editor recusou o lote — Task 7) é o próprio cancelamento: tratado ANTES desta regra
    const eDoProprioGesto = message.type === 'apply-transaction' && message.payload && message.payload.gestureId;
    if (gestoVivo() && !eDoProprioGesto && !SO_LEITURA.has(message.type)) cancelarGestoDaCamada(gestoVivoId, `host:${message.type}`);
```
  E nos escritores internos: no `scroll` (9060) e no `resize` (9068) de `window`, primeira linha
  `if (gestoVivo()) cancelarGestoDaCamada(gestoVivoId, 'scroll');` (ou `'resize'`); em `enterInlineTextEdit` e nos
  handlers de clique/ponteiro de seleção e da ferramenta Move: `if (gestoVivo()) cancelarGestoDaCamada(gestoVivoId, 'page-input');`;
  no `teardown` (9100): cancelar o gesto vivo antes de desmontar.
- [ ] **Step 5: tocador parado no gesto** — no despacho `playback`, guardar `ultimoTocar = { action: payload.action, motionId: payload.motionId }`;
  `function pausarTocadorParaGesto() { if (ultimoTocar && (ultimoTocar.action === 'play' || ultimoTocar.action === 'restart')) { controlPlayback('pause', undefined, ultimoTocar.motionId); ultimoTocar = { action: 'pause', motionId: ultimoTocar.motionId }; emit('playback-paused', { reason: 'overlay-gesture', motionId: ultimoTocar.motionId }, { protocol: PROTOCOL_V2 }); } }`.
  (O `playback` vindo do editor durante o gesto já cancela o gesto pela regra única — Step 4.)
- [ ] **Step 6: repasse de desfazer** — novo `on(document, 'keydown', …)` em `boot()`:

```js
    on(document, 'keydown', (event) => {
      if (textEditState || digitando(event.target) || ehNossoRef.fn(event.target)) return;
      const mod = event.metaKey || event.ctrlKey; if (!mod) return;
      const k = String(event.key).toLowerCase();
      const action = (k === 'z' && !event.shiftKey) ? 'undo' : ((k === 'z' && event.shiftKey) || k === 'y') ? 'redo' : null;
      if (!action) return;
      event.preventDefault();
      emit('history-key', { action }, { protocol: PROTOCOL_V2 });
    }, true);
```
  (o campo de digitar da camada vive na sombra: `ehNossoRef.fn(event.target)` → não repassa; o desfazer do próprio campo segue).
- [ ] **Step 7:** rodar `runtime-overlay.test.js` + `runtime-bridge-source.test.js` → verde.
- [ ] **Step 8:** Astra (rigor `xhigh`: é a regra que fecha a classe; pedir explicitamente "algum escritor fora da regra?"); commit
  `feat(motion-editor): per-gesture eligibility, single live gesture rule, player pause, undo forwarding`.

---

### Task 7: Editor de fora — confirmar o gesto, bloquear desfazer, escala, teclas

**Files:** Modify `components/motion-editor/useNativeMotionController.js`, `components/motion-editor/NativeEditViewport.jsx`;
Test: `components/motion-editor/useNativeMotionController.test.js` (ou o arquivo de teste do controller existente — `ls components/motion-editor/*.test.*`).

**Interfaces:**
- Consumes: Task 2 `buildOverlayBatch`; Task 5/6 mensagens `overlay-gesture-ended`, `overlay-gesture-canceled`, `history-key`, `playback-paused`.
- Produces: `commands.setOverlayScale(n)`; `overlayPendingRef` (bloqueio de desfazer).

- [ ] **Step 1: testes que falham** (seguir o padrão de montagem do controller nos testes existentes — `renderHook` + iframe falso que captura `postMessage`):
  1. `overlay-gesture-ended` com 2 mudanças (largura do filho, `overflow` do pai) → o controller envia UM `apply-transaction` com `payload.gestureId` igual e 2 patches, cada um com `responsive.propertyKey` do SEU elemento;
  2. entre `overlay-gesture-ended` e a confirmação, `commands.undo()` NÃO envia `rollback-transaction`;
  3. `transaction-rejected` com `code:'gesture_inactive'` libera o ledger (`pendingTransactions` volta a 0) e a próxima edição do painel é enviada;
  4. `history-key {action:'undo'}` chama o mesmo caminho de `commands.undo()`;
  5. a confirmação (`transaction-committed`) da transação do gesto entra no histórico e salva (`persist`), e a seleção do editor NÃO muda quando o patch é do pai.
- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3: implementar** no `onMessage` v2:

```js
      if (type === 'overlay-gesture-ended') {
        const result = buildOverlayBatch({
          manifest: responsiveManifestRef.current,
          deviceId,
          changes: payload.changes || [],
          descriptorFor: (elementId, property) => (selected?.id === elementId ? responsiveDescriptorFor(property) : null),
        });
        if (!result.ok) { send('overlay-gesture-cancel', { gestureId: payload.gestureId, reason: result.reason }); return; }
        overlayPendingRef.current = payload.gestureId;
        applyPatches(result.patches, { source: 'overlay', responsiveManifest: result.nextManifest, gestureId: payload.gestureId });
        return;
      }
      if (type === 'overlay-gesture-canceled') { if (overlayPendingRef.current === payload.gestureId) overlayPendingRef.current = null; return; }
      if (type === 'history-key') { if (payload.action === 'undo') undo(); else if (payload.action === 'redo') redo(); return; }
```
  `applyPatches` ganha a opção `gestureId` e manda `send('apply-transaction', { transaction, ...(gestureId ? { gestureId } : {}) }, …)`;
  no `releaseSettled`, quando a entrada fecha (confirmada ou recusada), `if (overlayPendingRef.current && entry.meta.gestureId === overlayPendingRef.current) overlayPendingRef.current = null;`
  (guardar `gestureId` na meta do `stage`). `undo()`/`redo()`: primeira linha `if (pendingTransactions || overlayPendingRef.current) return;`.
  Na ponte, tratar o comando novo `overlay-gesture-cancel` (editor recusou o lote) → `cancelarGestoDaCamada(payload.gestureId, payload.reason)` e incluí-lo na lista `SO_LEITURA`? **Não** — ele é o próprio cancelamento; tratar ANTES da regra única.
- [ ] **Step 4: escala** — em `NativeEditViewport.jsx`, efeito que observa `--canvas-scale`:

```js
  useEffect(() => {
    const ler = () => Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--canvas-scale')) || 1;
    let ultima = null;
    const enviar = () => { const s = ler(); if (s !== ultima) { ultima = s; commands.setOverlayScale?.(s); } };
    enviar();
    const obs = new MutationObserver(enviar);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
    return () => obs.disconnect();
  }, [commands, status]);
```
  e no controller `setOverlayScale: (scale) => send('set-overlay-scale', { scale })`. Tecla G com o foco fora da página:
  no efeito de teclas do controller (2028), `if (key === 'g' && !mods && !digitando(target)) send('toggle-guides', {})`; a ponte trata
  `toggle-guides` → `camada?.alternarGuias()` (entra em `SO_LEITURA`: não escreve na página).
- [ ] **Step 5:** rodar os testes do controller → verde; `npx vitest run components/motion-editor lib/motion-editor` → verde.
- [ ] **Step 6:** Astra; commit `feat(motion-editor): host confirms overlay gestures through the panel path`.

---

### Task 8: Arrastar as alças (prévia → soltar)

**Files:** Modify `lib/motion-editor/runtime-overlay-source.js`; Test: `runtime-overlay.test.js` (fluxo com `getBoundingClientRect` falso) e Task 11 (real).

- [ ] **Step 1: teste que falha** — com `HTMLElement.prototype.getBoundingClientRect` falso devolvendo `{left:10,top:10,width:200,height:100,…}`
  para `#a`, disparar `pointerdown` na alça `e` (pela raiz: `window.__uncraftMotionBridge.overlay.alcaParaTeste('e')`), `pointermove` +40 px,
  `pointerup` → espera `overlay-gesture-ended` com `width:240px` e `height:100px`, e UM só evento; um `pointerdown`+`pointerup` sem mover (< 2 px) não emite nada.
- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3: implementar** na camada (cada alça):

```js
  DIRS.forEach((dir) => handles[dir].addEventListener('pointerdown', (ev) => {
    const el = ponte.selecionado(); if (!el || ev.button !== 0) return;
    ev.preventDefault(); ev.stopPropagation();
    const cs = doc.defaultView.getComputedStyle(el); const r = el.getBoundingClientRect();
    const start = { width: r.width, height: r.height, marginLeft: parseFloat(cs.marginLeft) || 0, marginTop: parseFloat(cs.marginTop) || 0, left: parseFloat(cs.left) || 0, top: parseFloat(cs.top) || 0, position: cs.position };
    const pai = el.parentElement; const pcs = pai ? doc.defaultView.getComputedStyle(pai) : null;
    const sx = ev.clientX; const sy = ev.clientY; let gesto = null; let destravar = [];
    const resolver = (lista) => lista.map((c) => ({ el: c.alvo === 'parent' ? pai : el, property: c.property, value: c.value })).filter((c) => c.el);
    const mudancasDe = (dx, dy) => resolver([...destravar, ...M.resizeChanges({ dir, dx, dy, start })]);
    const mover = (e) => {
      const dx = e.clientX - sx; const dy = e.clientY - sy;
      if (!gesto) {
        if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return;
        destravar = M.unlockChanges({ dir, computed: { maxWidth: cs.maxWidth, maxHeight: cs.maxHeight, minWidth: cs.minWidth, minHeight: cs.minHeight, width: cs.width, height: cs.height, flexGrow: cs.flexGrow, boxSizing: cs.boxSizing }, rect: r, parent: pcs ? { display: pcs.display, overflow: pcs.overflow } : null });
        const primeiras = mudancasDe(dx, dy);
        const pode = ponte.elegivel(el, primeiras); if (!pode.ok) { mostrarMotivo(pode.motivo); soltarTudo(); return; }
        const g = ponte.iniciarGesto(primeiras.map(({ el: alvo, property }) => ({ el: alvo, property }))); if (!g.ok) { mostrarMotivo(g.motivo); soltarTudo(); return; }
        gesto = g.gestureId;
      }
      ponte.previa(gesto, mudancasDe(dx, dy)); redesenhar();
    };
    const soltar = (e) => { soltarTudo(); if (!gesto) return; const finais = mudancasDe(e.clientX - sx, e.clientY - sy); const pode = ponte.elegivel(el, finais, { ignorarGesto: gesto, semMedirTamanho: true }); if (!pode.ok) { ponte.cancelarGesto(gesto, pode.motivo); mostrarMotivo(pode.motivo); return; } ponte.terminarGesto(gesto, finais); };
    const esc = (e) => { if (e.key === 'Escape' && gesto) { soltarTudo(); ponte.cancelarGesto(gesto, 'escape'); } };
    function soltarTudo() { doc.removeEventListener('pointermove', mover, true); doc.removeEventListener('pointerup', soltar, true); doc.removeEventListener('keydown', esc, true); doc.defaultView.removeEventListener('blur', perdeuFoco); }
    const perdeuFoco = () => { soltarTudo(); if (gesto) ponte.cancelarGesto(gesto, 'blur'); };
    try { handles[dir].setPointerCapture(ev.pointerId); } catch (_) {}
    doc.addEventListener('pointermove', mover, true); doc.addEventListener('pointerup', soltar, true); doc.addEventListener('keydown', esc, true); doc.defaultView.addEventListener('blur', perdeuFoco);
  }));
```
  `ponte.elegivel(el, mudancas, { ignorarGesto, semMedirTamanho })` — opções da Task 6 (revalidar o próprio gesto vivo sem
  responder `gesture_busy`, e sem medir "o tamanho mudou?" contra a prévia que já está na tela). `mostrarMotivo(codigo)` mostra a pílula com o texto em inglês da Task 6 por 2,5 s.
  Alça apagada: a camada consulta `ponte.elegivel(el, [{el, property:'width', value: '<largura atual>px'}, {…height}])` ao
  redesenhar quando a seleção muda (não a cada quadro) e aplica a classe `u-handle-off` + `title` com o motivo; região
  travada (`layout_locked`) esconde as alças (paridade `rb-sel-locked`).
- [ ] **Step 4:** rodar → verde.
- [ ] **Step 5:** Astra; commit `feat(motion-editor): resize handles drag with preview, one transaction on release`.

---

### Task 9: Guias de espaçamento, cantos e clique que atravessa

**Files:** Modify `runtime-overlay-source.js` (+ CSS `editor.css` 1836–1994 → `.u-guia-*`); Test `runtime-overlay.test.js`.

- [ ] **Step 1: testes que falham** (rect falso como na Task 8; margem/padding calculados via `getComputedStyle` falso):
  margem de baixo arrastada +13 com Cmd → `overlay-gesture-ended` com `margin-bottom: 24px`; Shift → 4 longhands numa só
  emissão; Alt → lado + espelho; `gap` do pai em linha → `column-gap` com `elementId` do PAI e a seleção da ponte
  continua `u-a`; canto `se` → duas margens; guia com valor 0 não é desenhada; clique sem arrastar numa guia chama
  `ponte.selecionarEm(x, y)` e não emite gesto.
- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3: implementar** — desenhar as 9 faixas e os 4 cantos a partir de `getComputedStyle` (portando `updateSpacingGuides`
  9253–9308 sem o fator `_scale`: as medidas da página já são px da página; só o rótulo/espessura usam `--u-escala`), e para
  cada guia o mesmo esqueleto de ponteiro da Task 8 com limiar 3 px, `M.guideAxis(key, pcs.flexDirection)`,
  `M.guideChanges({ key, start, dx, dy, axis, mods: { shift: e.shiftKey, alt: e.altKey, meta: e.metaKey, ctrl: e.ctrlKey }, initial })`
  e rótulo `valor +d` (`renderWidgetLabel` 8895–8904); cantos com `M.cornerChanges` (sempre ao menos uma margem ≥ 2 px para
  aparecer). Clique sem passar do limiar → `ponte.selecionarEm(e.clientX, e.clientY)`; a ponte implementa com
  `document.elementsFromPoint(x, y).find((n) => !ehNosso(n))` → `chooseElement(n)` → `select(...)`.
- [ ] **Step 4:** rodar → verde.
- [ ] **Step 5:** Astra; commit `feat(motion-editor): spacing guides, corners and click-through`.

---

### Task 10: Campo de digitar, setas e tecla G

**Files:** Modify `runtime-overlay-source.js`, `runtime-bridge-source.js` (`toggle-guides`); Test `runtime-overlay.test.js`.

- [ ] **Step 1: testes que falham:** duplo clique no rótulo da guia abre `<input>` (na sombra) com o valor atual; `1.5rem`
  + Enter → UMA emissão `24px`; Esc → nada emitido e o rótulo volta; `+5` soma; com o mouse sobre a guia `mb`,
  `ArrowDown` → emissão `+1 px`, Shift → `+10`, Cmd → `+8`; `g` sem modificador esconde/mostra as guias; dentro do campo,
  `g` e as setas NÃO agem.
- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3: implementar** — campo com `M.parseGuideInput` (rootFontSize = `getComputedStyle(documentElement).fontSize`,
  fontSize do alvo, `parentWidth` = largura do pai); cada confirmação do campo, cada toque de seta = um ciclo
  `elegivel → iniciarGesto → previa → terminarGesto` imediato (sem arraste); a guia "ativa" é a que está sob o mouse
  (`pointerenter`/`pointerleave` na faixa — paridade `setActiveGuide`). Teclado escutado no `document` em captura, saindo
  cedo se `ponte.editandoTexto()` ou alvo editável fora da sombra.
- [ ] **Step 4:** rodar → verde.
- [ ] **Step 5:** Astra; commit `feat(motion-editor): guide inline input, arrow nudges and G toggle`.

---

### Task 11: Navegador real — os achados do Astra e o Review Focus

**Files:** Create `lib/motion-editor/runtime-overlay.browser.test.js` (`// @vitest-environment node`, playwright-core).

O teste abre uma página de teste com a ponte injetada (`injectRuntimeBridge(html, config)`), e a PRÓPRIA página faz o papel
do editor de fora (como os testes jsdom: troca `window.postMessage` e despacha `MessageEvent` com `origin`). Arrastes com
`page.mouse` reais, layout real.

- [ ] **Step 1: escrever os casos** (um `it` por linha; todos começam FALHANDO se a camada for removida — conferir uma vez
  comentando `instalar` no `getRuntimeBridgeSource`):
  1. (r1 #1) arrastar `e` +60 → a largura NOVA fica na tela durante a espera; o harness confirma; `transaction-committed.before` = largura antes do gesto;
  2. (r1 #2) `width:100px; max-width:100px` → arrastar para 150 é aceito;
  3. (r1 #4) guia de `gap` → `elementId` do pai no `overlay-gesture-ended` e `selection-changed` continua o filho;
  4. (r1 #6) foco dentro da página + Ctrl+Z → `history-key`;
  5. (r1 #7) elemento colado no topo → rótulo e 8 alças inteiros dentro da janela;
  6. (r3) arrastar → harness manda `rollback-transaction` → Esc → a página volta ao valor de antes do gesto e nada reaparece;
  7. (r4) segundo arraste durante `aguardando` não começa; depois cancelar o primeiro → valor de antes do primeiro;
  8. (r5 #1) GSAP real: tween em `x` com `clearProps:'all'` no elemento → alças apagadas com "An animation resets this when it ends";
  9. Review Focus 3: `flex-basis` fixo num filho flex → gesto recusado `layout_controlled`, nada gravado;
  10. Review Focus 4: contêiner com rolagem interna → rolar 100 px move a caixa 100 px;
  11. Review Focus 5: `transform: scale(0.5)` → arrastar não lança erro e emite largura;
  12. a camada não aparece em `inventory-changed`, `describe` nem em `elementsFromPoint` usado pela seleção;
  13. escala 0,5 e 2 → alça mede 12 px na tela (`getBoundingClientRect` da alça × escala).
- [ ] **Step 2:** `npx vitest run lib/motion-editor/runtime-overlay.browser.test.js > /tmp/t11.log 2>&1; tail -20 /tmp/t11.log` → todos verdes; corrigir o código (não o teste) até passar.
- [ ] **Step 3:** suíte inteira: `npx vitest run > /tmp/suite.log 2>&1; tail -8 /tmp/suite.log` — falhas só de tempo em módulos não tocados, conferidas isoladas.
- [ ] **Step 4:** Astra no ramo inteiro (rigor `xhigh`); commit `test(motion-editor): real-browser coverage for handles and guides`.

---

### Task 12: Prova ao vivo e fechamento

- [ ] **Step 1:** `next build` com `NEXT_DIST_DIR=.next-alcas` → exit 0.
- [ ] **Step 2:** juntar no `main` local (ff), servidor de dev em 3030 (já roda do `main`); no canvas, abrir a cópia do
  farmminerals (node de prova `63f9dca3-…`) com Edit; roteiro Playwright fotografa: caixa com 8 alças no título; arrastar a
  alça `e`; guias de margem/espaçamento num cartão; Shift/Alt/Cmd; duplo clique 24; Ctrl+Z; Save; reabrir → valores ficam.
- [ ] **Step 3:** o mesmo elemento no editor antigo (node legado) para as fotos lado a lado (item a item da §5 da spec).
- [ ] **Step 4:** fotos em `docs/superpowers/findings/2026-10-2x-alcas-e-guias-fotos/`; memória + CLAUDE.md (item novo); commit.

---

## Self-review (feito ao escrever)

- **Cobertura da spec:** §4.1→T4 · §4.2→T4 (+teste 12 da T11) · §4.3→T4/T9 (`selecionarEm`) · §4.4→T4/T7 · §5.1→T5/T6 ·
  §5.2→T3/T8 · §5.3→T3/T9/T10 · §5.4→T6/T7 · §5.5→T6/T8 · §6.1→T4 · §6.2.1-6→T5/T7 · §6.2.7→T6 · §6.3→T1/T7 · §7→T6/T8/T11 · §8→T11/T12.
- **Decisão registrada (ruling):** a aba "Add feedback" do antigo NÃO volta — nada no web-shell escuta `uncraft:feedback`
  (um botão sem efeito). A "pílula" desta camada é só o aviso do motivo de recusa.
- **Nomes consistentes:** `instalarCamada(ponte, M)`, `ponte.{elegivel, iniciarGesto, previa, terminarGesto, cancelarGesto, gestoVivo, selecionarEm}`,
  mensagens `overlay-gesture-ended`, `overlay-gesture-canceled`, `overlay-gesture-cancel`, `history-key`, `set-overlay-scale`, `toggle-guides`, `playback-paused`.
