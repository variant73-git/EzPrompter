# Supressão seletiva de callbacks no seek — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Quando o editor move o ponteiro de uma animação (arrastar a barra ou o replay do recovery), o site clonado continua **desenhando** normalmente, mas não executa as reações de ciclo de vida que ele só executaria numa reprodução de verdade.

**Architecture:** Uma **janela** em volta de UMA escrita de relógio dentro de `seekTimeline`. Antes da escrita, os quatro callbacks de ciclo de vida são anulados em toda a descendência alcançável; depois, restaurados sem sobrescrever o que o site tenha escrito no meio. O `onUpdate` nunca é tocado — é ele que desenha. Nada muda no ramo `browser` (WAAPI).

**Tech Stack:** JavaScript puro dentro da IIFE do bridge (`runtime-bridge-source.js`), Vitest (jsdom, GSAP falso e fiel nos pontos medidos), witness em Playwright com GSAP 3.15 real.

## Global Constraints

- **Fonte da verdade dos fatos:** `docs/superpowers/handoffs/2026-08-07-tabela-b-medida-finding.md`. Nada neste plano pode contrariar a §1 dele; se contrariar, o plano está errado.
- **Só o ramo GSAP.** O ramo `browser` (WAAPI) de `seekTimeline` fica intocado — decisão de escopo do handoff §6.
- **A janela cobre APENAS a escrita de relógio.** `pause()`, `emitTimelineState` e qualquer inspeção ficam FORA dela. Enquanto ela está aberta a forma de `vars` diverge, e a malha de proveniência (`gsapVarsCollateralState`, `runtime-bridge-source.js:4004`) percorre `for..in`.
- **O estado salvo pertence à chamada.** Nada de slot de módulo — um seek reentrante sobrescreveria o slot e as duas restaurações devolveriam `undefined`, matando o ciclo de vida do site para sempre.
- **Nunca sintetizar callback.** Só ligar e desligar o que é do site.
- **Fail closed em dúvida.** Forma inesperada de `vars` (getter, não-gravável, protótipo hostil) ou impossibilidade de enumerar animações ⇒ não abrir a janela naquele nó.
- **Suíte no baseline antes e depois:** `bun run test` em `packages/web-shell` = **1623 passed | 10 skipped**. Cada task fecha com a suíte verde.
- **Texto de produto em inglês; comentários e docs desta frente em português.**
- **Auditoria do Sol obrigatória** antes do commit final (Task 6), no padrão da frente.

### As três decisões de produto (Adilson, 2026-08-07)

1. **Quatro callbacks silenciados:** `onStart`, `onComplete`, `onRepeat`, `onReverseComplete`.
2. **`vars` partilhado ⇒ fail-closed:** não abrir a janela onde a configuração é alcançável por outra animação.
3. **Reposição do site dentro da janela ⇒ residual aceito.** A promessa é "silencioso, salvo se o próprio site repuser a reação no meio do arrasto". A restauração **não** pode sobrescrever o que o site escreveu.

> ⚠️ **Refinamento a confirmar com o Adilson na Task 3.** Ele aprovou "detectar o compartilhamento e não mexer". Este plano aplica o fail-closed **por nó**, não por seek inteiro: só as animações cuja configuração é partilhada ficam de fora; as demais seguem silenciadas. É estritamente mais próximo da regra e nunca estraga a vizinha. Se ele preferir o corte grosso (seek inteiro desiste), a Task 3 muda de uma linha.

---

## File Structure

| Arquivo | Responsabilidade | Ação |
|---|---|---|
| `packages/web-shell/lib/motion-editor/runtime-bridge-source.js` | Três helpers novos (`collectSeekScope`, `seekSharedVarsNodes`, `withSeekLifecycleSilenced`) colocados **imediatamente acima** de `function seekTimeline` (hoje `:7462`), e a chamada dentro do ramo GSAP de `seekTimeline` | Modificar |
| `packages/web-shell/lib/motion-editor/runtime-bridge-source.test.js` | Um `describe` novo — "seek silencioso" — com um fake de GSAP compartilhado e um caso por comportamento | Modificar (append) |
| `packages/web-shell/_probe-seek-silence-witness.mjs` | Witness no GSAP 3.15 real, pelo caminho de protocolo v2, com baseline congelado | Criar |
| `packages/web-shell/_probe-seek-silence-witness.baseline.json` | Baseline do witness | Criar (gerado com `--record`) |
| `docs/superpowers/handoffs/2026-08-07-tabela-b-medida-finding.md` | Marcar o que virou código e o que ficou residual | Modificar (Task 6) |

Os três helpers vivem juntos porque mudam juntos: a travessia define o conjunto, a detecção de partilha filtra o conjunto, a janela opera sobre o conjunto filtrado.

---

## Task 1: A janela básica num tween solto

**Files:**
- Modify: `packages/web-shell/lib/motion-editor/runtime-bridge-source.js` (helpers acima de `seekTimeline`, hoje `:7462`; chamada no ramo GSAP, hoje `:7476-7480`)
- Test: `packages/web-shell/lib/motion-editor/runtime-bridge-source.test.js`

**Interfaces:**
- Consumes: nada de tasks anteriores.
- Produces:
  - `SEEK_SILENCED_CALLBACKS: string[]` — os quatro nomes, nesta ordem.
  - `withSeekLifecycleSilenced(animation: object, write: () => any): any` — abre a janela em torno de `write()`, devolve o valor de `write()`, restaura em `finally`.
  - `collectSeekScope(animation: object): object[]` (Task 2 amplia; nesta task devolve `[animation]`).
  - `seekSharedVarsNodes(scope: object[]): Set<object>` (Task 3 implementa; nesta task devolve `new Set()`).

- [ ] **Step 1: Write the failing test**

Acrescente no fim de `runtime-bridge-source.test.js`, **dentro** do `describe('native motion runtime bridge', ...)`:

```js
  // ---- seek silencioso -------------------------------------------------
  // Fake fiel nos DOIS fatos medidos no GSAP 3.15 de que esta feature depende
  // (finding 2026-08-07, §1 e N3):
  //   - o slot do callback é lido de `vars` NA HORA DO DISPARO, não cacheado;
  //   - `time(v, suppressEvents)` renderiza dos dois jeitos, e só despacha o
  //     ciclo de vida quando `suppressEvents` é falso.
  function makeSeekFixture({ vars: extraVars = {}, duration = 1 } = {}) {
    document.body.innerHTML = '<main><div id="tab"></div></main>';
    const tab = document.getElementById('tab');
    const rendered = { x: 0 };
    let current = 0;
    const vars = { x: 100, duration, ease: 'none', ...extraVars };
    const tween = {
      targets: () => [tab],
      vars,
      duration: () => duration,
      totalDuration: () => duration,
      delay: () => 0,
      repeat: () => 0,
      repeatDelay: () => 0,
      yoyo: () => false,
      reversed: () => false,
      paused: () => true,
      isActive: () => false,
      timeScale: () => 1,
      totalProgress: () => current / duration,
      progress: (p) => (p === undefined ? current / duration : (current = p * duration, tween)),
      scrollTrigger: null,
      invalidate: () => tween,
      pause: () => tween,
      time: (value, suppressEvents) => {
        if (value === undefined) return current;
        const previous = current;
        current = value;
        rendered.x = (current / duration) * 100;
        if (suppressEvents === true) return tween;
        if (previous === 0 && current > 0 && typeof vars.onStart === 'function') vars.onStart();
        if (typeof vars.onUpdate === 'function') vars.onUpdate();
        if (current >= duration && typeof vars.onComplete === 'function') vars.onComplete();
        if (current === 0 && previous > 0 && typeof vars.onReverseComplete === 'function') vars.onReverseComplete();
        return tween;
      },
    };
    window.gsap = {
      globalTimeline: { getChildren: () => [tween] },
      getProperty: (target, prop) => String(rendered[prop]),
    };
    return { tab, tween, vars, rendered };
  }

  function bootAndSelect(tab) {
    const messages = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = (message) => messages.push(message);
    window.eval(getRuntimeBridgeSource());
    tab.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    const selection = messages.find((message) => message.type === 'selection-changed');
    const motion = selection.payload.element.motion.find((clip) => clip.engine === 'GSAP');
    return { messages, motion, restore: () => { window.postMessage = originalPostMessage; } };
  }

  function seek(motionId, currentTime) {
    window.dispatchEvent(new MessageEvent('message', {
      source: window,
      data: {
        protocol: MOTION_EDITOR_PROTOCOL,
        source: 'host',
        type: 'seek-motion',
        payload: { motionId, currentTime },
      },
    }));
  }

  it('silencia o ciclo de vida do site no seek e mantém o onUpdate desenhando', () => {
    const fires = { onStart: 0, onUpdate: 0, onComplete: 0, onReverseComplete: 0 };
    const { tab, vars, rendered } = makeSeekFixture({
      vars: {
        onStart: () => { fires.onStart += 1; },
        onUpdate: () => { fires.onUpdate += 1; },
        onComplete: () => { fires.onComplete += 1; },
        onReverseComplete: () => { fires.onReverseComplete += 1; },
      },
    });
    const antesKeys = Object.keys(vars);
    const antesFns = [vars.onStart, vars.onComplete, vars.onReverseComplete];
    const { motion, restore } = bootAndSelect(tab);

    seek(motion.id, 1000);   // o payload é em MILISSEGUNDOS

    // o ciclo de vida ficou em silêncio...
    expect(fires.onStart).toBe(0);
    expect(fires.onComplete).toBe(0);
    // ...mas o site desenhou
    expect(fires.onUpdate).toBeGreaterThan(0);
    expect(rendered.x).toBe(100);
    // ...e `vars` voltou byte-idêntico
    expect(Object.keys(vars)).toEqual(antesKeys);
    expect([vars.onStart, vars.onComplete, vars.onReverseComplete]).toEqual(antesFns);

    seek(motion.id, 0);      // seek pra trás: o quarto callback
    expect(fires.onReverseComplete).toBe(0);

    delete window.gsap;
    restore();
  });

  it('CONTROLE: sem a janela, o mesmo caminho dispararia — o fake não é cego', () => {
    const fires = { onComplete: 0 };
    const { tween, vars } = makeSeekFixture({
      vars: { onUpdate: () => {}, onComplete: () => { fires.onComplete += 1; } },
    });
    // chamada CRUA, sem passar pelo bridge
    tween.time(1, false);
    expect(fires.onComplete).toBe(1);
    expect(typeof vars.onComplete).toBe('function');
    delete window.gsap;
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/web-shell && bun run test -- runtime-bridge-source --reporter=verbose`
Expected: o caso "silencia o ciclo de vida do site no seek" FALHA em `expect(fires.onComplete).toBe(0)` recebendo `1`. O caso CONTROLE já passa (ele prova que o fake enxerga o disparo — sem isso, o zero do primeiro caso não valeria nada).

- [ ] **Step 3: Write minimal implementation**

Em `runtime-bridge-source.js`, **imediatamente antes** de `function seekTimeline(motionId, nextTime) {`:

```js
  // Os quatro callbacks de ciclo de vida que o editor silencia em volta de uma
  // escrita de relógio. `onRepeat` está aqui porque seekar uma TIMELINE cruza a
  // fronteira de repetição de um filho; `onReverseComplete` porque seekar para 0
  // o dispara na forma mais simples do call-site, sem o site ter revertido nada.
  // Medido no GSAP 3.15 em 2026-08-07 (finding "Tabela B medida", §1 e N1).
  // `onUpdate` NUNCA entra: é ele que desenha.
  const SEEK_SILENCED_CALLBACKS = ['onStart', 'onComplete', 'onRepeat', 'onReverseComplete'];

  function collectSeekScope(animation) {
    return animation ? [animation] : [];
  }

  function seekSharedVarsNodes() {
    return new Set();
  }

  // Silencia o ciclo de vida do site em volta de UMA escrita de relógio.
  // O estado salvo é LOCAL da chamada: um slot de módulo seria sobrescrito por
  // um seek reentrante (o `onUpdate` do site roda aqui dentro e pode disparar
  // outro seek) e as duas restaurações devolveriam `undefined`, deixando o site
  // sem ciclo de vida para sempre.
  function withSeekLifecycleSilenced(animation, write) {
    const scope = collectSeekScope(animation);
    const shared = seekSharedVarsNodes(scope);
    const saved = [];
    scope.forEach((node) => {
      if (shared.has(node)) return;
      const vars = node && node.vars;
      if (!vars || typeof vars !== 'object') return;
      SEEK_SILENCED_CALLBACKS.forEach((key) => {
        let descriptor = null;
        try { descriptor = Object.getOwnPropertyDescriptor(vars, key); } catch (_) { return; }
        // Accessor é maquinaria do próprio site: escrever por ele é efeito
        // colateral a que não temos direito. Fail closed.
        if (descriptor && !('value' in descriptor)) return;
        const own = Boolean(descriptor);
        if (own && descriptor.writable === false && descriptor.configurable === false) return;
        // Só mexe onde HÁ o que silenciar. Chave ausente não vira propriedade
        // própria — anular por atribuição criaria uma chave que o autor nunca
        // escreveu, e ela sobreviveria à restauração (medido, finding §2).
        const effective = own ? descriptor.value : vars[key];
        if (typeof effective !== 'function') return;
        try { vars[key] = undefined; } catch (_) { return; }
        saved.push({ vars, key, own, descriptor });
      });
    });
    try {
      return write();
    } finally {
      saved.forEach((entry) => {
        try {
          if (entry.own) Object.defineProperty(entry.vars, entry.key, entry.descriptor);
          else delete entry.vars[entry.key];
        } catch (_) {}
      });
    }
  }
```

E no ramo GSAP de `seekTimeline`, troque

```js
      const delay = Math.max(0, finite(record.animation.delay?.()) * 1000);
      record.animation.pause?.();
      record.animation.time?.(Math.max(0, time - delay) / 1000, false);
```

por

```js
      const delay = Math.max(0, finite(record.animation.delay?.()) * 1000);
      record.animation.pause?.();
      // A janela cobre APENAS a escrita de relógio: enquanto ela está aberta a
      // forma de `vars` diverge, e `emitTimelineState` (logo abaixo) lê estado.
      withSeekLifecycleSilenced(record.animation, () => {
        record.animation.time?.(Math.max(0, time - delay) / 1000, false);
      });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/web-shell && bun run test -- runtime-bridge-source`
Expected: PASS nos dois casos novos, e nenhum caso antigo quebrado.

- [ ] **Step 5: Commit**

```bash
git add packages/web-shell/lib/motion-editor/runtime-bridge-source.js packages/web-shell/lib/motion-editor/runtime-bridge-source.test.js
git commit -m "feat(motion): janela que silencia os 4 callbacks de ciclo de vida no seek"
```

---

## Task 2: A travessia da descendência

**Files:**
- Modify: `packages/web-shell/lib/motion-editor/runtime-bridge-source.js` (`collectSeekScope`)
- Test: `packages/web-shell/lib/motion-editor/runtime-bridge-source.test.js`

**Interfaces:**
- Consumes: `withSeekLifecycleSilenced`, `collectSeekScope`, `SEEK_SILENCED_CALLBACKS` (Task 1).
- Produces: `collectSeekScope(animation)` devolvendo o nó, os filhos recursivos via `getChildren(true, true, true)` e, quando o nó não expõe `getChildren`, a **própria** `node.timeline` como nó.

- [ ] **Step 1: Write the failing test**

```js
  it('silencia a descendência: filhos, timeline interna de fachada e netos', () => {
    document.body.innerHTML = '<main><div id="tab"></div></main>';
    const tab = document.getElementById('tab');
    const fires = { filho: 0, interna: 0 };
    const rendered = { x: 0 };

    // filho de uma fachada (o que o stagger cria): tem `vars` PRÓPRIA
    const filhoVars = { x: 100, onComplete: () => { fires.filho += 1; } };
    const filho = { vars: filhoVars, targets: () => [tab] };
    // a timeline INTERNA da fachada: um callback aqui escapa se a travessia só
    // descer nos FILHOS dela (medido — finding §4.2)
    const internaVars = { onComplete: () => { fires.interna += 1; } };
    const interna = { vars: internaVars, getChildren: () => [filho] };

    let current = 0;
    const fachada = {
      targets: () => [tab],
      vars: { x: 100, duration: 1, ease: 'none', onUpdate: () => {} },
      timeline: interna,              // fachada NÃO tem getChildren
      duration: () => 1,
      totalDuration: () => 1,
      delay: () => 0,
      repeat: () => 0,
      repeatDelay: () => 0,
      yoyo: () => false,
      reversed: () => false,
      paused: () => true,
      isActive: () => false,
      timeScale: () => 1,
      totalProgress: () => current,
      progress: (p) => (p === undefined ? current : (current = p, fachada)),
      scrollTrigger: null,
      invalidate: () => fachada,
      pause: () => fachada,
      time: (value, suppressEvents) => {
        if (value === undefined) return current;
        current = value;
        rendered.x = current * 100;
        if (suppressEvents === true) return fachada;
        if (typeof fachada.vars.onUpdate === 'function') fachada.vars.onUpdate();
        // o render da fachada renderiza a descendência
        if (typeof internaVars.onComplete === 'function') internaVars.onComplete();
        if (typeof filhoVars.onComplete === 'function') filhoVars.onComplete();
        return fachada;
      },
    };
    window.gsap = {
      globalTimeline: { getChildren: () => [fachada] },
      getProperty: (target, prop) => String(rendered[prop]),
    };

    const { motion, restore } = bootAndSelect(tab);
    seek(motion.id, 1000);

    expect(fires.filho).toBe(0);
    expect(fires.interna).toBe(0);
    // e nada da descendência ficou anulado depois
    expect(typeof filhoVars.onComplete).toBe('function');
    expect(typeof internaVars.onComplete).toBe('function');

    delete window.gsap;
    restore();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/web-shell && bun run test -- runtime-bridge-source -t "descendência"`
Expected: FALHA com `fires.interna` = 1 e `fires.filho` = 1 — a travessia da Task 1 só alcança a fachada.

- [ ] **Step 3: Write minimal implementation**

Substitua `collectSeekScope` por:

```js
  // Todo nó que a escrita de relógio pode renderizar. Duas regras, ambas
  // medidas (finding §4.2):
  //   - filhos quando o nó os expõe (`getChildren(true, true, true)`);
  //   - a PRÓPRIA `node.timeline` como NÓ quando ele não expõe — uma fachada de
  //     stagger não tem `getChildren`, e um callback instalado na timeline
  //     interna dela escapa se descermos só nos filhos dessa timeline.
  // O `Set` de visitados é obrigatório: a `.timeline` de um filho aponta de
  // volta para o pai, e sem ele a descida entra em laço.
  function collectSeekScope(animation) {
    const scope = [];
    const seen = new Set();
    const walk = (node) => {
      if (!node || typeof node !== 'object' || seen.has(node)) return;
      seen.add(node);
      scope.push(node);
      if (typeof node.getChildren === 'function') {
        let kids = null;
        try { kids = node.getChildren(true, true, true); } catch (_) { kids = null; }
        (kids || []).forEach(walk);
      } else if (node.timeline) {
        walk(node.timeline);
      }
    };
    walk(animation);
    return scope;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/web-shell && bun run test -- runtime-bridge-source`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web-shell/lib/motion-editor/runtime-bridge-source.js packages/web-shell/lib/motion-editor/runtime-bridge-source.test.js
git commit -m "feat(motion): travessia recursiva do seek trata .timeline como no"
```

---

## Task 3: Fail-closed quando a configuração é partilhada

**Files:**
- Modify: `packages/web-shell/lib/motion-editor/runtime-bridge-source.js` (`seekSharedVarsNodes`)
- Test: `packages/web-shell/lib/motion-editor/runtime-bridge-source.test.js`

**Interfaces:**
- Consumes: `collectSeekScope` (Task 2).
- Produces: `seekSharedVarsNodes(scope: object[]): Set<object>` — o subconjunto do escopo cuja `vars` é alcançável por uma animação de FORA do escopo. `withSeekLifecycleSilenced` já pula esses nós.

- [ ] **Step 1: Write the failing test**

```js
  it('não abre a janela quando o site partilha a configuração entre animações', () => {
    document.body.innerHTML = '<main><div id="tab"></div><div id="outro"></div></main>';
    const tab = document.getElementById('tab');
    const outroEl = document.getElementById('outro');
    const fires = { compartilhado: 0 };
    const rendered = { x: 0 };
    // UM objeto de configuração, DUAS animações (padrão real de site)
    const cfg = { x: 100, duration: 1, ease: 'none', onUpdate: () => {}, onComplete: () => { fires.compartilhado += 1; } };

    let current = 0;
    const alvo = {
      targets: () => [tab],
      vars: cfg,
      duration: () => 1, totalDuration: () => 1, delay: () => 0,
      repeat: () => 0, repeatDelay: () => 0, yoyo: () => false,
      reversed: () => false, paused: () => true, isActive: () => false,
      timeScale: () => 1, totalProgress: () => current,
      progress: (p) => (p === undefined ? current : (current = p, alvo)),
      scrollTrigger: null, invalidate: () => alvo, pause: () => alvo,
      time: (value, suppressEvents) => {
        if (value === undefined) return current;
        current = value;
        rendered.x = current * 100;
        if (suppressEvents === true) return alvo;
        if (typeof cfg.onUpdate === 'function') cfg.onUpdate();
        if (current >= 1 && typeof cfg.onComplete === 'function') cfg.onComplete();
        return alvo;
      },
    };
    const vizinha = { targets: () => [outroEl], vars: cfg };   // MESMO objeto
    window.gsap = {
      globalTimeline: { getChildren: () => [alvo, vizinha] },
      getProperty: (target, prop) => String(rendered[prop]),
    };

    const { motion, restore } = bootAndSelect(tab);
    seek(motion.id, 1000);

    // fail-closed: a janela NÃO abriu, então o seek se comporta como antes.
    // O preço é este disparo; o ganho é nunca silenciar a vizinha.
    expect(fires.compartilhado).toBe(1);
    expect(typeof cfg.onComplete).toBe('function');

    delete window.gsap;
    restore();
  });

  it('fail-closed também quando não dá para enumerar as animações', () => {
    const fires = { onComplete: 0 };
    const { tab, vars } = makeSeekFixture({
      vars: { onUpdate: () => {}, onComplete: () => { fires.onComplete += 1; } },
    });
    const { motion, restore } = bootAndSelect(tab);
    // depois do boot, o inventário global some (site trocou o gsap, teardown…)
    window.gsap.globalTimeline = { getChildren: () => { throw new Error('sem inventário'); } };

    seek(motion.id, 1000);

    expect(fires.onComplete).toBe(1);      // não provou exclusividade ⇒ não mexeu
    expect(typeof vars.onComplete).toBe('function');

    delete window.gsap;
    restore();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/web-shell && bun run test -- runtime-bridge-source -t "partilha"`
Expected: FALHA — `fires.compartilhado` vem `0` porque a Task 1 devolve `new Set()` e a janela abre para todo mundo.

- [ ] **Step 3: Write minimal implementation**

Substitua `seekSharedVarsNodes` por:

```js
  // O GSAP guarda a REFERÊNCIA do objeto de configuração do autor, então um site
  // que reusa a config (`const cfg = {...}; gsap.to(a, cfg); gsap.to(b, cfg)`)
  // faz duas animações partilharem a MESMA `vars`. Silenciar numa silencia a
  // outra — e o disparo que a vizinha perde no meio não volta com a restauração
  // (medido, finding N2). Decisão de produto de 2026-08-07: fail closed.
  function seekSharedVarsNodes(scope) {
    const shared = new Set();
    const inScope = new Set(scope);
    let all = null;
    try { all = window.gsap?.globalTimeline?.getChildren?.(true, true, true); } catch (_) { all = null; }
    // Sem inventário não há como provar exclusividade — logo, ninguém é seguro.
    if (!Array.isArray(all)) {
      scope.forEach((node) => shared.add(node));
      return shared;
    }
    const owners = new Map();
    all.forEach((animation) => {
      const vars = animation && animation.vars;
      if (!vars || typeof vars !== 'object') return;
      if (!owners.has(vars)) owners.set(vars, []);
      owners.get(vars).push(animation);
    });
    scope.forEach((node) => {
      const vars = node && node.vars;
      if (!vars || typeof vars !== 'object') return;
      const list = owners.get(vars);
      if (list && list.some((animation) => !inScope.has(animation))) shared.add(node);
    });
    return shared;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/web-shell && bun run test -- runtime-bridge-source`
Expected: PASS.

- [ ] **Step 5: Confirmar o refinamento com o Adilson**

Mostre a ele o comportamento implementado — fail-closed **por nó**, não por seek inteiro — e confirme. Se ele preferir o corte grosso, troque a linha `if (shared.has(node)) return;` em `withSeekLifecycleSilenced` por, no topo da função, `if (shared.size) return write();`.

- [ ] **Step 6: Commit**

```bash
git add packages/web-shell/lib/motion-editor/runtime-bridge-source.js packages/web-shell/lib/motion-editor/runtime-bridge-source.test.js
git commit -m "feat(motion): fail-closed no seek quando o site partilha a config entre animacoes"
```

---

## Task 4: Restaurar sem pisar no site, e sobreviver a exceção e reentrância

**Files:**
- Modify: `packages/web-shell/lib/motion-editor/runtime-bridge-source.js` (`withSeekLifecycleSilenced`, bloco `finally`)
- Test: `packages/web-shell/lib/motion-editor/runtime-bridge-source.test.js`

**Interfaces:**
- Consumes: tudo das tasks 1–3.
- Produces: nenhum símbolo novo. `withSeekLifecycleSilenced` passa a (a) não sobrescrever escrita do site feita dentro da janela; (b) restaurar mesmo se `write()` lançar.

- [ ] **Step 1: Write the failing test**

```js
  it('não sobrescreve o callback que o site instalou dentro da janela', () => {
    const fires = { nova: 0 };
    const original = () => {};
    const nova = () => { fires.nova += 1; };
    const { tab, vars } = makeSeekFixture({
      vars: {
        onComplete: original,
        onUpdate: function () { vars.onComplete = nova; },   // o site repõe a própria reação
      },
    });
    const { motion, restore } = bootAndSelect(tab);

    seek(motion.id, 1000);

    // resíduo ACEITO (decisão 2026-08-07): a reposta do site dispara.
    // O que NÃO pode acontecer é a restauração apagar a escrita dele.
    expect(vars.onComplete).toBe(nova);

    delete window.gsap;
    restore();
  });

  it('restaura os callbacks mesmo se o desenho do site lançar', () => {
    const original = () => {};
    const { tab, vars, tween } = makeSeekFixture({
      vars: { onComplete: original, onUpdate: () => { throw new Error('desenho do site quebrou'); } },
    });
    const { motion, restore } = bootAndSelect(tab);

    // o bridge não pode deixar o site sem ciclo de vida por causa de um erro dele
    expect(() => seek(motion.id, 1000)).not.toThrow();
    expect(vars.onComplete).toBe(original);

    delete window.gsap;
    restore();
  });

  it('sobrevive a um seek reentrante disparado de dentro do desenho do site', () => {
    const original = () => {};
    let reentrou = false;
    let motionId = null;
    const { tab, vars } = makeSeekFixture({
      vars: {
        onComplete: original,
        onUpdate: () => {
          if (reentrou || !motionId) return;
          reentrou = true;
          seek(motionId, 500);          // seek ANINHADO, de dentro da janela
        },
      },
    });
    const { motion, restore } = bootAndSelect(tab);
    motionId = motion.id;

    seek(motion.id, 1000);

    expect(reentrou).toBe(true);
    expect(vars.onComplete).toBe(original);   // o estado salvo é da CHAMADA

    delete window.gsap;
    restore();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/web-shell && bun run test -- runtime-bridge-source -t "não sobrescreve"`
Expected: FALHA — `vars.onComplete` volta a ser `original`, porque o `finally` da Task 1 restaura sem olhar. Os outros dois casos já devem passar (o `try/finally` e o estado local já estão certos desde a Task 1); se algum falhar, é bug de verdade e o fix entra aqui.

- [ ] **Step 3: Write minimal implementation**

No `finally` de `withSeekLifecycleSilenced`, troque o corpo do `forEach` por:

```js
      saved.forEach((entry) => {
        // O site pode ter instalado o próprio callback de dentro do `onUpdate`,
        // que roda com a janela aberta. Essa escrita é DELE — nunca pintar por
        // cima (finding N5, face b). Só restauramos o slot que continua como
        // deixamos: `undefined`.
        let current = null;
        try { current = Object.getOwnPropertyDescriptor(entry.vars, entry.key); } catch (_) { return; }
        if (current && 'value' in current && current.value !== undefined) return;
        try {
          if (entry.own) Object.defineProperty(entry.vars, entry.key, entry.descriptor);
          else delete entry.vars[entry.key];
        } catch (_) {}
      });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/web-shell && bun run test -- runtime-bridge-source`
Expected: PASS nos três.

- [ ] **Step 5: Rodar a suíte inteira**

Run: `cd packages/web-shell && bun run test`
Expected: **1623 + os casos novos** passed, 10 skipped, zero falha.

- [ ] **Step 6: Commit**

```bash
git add packages/web-shell/lib/motion-editor/runtime-bridge-source.js packages/web-shell/lib/motion-editor/runtime-bridge-source.test.js
git commit -m "feat(motion): restauracao do seek nao pisa na escrita do site; a prova de excecao e reentrancia"
```

---

## Task 5: Witness no GSAP 3.15 real

**Files:**
- Create: `packages/web-shell/_probe-seek-silence-witness.mjs`
- Create: `packages/web-shell/_probe-seek-silence-witness.baseline.json` (via `--record`)

**Interfaces:**
- Consumes: o bridge inteiro, pelo caminho de protocolo v2 (`getRuntimeBridgeSource()`).
- Produces: um executável assertivo — `node _probe-seek-silence-witness.mjs` sai 0 quando o comportamento bate com o baseline.

O fake da Task 1–4 é fiel só nos pontos medidos. Esta task prova o mesmo no motor real, pelo caminho real.

- [ ] **Step 1: Escrever o witness**

Use `_probe-b4-witness.mjs` como template do harness in-page (boot v2 real + negotiate + seleção). Casos obrigatórios, cada um em página nova e com **controle de sensibilidade**:

1. **tween solto** — `onStart`/`onComplete` a zero na janela; `onUpdate` roda; deslocamento renderizado chega ao fim; `vars` byte-idêntico (chaves, ordem, identidade das funções).
2. **seek pra trás** — `onReverseComplete` a zero; controle sem a janela = 1.
3. **timeline com filho `repeat: 2`** — seek `1.5 → 2.5 → 0.2`; controle 1/2/3; com a janela 0; e **volta a disparar depois** (suprimir ≠ destruir).
4. **fachada de stagger dentro de timeline**, `stagger` em forma de OBJETO (dá callback próprio a cada filho) e um callback na timeline interna — tudo a zero; controle > 0 em todos.
5. **config partilhada** — a vizinha, avançada de dentro do `onUpdate`, **mantém** o `onComplete` (fail-closed funcionando).
6. **desenho derivado** — animação cujo único output vive no `onUpdate` continua desenhando durante o scrub (é o caso A5 do finding, a razão de toda a feature).

Regras do instrumento, todas já custaram rodada nesta frente:
- **elemento próprio por caso** (nunca reusar alvo entre braços);
- **pré-render suprimido** antes de abrir qualquer janela, com asserção de que o alvo **moveu e não chegou ao fim**;
- **controle por braço** antes de acreditar em qualquer zero;
- desenho medido por **deslocamento renderizado**, nunca por contagem de `onUpdate`.

- [ ] **Step 2: Rodar e ver falhar sem o baseline**

Run: `cd packages/web-shell && node _probe-seek-silence-witness.mjs`
Expected: FALHA com "baseline ausente".

- [ ] **Step 3: Congelar o baseline**

Run: `cd packages/web-shell && node _probe-seek-silence-witness.mjs --record > _probe-seek-silence-witness.baseline.json`

Antes de aceitar: leia o JSON e confira que **cada controle é maior que zero** e cada braço com janela é zero. Baseline com controle zerado congela um instrumento cego.

- [ ] **Step 4: Rodar assertivo**

Run: `cd packages/web-shell && node _probe-seek-silence-witness.mjs`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add packages/web-shell/_probe-seek-silence-witness.mjs packages/web-shell/_probe-seek-silence-witness.baseline.json
git commit -m "test(motion): witness do seek silencioso no GSAP 3.15 real"
```

---

## Task 6: Auditoria do Sol, doc e fecho

**Files:**
- Modify: `docs/superpowers/handoffs/2026-08-07-tabela-b-medida-finding.md`

**Interfaces:**
- Consumes: tudo.
- Produces: o finding refletindo o que virou código e o que ficou residual.

- [ ] **Step 1: Rodar a suíte e todos os witnesses da frente**

```bash
cd packages/web-shell
bun run test
for w in _probe-b4-witness _probe-b5-witness _probe-b6-witness _probe-entryedit-witness _probe-furo2-witness _probe-seek-silence-witness; do node $w.mjs >/dev/null 2>&1; echo "$w -> $?"; done
```
Expected: suíte verde; todo witness exit 0.

- [ ] **Step 2: Auditoria adversarial**

Use a skill `adversarial-review` sobre o diff completo desta frente, Codex em `max`, no padrão da frente (bundle escopado, `--mode prose --file <diff>`). Rodadas até MERGE OK. Todo achado é reproduzido com RED antes do fix.

- [ ] **Step 3: Atualizar o finding**

No `2026-08-07-tabela-b-medida-finding.md`, marque §4 com o que virou código, e deixe explícito o único residual que sobrevive ao ship: **o site repondo a reação de dentro do `onUpdate` durante o arrasto** (decisão de aceitar, 2026-08-07). Anote também que o ramo CSS/WAAPI segue sem cobertura (B4, fora de escopo).

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/handoffs/2026-08-07-tabela-b-medida-finding.md
git commit -m "docs(motion): finding reflete o seek silencioso shipado e o residual aceito"
```

---

## Self-review deste plano

**Cobertura das decisões e obrigações do finding §4:**

| Obrigação | Task |
|---|---|
| §4.1 anular ciente de `hasOwn` + descritor + sombra | 1 (Step 3) |
| §4.2 travessia recursiva com `.timeline` como nó + `Set` | 2 |
| §4.3 janela tão estreita quanto a escrita de relógio | 1 (Step 3, wiring) |
| §4.4 partilha de `vars` fail-closed | 3 |
| §4.5 quatro callbacks | 1 (`SEEK_SILENCED_CALLBACKS`) |
| §4.6 estado salvo pertence à chamada | 1 (implementação) + 4 (teste de reentrância) |
| §4.7 N5 residual aceito, sem pisar na escrita do site | 4 |
| §4.8 witness comportamental (B5 estava PARCIAL) | 5 |
| À prova de exceção | 4 |
| Nunca sintetizar callback | garantido por construção — só há atribuição de `undefined` e restauração do valor guardado |

**Riscos anotados, não escondidos:**
- O fake do Vitest é fiel só nos dois fatos medidos; tudo além disso é a Task 5 que cobre. Se um caso passar no fake e falhar no witness, **o witness manda**.
- `seekSharedVarsNodes` enumera `globalTimeline` a cada seek, e o scrub é caminho quente. Se aparecer custo no clone real, a saída é cachear o mapa por gesto (invalidando ao mudar seleção), **não** relaxar o fail-closed.
