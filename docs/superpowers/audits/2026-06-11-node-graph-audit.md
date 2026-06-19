# Auditoria — Grafo de nodes, categorias e gaps (2026-06-11)

Auditoria do paradigma node-based do Uncraft: o que cada categoria de node faz hoje, onde os motores de execução divergem, respostas às perguntas abertas e a matriz de combinações possíveis.

---

## 1. O paradigma e o paralelo com Weavy/Flora

Weavy (agora Figma Weave, pós-aquisição out/2025) e Flora operam sobre **artefatos midiáticos**: imagem, vídeo, texto. Cada node é uma *operação explícita* (gerar, upscale, style transfer, inpaint) e as edges carregam dados de um passo pro outro. O grafo é a "receita" — re-rodar regenera o pipeline.

O Uncraft transpõe isso para **sites como artefato**. O mapeamento conceitual:

| Weavy/Flora | Uncraft |
|---|---|
| Imagem/vídeo gerado | Node `site` (HTML vivo) |
| Style transfer entre imagens | Demarcelizer (reskin A→B) |
| Prompt block alimentando gerador | Node `prompt` |
| Style reference / LoRA | Node `designmd` (.md de design tokens) |
| Upscale/inpaint sobre output | `editSite` / refinement |
| Copiloto que monta o grafo | Chat widget (PromptDock agent) |

**Diferença estrutural importante**: em Weavy a operação vive *no node* (cada node é uma função visível). No Uncraft a operação vive *implícita no mix de sources do target* — "target type = output type", e o COMPOSE_SYSTEM decide reskin/restyle/compose pelo que chega nas edges. É mais elegante (menos tipos de node), mas mais **opaco**: o usuário não vê o que o ▶ vai fazer antes de rodar. Weavy mostra; Uncraft infere.

**Diferencial único do Uncraft** que nenhum dos dois tem: o node terminal é *editável in-place* (editor Figma-like). Em Weavy o output é pixel final; aqui o output é matéria-prima de novo ciclo. Esse é o moat — proteger e aprofundar.

---

## 2. Estado real das 5 categorias

As 5 categorias do produto mapeiam assim para os `kind` do banco (`VALID_KINDS` em `app/api/nodes/route.js:5` — `site, template, designmd, chunk, prompt, skill, asset`):

| Categoria (produto) | kind (DB) | Aquisição | O que o snapshot guarda |
|---|---|---|---|
| URL | `site` | `captureUrl` / snapshot.js / handoff extension | `html` + `screenshot_url` (**não** gera `design_md`) |
| .html | `site` | upload via PromptDock | `html` |
| Blank website | `site` | botão "+" / agent `createNode` | `BLANK_SITE_HTML` seed |
| .md | `designmd` | upload `.md`/`.markdown` | `design_md` (texto markdown) |
| prompt | `prompt` | PromptDock / agent | `meta.prompt` (não usa snapshot) |
| imagem | `asset` | upload / `createImage` / `addAssetFromUrl` | `meta.dataUrl` |

`template` e `chunk` são **legados** — aceitos em VALID_KINDS e no bucket html do run-flow, mas sem caminho de criação na UI atual. Candidatos a remoção.

### Os três motores de execução (e por que isso importa)

1. **run-flow** (`lib/run-flow.js`, `COMPOSE_SYSTEM`) — executor determinístico do grafo. Agrupa sources por kind em buckets (html/md/prompt/asset), monta um prompt único com matriz de operação ("HTML only → reskin; DESIGN.MD only → restyle; PROMPT + outro → prompt como diretiva primária"). Disparado por: seta do PromptDock, ▶ de section, tool `runFlow` do agent. Ignora `edge.kind` por design.
2. **Demarcelizer** (`lib/demarcelize.js`, `RESKIN_SYSTEM` + `TASTE_PRINCIPLES`) — o port do verbatim Google Stitch. Mais rico que o COMPOSE_SYSTEM: processo interno em 3 passos, hard rules de substituição de copy, taste principles. Usado por: tool `applyDesign` do agent e rotas `/api/demarcelize`. **Não é usado pelo run-flow.**
3. **editSite** (`EDIT_SITE_SYSTEM`) — edição pontual plain-language, in-place.

> **Achado central da auditoria**: o "transplante de estilo" tem **dois cérebros com prompts diferentes**. Conectar site A → site B e apertar ▶ roda o reskin do COMPOSE_SYSTEM; pedir a mesma coisa no chat roda o RESKIN_SYSTEM do Demarcelizer (via extractDesign+applyDesign). Mesma intenção, resultados potencialmente diferentes, e o usuário não tem como saber qual caminho foi usado. Recomendação na seção 5.

---

## 3. Respostas às perguntas da auditoria

### 3.1 "Consigo extrair .md de um site?"
**Não — é o gap nº 1.** A coluna `snapshots.design_md` existe, o bucket md do run-flow existe, o COMPOSE_SYSTEM já sabe consumir DESIGN.MD — mas **nada popula `design_md` a partir de um site capturado**. `lib/snapshot.js` e `lib/reconstruct.js` salvam apenas HTML + screenshot (zero referências a design_md). O `.md` só entra por upload manual.

O irônico: o `generateDesignMD()` Aura-parity de **1.974 linhas já existe** em `overlay/extractor.js` da extensão (overview, palette com semantic roles, typography com Tailwind annotations, components, responsive behavior). Nunca foi portado pro server. Há ainda o `generateDesignMDFromImage()` (vision) na extensão. O trabalho é de **port, não de invenção**.

E o `extractDesign` do agent? Ele **não extrai .md** — cria um node `designmd` cujo snapshot guarda o **HTML inteiro** do site como template (`extract-design.js:54-58`, insere em `snapshots.html`, `design_md` fica NULL). É um "save this look", não uma extração de design system.

### 3.2 "E depois aplicar a outro?"
**Sim, se o .md existir.** Upload de `.md` → node designmd → edge para um site → ▶ funciona: o COMPOSE_SYSTEM aplica "DESIGN.MD only → restyle: keep target structure verbatim; apply md tokens". O pipeline de *aplicação* está pronto; falta o de *extração* (3.1).

### 3.3 BUG encontrado: designmd extraído é inerte no run-flow
O node `designmd` criado por `extractDesign` (html preenchido, design_md NULL) cai no bucket md do `bucketSources()` (`run-flow.js:154`), mas o `assemblePrompt()` só injeta `source_design_md` (`run-flow.js:167-169`). Resultado: conectar esse node a um target e rodar ▶ **passa sem erro e não contribui nada** — o LLM recebe só o TARGET HTML. Esses nodes só funcionam pelo caminho do agent (`applyDesign`, que lê o html e chama `reskin`).

Fix mínimo (1-3 linhas): no `assemblePrompt`, fallback para `source_html` de nodes designmd como `HTML SOURCE (style template)`. Fix correto: extractDesign gerar .md de verdade (3.1).

### 3.4 "O node de prompt conectado cria a interferência adequadamente?"
**Sim.** `meta.prompt` entra como `PROMPT INSTRUCTION` no prompt composto, e o COMPOSE_SYSTEM tem precedência explícita: *"ALWAYS follow the prompt over the defaults"* e *"PROMPT + any other source → follow the prompt as the primary directive; use the other sources as material"*. A interferência funciona tanto sozinha (instrução direta no target) quanto como modulador de um transplante (site+prompt → reskin dirigido).

### 3.5 "O node de prompt é redundante com o chat widget?"
**Não — e a distinção já está formalizada** no BOARD_AGENT (`lib/agent/prompts.js:38-47`), que define 6 critérios para promover prompt a node vs manter inline. A semântica resultante:

- **Chat** = executor/orquestrador *efêmero*. Constrói o skeleton, dispara operações, traduz intenção em grafo. Instruções "skeleton" (add CTA, remove footer) ficam inline.
- **Prompt node** = *variável persistente do grafo*. Direção qualitativa (tom, paleta, voz de marca), reutilizável em múltiplos targets, iterável. É o "style block" do paradigma Weavy.

A regra do prompt resume bem: *"Skeleton = inline. Non-skeleton + pointing = node."* Não há redundância — há camadas. O risco real é de **percepção** (usuário não saber quando usar qual), o que é problema de onboarding/UI, não de arquitetura.

### 3.6 "O node de .html é redundante com URL e blank website?"
**Não — são três rotas de aquisição para o mesmo kind `site`**, e convergir é a decisão certa: no grafo, os três se comportam identicamente (bucket html como source; target válido pro compose). O paralelo Weavy: um image node pode nascer de upload, geração ou URL — é o mesmo tipo no grafo. A diferenciação é visual (origin colors: URL=sky, HTML=orange, blank=teal) e de proveniência (`origin_url`, `meta.source`), o que é o desenho correto. Redundância real só existe nos kinds legados `template`/`chunk`.

### 3.7 "URL → URL + pedir transplante no chat: a ferramenta já sabe fazer?"
**Sim, por dois caminhos — e é exatamente esse o problema.**

- **Caminho do grafo (sem chat):** conectar site A → site B e apertar ▶ **já transplanta hoje**: A cai no bucket html, COMPOSE_SYSTEM executa "HTML only → reskin: preserve the target's exact text content, replace the target's structural chassis with the source HTML's chassis". Conteúdo de B + estilo de A. Não precisa de .md.
- **Caminho do chat:** o agente tem `extractDesign(A)` → designmd → `applyDesign(designmd, B)` → **novo** site node com edges dos dois sources (Demarcelizer/Stitch verbatim). 

Divergências entre os caminhos: (a) prompts diferentes → outputs diferentes; (b) o ▶ sobrescreve B in-place, o chat cria um terceiro node; (c) se o usuário já desenhou a edge A→B e pede no chat, o agente *pode* chamar `runFlow(B)` (que honraria o grafo) ou *pode* criar a cadeia extractDesign+applyDesign paralela — o BOARD_AGENT não tem regra de desambiguação para isso. E em nenhum dos caminhos um `.md` genuíno é extraído (3.1).

---

## 4. Matriz de combinações — o que existe, o que falta, o que é possível

Notação: P=prompt, S=site (URL/.html/blank), M=designmd (.md), A=asset (imagem). Target em **negrito**.

### Suportado hoje (target site, via run-flow)

| Combinação | Operação (COMPOSE_SYSTEM) | Status |
|---|---|---|
| S → **S** | Reskin: chassis do source, conteúdo do target | ✅ |
| M → **S** | Restyle: estrutura do target + tokens do md | ✅ (md via upload apenas) |
| P → **S** | Instrução direta sobre o target | ✅ |
| A → **S** | Imagem como referência visual (força gpt-5.5 vision) | ✅ |
| S + M → **S** | Chassis do HTML + tokens do md como override | ✅ |
| S + P → **S** | Reskin dirigido pelo prompt | ✅ |
| A + P → **S** | "Screenshot do Dribbble + use esse estilo" — S2H no canvas | ✅ |
| S + S → **S** | Multi-chassis (assemblePrompt numera HTML SOURCE 1, 2…) | ✅ mecânico; prompt não orienta como fundir dois chassis |
| P + M + S → **S** | Compose completo | ✅ |
| (vazio) → **S blank** | Compose sobre BLANK_SITE_HTML seed | ✅ |

### Suportado só via agent (fora do grafo visível do ▶)

| Operação | Tool | Nota |
|---|---|---|
| S → M(html) | `extractDesign` | Gera template HTML, não .md (3.1/3.3) |
| M(html) + S → **S novo** | `applyDesign` | Demarcelizer reskin |
| P → **A** | `createImage` | text-to-image |
| A + P → **A** | `createImage` edit / style-ref | image-to-image |
| URL externa → A | `addAssetFromUrl` | ingest de imagem |
| URL → S | `captureUrl` | snapshot pipeline |

### Não existe — gaps e oportunidades (ordenado por valor)

| Combinação | O que seria | Valor |
|---|---|---|
| S → **M** | **Extrair DESIGN.md de um site** (port do generateDesignMD ou vision call sobre screenshot) | 🔥 Destrava a categoria .md como variável de primeira classe; é o "extract style" do paradigma Weavy |
| A → **M** | Extrair design tokens de uma imagem (`generateDesignMDFromImage` já existe na extensão) | 🔥 Moodboard→design system→site: pipeline que nenhum concorrente tem |
| M + M (+P) → **M** | Fundir/remixar design systems ("paleta deste + tipografia daquele") | Alto — design tokens como material editável e combinável |
| S → **A** | Screenshot do site como asset (matéria-prima pra createImage) | Médio — fecha o ciclo site→imagem→site |
| run-flow com target M/A/P | Hoje `targetIsHtml` only (`run-flow.js:195`) | Pré-requisito técnico das linhas acima |
| P + P → **P** | Composição de prompts (refinar direção com direção) | Baixo, mas trivial |
| S(×3) → M → **S** | "Capture 3 referências, destile um design system, aplique" | A killer demo do produto |

A leitura da matriz: **a metade "aplicar" está construída; a metade "extrair/destilar" não existe**. Em Weavy/Flora o grafo flui nos dois sentidos (gerar e derivar); no Uncraft hoje todo fluxo converge para target site. O `.md` é a categoria com maior potencial não realizado — é a única representação *legível e editável pelo humano* do estilo, e hoje só entra por upload.

---

## 5. Recomendações priorizadas

1. **Fix do designmd inerte** (bug 3.3) — fallback `source_html` no assemblePrompt. ~1h, elimina um silent-fail real.
2. **Port do generateDesignMD pro server** — `lib/design-md.js` chamado por: pós-captura (snapshot.js, opcional/lazy), `extractDesign` (passa a gerar .md de verdade), e nova combinação S→M no grafo. O código de referência já existe na extensão; a alternativa rápida é uma vision call sobre screenshot+html (mesmo padrão do Aura).
3. **Unificar os motores de transplante** — decidir um dono: ou o run-flow delega ao Demarcelizer quando o mix é html-only, ou o RESKIN_SYSTEM+TASTE_PRINCIPLES vira o braço reskin do COMPOSE_SYSTEM. Critério: rodar os dois no mesmo par A/B e comparar (os prompts do Demarcelizer são mais rigorosos; aposta segura é ele vencer).
4. **Regra de desambiguação no BOARD_AGENT** — "se a edge já existe entre os nodes citados, use `runFlow` no target; só crie cadeia extractDesign+applyDesign quando o usuário quiser preservar o original ou reutilizar o estilo em múltiplos alvos."
5. **Operação visível antes do run** — chip no target (ou label na edge) mostrando o que o ▶ fará ("reskin", "restyle", "compose"), derivado do mesmo bucketSources. Resolve a opacidade apontada na seção 1; os edge kinds semânticos legados (transplant/token-swap/reskin) podem renascer aqui como UI em vez de serem deletados.
6. **Generalizar targets do run-flow** (M e A como target) — pré-requisito das combinações de extração/destilação da matriz.
7. **Limpar kinds legados** `template`/`chunk` (ou documentar por que ficam).

---

## 6. Addendum (2026-06-12) — Decisões do usuário e plano revisado

Três decisões ratificadas após a auditoria:

### D1. Convenção: resultado escreve POR CIMA do target node (histórico in-node)

Nas ferramentas node-based há dois paradigmas: **grafo-como-receita** (ComfyUI, Blender nodes, TouchDesigner — nodes são operações, outputs transientes, nada persiste no node) e **grafo-como-coleção-de-artefatos** (Weavy/Figma Weave, Flora — nodes SÃO os artefatos; gerar preenche o node, re-gerar substitui o conteúdo com histórico de versões in-node; branch é ação explícita de duplicar/fork). O Uncraft é do segundo paradigma, e a convenção dessas ferramentas é exatamente a decidida: **resultado sobrescreve o node alvo + histórico interno** (já temos: `parent_snapshot_id`, Saved versions, Reset).

**Desvio a corrigir**: `applyDesign` cria um TERCEIRO node em vez de escrever sobre o target — comportamento de fork implícito, agora declarado não-default. Passa a sobrescrever o site target; fork continua disponível como ação explícita (Duplicate no More menu).

**Edge cases do overwrite-in-place** (mapeados, por severidade):

1. **Target que também é source de outra cadeia** (A→B, B→C): sobrescrever B muda o input futuro de C silenciosamente. Mitigação convencional: marcar edges downstream como *stale* após snapshot novo no source (a coluna `edges.status` já existe — adicionar valor `stale`).
2. **Cadeias A→B→C**: o ▶ roda só o terminal (`findSectionTerminal`); se B nunca rodou, C compõe sobre o seed blank de B. Falta *cascade run* topológico (rodar B, depois C) ou ao menos aviso "upstream não executado".
3. **Ciclos**: não há guard em `/api/edges` — A→B→A é criável hoje. Com overwrite + futuro cascade, ciclo = loop infinito. Adicionar verificação de aciclicidade no addEdge.
4. **Run durante edit**: `editSite` já guarda `node_open_in_edit` — replicar o mesmo lock no run-flow (▶ num node aberto no editor).
5. **Concorrência** (agent run + ▶ manual no mesmo target): last-write-wins hoje; aceitável para MVP, registrar.

### D2. Mecânica "smart mixing" ratificada + regra única de motor

A arquitetura atual do `runCompose` já É o modelo decidido: uma única call inteligente com todos os materiais anexados (equivalente a subir os arquivos no Claude + request), onde o único hardcode é o system prompt — a "instrução para rodar sem interferência de chat". Nada a mudar estruturalmente; o fix do designmd inerte (3.3) garante que todo material conectado chegue de fato à call.

**Regra única Demarcelizer vs ▶** (decisão: Demarcelizer vira regra geral se confirmado superior):

> Todo run cujo mix de sources é **html-only** (site/html, sem md/prompt/asset) usa `RESKIN_SYSTEM` como system prompt. Qualquer outro mix usa `COMPOSE_SYSTEM` **enriquecido com `TASTE_PRINCIPLES`** (hoje exclusivos do Demarcelizer). Um único motor (`runCompose`), dois system prompts roteados pelo bucket mix. `applyDesign` deixa de ter pipeline próprio: chama `runCompose` e sobrescreve o target — chat e ▶ convergem para o mesmo resultado.

Validação barata antes do flip: 1 par A/B rodado nos dois prompts, comparação visual. Prompt presente no mix mantém precedência do COMPOSE_SYSTEM ("prompt as primary directive") — o RESKIN_SYSTEM não tem slot de instrução do usuário, por isso fica restrito ao mix html-only.

### D3. "Extract to ▸" no menu Connect to

O `EmptyDropMenu` ("Connect to…", `CanvasClient.jsx`) ganha segundo nível **"Extract to ▸"** com opções condicionadas ao kind do node de origem do cord:

| Origem | Opção no submenu | Backend | Esforço |
|---|---|---|---|
| site | **Design system (.md)** | Port do `generateDesignMD` (ou vision call) — gap nº 1 | Alto (é O trabalho) |
| site | **Content (.md)** | `extractContent()` de demarcelize.js — **já existe**, só falta a rota | Baixo |
| site | **Screenshot (asset)** | Playwright `page.screenshot` — pipeline já usado na captura | Baixo |
| site | **Style template** | `extractDesign` atual (HTML chassis) — renomeado para honestidade | Zero |
| site | **Prompt** | Vision/text call "descreva este site como prompt" | Médio |
| asset | **Design tokens (.md)** | `generateDesignMDFromImage` — existe na extensão, portar | Médio |
| asset | **Prompt** | Reverse-engineer do prompt (conceito Image Remix da extensão) | Médio |

Assimetria intencional e consistente: **compose escreve sobre o target existente; extract CRIA o node** (não há target — soltar o cord no canvas é justamente o ato de criar o artefato derivado). Mesmo gesto do Weavy ao derivar um node a partir de outro. Mecânica: node placeholder com progress (mesmo padrão do `captureUrl`) + `POST /api/nodes/[id]/extract { to: 'designmd'|'content'|'asset'|'prompt' }`.

### Plano revisado (substitui a seção 5)

1. ✅ **Fix designmd inerte** (3.3) — resolvido pela via correta (decisão do usuário, 2026-06-12): `extractDesign` agora gera DESIGN.md de verdade via `lib/design-md.js` (novo, LLM pass com prompt espelhando a estrutura Aura-parity do extractor.js) e persiste **design_md + html** no mesmo snapshot — o node funciona no bucket md do run-flow E no applyDesign. Falha de LLM aborta antes de qualquer write (sem node vazio órfão). Nota: nodes designmd extraídos ANTES desta mudança continuam html-only (inertes no ▶; funcionam só via applyDesign) — re-extrair resolve. Testes: `extract-design.test.js` (5 casos). Isso também adianta parte da fase 2 do Extract to (o gerador site→.md já existe; falta a rota `/api/nodes/[id]/extract` + UI).
2. **Regra única de motor** (D2): TASTE_PRINCIPLES no COMPOSE_SYSTEM + roteamento html-only→RESKIN_SYSTEM + applyDesign vira wrapper de runCompose com overwrite no target. Inclui bench A/B de validação.
3. **Edge-case hardening do overwrite** (D1): cycle guard no addEdge, lock run-durante-edit, edges stale. Cascade run fica para depois (precisa de UX própria).
4. **Extract to — fase 1** (D3, vitórias rápidas): rota `/api/nodes/[id]/extract` + submenu + Content (.md) e Screenshot (asset), que já têm backend pronto.
5. **Extract to — fase 2**: port do `generateDesignMD` server-side (site→Design system .md) — destrava a categoria .md de verdade.
6. **Extract to — fase 3**: asset→tokens, site→prompt, asset→prompt.
7. **Operation chip** no target (derivado do mesmo roteamento da regra D2 — mostra "reskin"/"restyle"/"compose" antes do run).
8. Limpeza de kinds legados `template`/`chunk`.

---

## Apêndice — arquivos-chave

| Arquivo | Papel |
|---|---|
| `packages/web-shell/lib/run-flow.js` | COMPOSE_SYSTEM, bucketSources, assemblePrompt, runCompose |
| `packages/web-shell/lib/demarcelize.js` | RESKIN_SYSTEM (Stitch verbatim), TASTE_PRINCIPLES, extract/inject/reskin |
| `packages/web-shell/lib/agent/prompts.js` | BOARD_AGENT (inclui política prompt-node vs inline) |
| `packages/web-shell/lib/agent/tools/` | 18 tools; extract-design.js e apply-design.js são o par de transplante do chat |
| `packages/web-shell/app/api/nodes/[id]/run/route.js` | Executor do ▶/seta (edges incoming → runCompose → snapshot) |
| `packages/web-shell/lib/section-run.js` | Semântica do ▶ de section (terminal detection) |
| `packages/web-shell/lib/snapshot.js` | Captura de URL (html+screenshot; **sem** design_md) |
| `overlay/extractor.js` (extensão) | generateDesignMD 1.974 linhas — código a portar |
| `docs/superpowers/handoffs/2026-06-08-tools-first-infra-handoff.md` | Estado mais recente do agent (tools-first, 11 tools novas) |
