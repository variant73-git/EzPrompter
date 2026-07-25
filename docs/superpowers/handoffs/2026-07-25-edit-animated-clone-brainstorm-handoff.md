# Handoff — Brainstorm: adaptar o editor para editar o CLONE ANIMADO (2026-07-25)

**Tipo:** continuação de BRAINSTORM (design, NÃO implementação). **Status:** aguardando o Adilson **escolher entre 3 caminhos (A/B/C)** — ver §7. **Base:** `main` (a frente de captura/pin está SHIPPED, ver §2).

> **Instrução pro agente desta sessão:** isto é brainstorming. Invoque a skill `superpowers:brainstorming` e siga o fluxo (perguntas → aprovação → spec → writing-plans). **NÃO implemente nada** até o Adilson aprovar um design e o spec estar escrito. O primeiro passo é apresentar as 3 opções da §7 pra ele escolher; depois continuar o brainstorm a partir da §8.

---

## 1. TL;DR — a decisão que falta
Temos um **novo clone para sites animados** (DOM real + runtime GSAP/Lottie **preservado e vivo**) — muito melhor que o iter9. O editor que temos hoje foi feito pra sites **estáticos** (ou processados pelo iter9, que também vira HTML estático). **Falta adaptar o editor pra editar um clone ANIMADO.**

Já ficou decidido o **modelo de edição = congelar o instante (freeze-frame)**: a animação é 100% preservada, só **pausa no frame atual** enquanto o usuário edita, e a edição é **escopada ao viewport** (o que está enquadrado é o que dá pra editar). NÃO é nerf, NÃO estatiza, NÃO edita ao vivo em movimento.

**A escolha pendente (§7):** *qual instante* congelar / como identificar o ponto de edição ideal — **manual, automático inteligente, ou híbrido.**

---

## 2. Contexto desta sessão (o que veio antes — já SHIPPED)
A sessão começou consertando o **"pixelated hero"** do farmminerals e evoluiu:
- Causa raiz: `pinViewportUnits` (`packages/web-shell/lib/snapshot.js`) fazia replace global `\d+vh|vw`→px no HTML inteiro e **corrompia o base64 das data-URIs** (382 subst. num Lottie inline de 7,5MB). Fix: pinar só em contexto de CSS real.
- Evoluiu pra **pin via CSSOM no DOM vivo antes de serializar** (`pinDomViewportUnits`) → data-URIs byte-a-byte por construção. Auditado 3× pelo Sol. Commits `ede0d438` + `2083471d`. CLAUDE.md 163/164. **Essa frente está fechada.**
- Depois, ao discutir "paridade na extensão", descobrimos que a **extensão faz captura ESTÁTICA do DOM** (gêmea client-side do `captureSnapshot`, pra handoff Cloudflare/login) — **não faz iter9**. Isso disparou a conversa estratégica abaixo.

## 3. O "novo clone" (confirmado pelo Adilson)
- **iter9** (o caminho antigo pra animados): **prompt + gravação de vídeo + assets originais baixados** → reconstruía todas as animações GSAP/three.js por VISÃO. Server-side, caro (2-3 min), e produz um clone **plano** (perde a editabilidade da animação).
- **Novo clone** (o caminho novo, muito melhor): **DOM real + runtime GSAP/Lottie PRESERVADO e vivo.** É a etapa que roda quando o usuário clica em **"Clone & Edit"**. Mantém a animação **viva e editável**, em vez de reconstruí-la por visão.

## 4. O que significa "adaptar o editor"
O editor atual (page editor — mover/estilizar/trocar texto de elementos; `editor/editor.js`) foi feito pra **sites estáticos** ou saída do iter9 (HTML estático). Agora clonamos **animados**, então o editor precisa lidar com elementos que **se mexem**. Duas camadas de edição:
- **Layout/estilo** (mover, recolorir, redimensionar) = o page editor, que precisa se adaptar.
- **As animações em si** (timing, keyframes, curvas) = o **motion editor**, que já existe (ver §6) mas vive isolado (porta 3032, fixture de disco).

## 5. Decisões JÁ travadas neste brainstorm
1. **Modelo = freeze-frame** (congelar o instante). A animação é preservada; só pausa no frame atual pra editar; ao sair/rolar, retoma. Reusa `freeze.js` (já congela GSAP/Lenis/Webflow IX) + o viewport-scoping do motion editor.
2. **Edição escopada ao VIEWPORT.** O que está enquadrado no viewport (o site no centro do canvas, entre os painéis) é o que dá pra editar. Elemento cuja animação ainda não entrou no viewport = nada pra editar ali (ainda).

## 6. Infra que já existe (o elo que destrava)
- **Motion editor**: `packages/web-shell/components/motion-editor/NativeMotionEditor.jsx` (exporta `MotionPanel`, `TimelinePanel`) + `packages/web-shell/lib/motion-editor/` (`runtime-bridge-source.js` = bridge injetado no site, fala por postMessage; `native-clone-gateway.js` com `injectRuntimeBridge(html)`).
- ⭐ **A timeline já foi redesenhada com "rows por CHEGADA"** (checkpoint 2026-07-20): o motion editor **já sabe, por elemento, o ponto de scroll onde a animação dele completa e ele assenta**. Isso é o dado-chave pro caminho B/C da §7.
- **Viewport-scoping já existe** no motion editor (`viewport-motion-changed`/`inspect-viewport`, debounce 120ms) + scrubber = scroll da página.
- **HTML do nó disponível**: `snapshots.html` via `nodes.current_snapshot_id`; `app/preview/[nodeId]/page.jsx` serve `srcDoc={node.html}`. `injectRuntimeBridge(node.html)` injeta o bridge nesse HTML — o elo que faltava.
- **Proposta guardada de integração** ([[feature_motion_editor_canvas_integration]], adiada 2026-07-24): servir o site do nó com o bridge injetado como iframe vivo; extrair a superfície Motion num componente embutível; aba **"Motion"** no `CanvasInspector` (junto a Properties/Code); **timeline encaixada EMBAIXO do canvas** (não espremida na lateral); manter `/motion-editor` isolada pra dev.
- **freeze.js**: `packages/editor-core/src/freeze.js`.

---

## 7. ⭐ A ESCOLHA — qual instante congelar / como achar o ponto de edição
> Apresentar estas 3 opções ao Adilson e deixar ELE escolher.

**A — Manual (o usuário rola até o ponto).** Ele rola o site no canvas; onde parar, congela; o que estiver assentado no viewport é editável. Controle total, reusa scrubber=scroll. *Contra:* pode parar no meio de uma transição e editar um elemento meio-animado — não é o "look real" dele.

**B — Auto-assentar (inteligente).** Ao selecionar um elemento (ou ao rolar uma região pro viewport), o sistema **avança a animação até o estado de REPOUSO** daquele elemento (o ponto de "chegada" que o motion editor já calcula em §6) → edita-se o look final pretendido, nunca um frame no meio. *Contra:* "repouso" precisa de definição robusta pra elementos em loop / sem fim claro.

**C — Híbrido (recomendação do agente anterior ⭐).** Padrão = auto-assentar no repouso (B), porque o caso comum é editar o **look final**; MAS o scrubber fica exposto: pra editar um momento específico (ex.: como o elemento aparece a 50% da entrada), rola/scrub até lá e congela (A). Automático acerta a maioria; manual é a válvula de escape. Responde "manual ou automático?" com **"automático como default, manual à mão."**

**Ressalva (vale pra B e C):** elementos em **LOOP** (ex.: o pill girando do farmminerals) não têm "repouso" único → caem num frame do loop ou no frame base. Decidir depois como tratar loop.

---

## 8. Próxima pergunta do brainstorm (DEPOIS da escolha A/B/C)
Quando o usuário **move/estiliza** o elemento no frame congelado, a edição precisa virar o **novo ALVO da animação** (a animação passa a animar ATÉ a nova posição/estado) — senão a animação "briga" com a edição no replay e sobrescreve. Ou seja: editar no frame de repouso deve fluir pro **estado-base/alvo final** do elemento na animação, não ser um override estático solto. Isso é o próximo crux a resolver (o motion editor conhece a estrutura da animação, então é viável — mas precisa de design).

Outras perguntas em aberto pro brainstorm depois: (a) como o page editor e o motion editor coexistem na mesma superfície (aba Motion + timeline embaixo, per §6); (b) tratamento de loop; (c) o que acontece com elementos parcialmente no viewport; (d) persistência (o edit vira snapshot novo do nó, como no fluxo atual).

## 9. Ponteiros
- Memória: [[feature_motion_editor_canvas_integration]], [[checkpoint_2026-07-20_motion-timeline-figma]] (rows por chegada), [[checkpoint_2026-07-19_motion-editor-phases]], [[checkpoint_2026-07-25_cssom-pin-shipped]].
- CLAUDE.md: seção "Frente atual: Motion editor nativo" + itens 153–164.
- Handoffs motion: `docs/superpowers/handoffs/2026-07-20-motion-timeline-figma-handoff.md`, `2026-07-18-motion-editor-redesign-and-handoff.md`.
