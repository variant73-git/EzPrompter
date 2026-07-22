# Handoff — Auditoria de skills + house-style switchboard + arquitetura de geração decomposta (2026-07-22)

> **Propósito**: transferir a sessão de 2026-07-22 (branch `feat/native-motion-editor`). Cobriu: cross-read de 6 skills anti-slop → decisões de critério; teardown do concorrente VibeCloner + o experimento Fable; ideias de redução de custo; análise de 5 skills de motion/3D/design (gsap/motion-design/genjutsu/design-dna/threejs) sob a ótica "modelo barato + processo = modelo caro"; o reframe da geração CRIATIVA (demarcelizer como gerador estilo Lovable, GPT 5.6 Sol como motor); encaixe do Ditto na arquitetura decomposta; e a refatoração do `house-style.js` num switchboard de critérios individualmente ligáveis/desligáveis.

---

## 1. house-style.js virou SWITCHBOARD (entregue, 747/747 testes)

`packages/web-shell/lib/design/house-style.js` — antes eram strings monolíticas; agora é um **registro de 38 critérios isolados** (36 guardrails + 1 bloco ABSORB + 1 INVENT), cada um com chave `on`. Os exports legados (`HOUSE_STYLE_GUARDRAILS/_ABSORB/_INVENT/HOUSE_STYLE`) são **montados** dos critérios ligados — mesmos nomes, mesma forma, 3 importadores intactos (demarcelize.js, run-flow.js, agent/prompts.js).

**Como ligar/desligar um a um:**
- Editar `on` do critério (hot-reload no dev).
- Env `UNCRAFT_HOUSESTYLE_OFF="id1,id2"` / `UNCRAFT_HOUSESTYLE_ON="id3"`.
- Programático: `listCriteria()`, `setCriterion(id,on)`, `buildHouseStyle({off:[...]})`.

**Tradeoff**: os 3 consumidores leem as strings no LOAD do módulo → toggles valem em hot-reload (dev) / redeploy (prod), não mid-sessão. Pra toggle ao vivo, trocar os 3 call-sites por `buildGuardrails()` por request (API pronta; não feito pra não mexer em geração sem validar).

---

## 2. Decisões de critério anti-slop (conflitos 37-53 resolvidos pelo Adilson)

Cada uma virou um critério com `note` rastreando a decisão. Estado final:

- **37** Fraunces + Instrument Serif **NÃO banidas** (edit mode cobre; Instrument Serif é branding). `type-no-ai-fonts`.
- **38/39** mono banido + JetBrains vetado (reafirma). Hit area 44×44 **adotada** (`states-hitarea`).
- **40** outline em imagens **continua banido** (imagem não é exceção).
- **41** nem borda nem sombra salvo se fonte tem **ou usuário especifica** (`layout-border-shadow-conditional`).
- **42 (revisada)** tracking negativo só no display grande; **NÃO** alargar tracking em caption/small; eyebrows nunca abrem. (Adilson corrigiu: caption seria "sutilmente maior" em tamanho, não tracking largo.) `type-tracking`.
- **43** glassmorphism **possível** (só não reflexo). `banned-glassmorphism-default`.
- **44** cursor customizado só se usuário pedir. `cursor-user-gated`.
- **45** bordas GROSSAS + hard-shadows banidas; grain + gradient meshes OK. `layout-no-thick-border-hardshadow` + `layout-atmosphere-ok`.
- **46** gradientes brand-appropriate permitidos, não encorajados, preferir sob pedido. `color-gradients-brand`.
- **47** accent **1-3** (cada um com função). `color-accent-count`.
- **48 (revisada)** motion por REGISTRO: landing/brand (e prompt pobre) = motion com intensidade; apps/sistemas = motion sutil; sem-motion/mínimo é **opt-in do usuário**. `motion-entrance-contextual` + `motion-feedback-always` (feedback sempre).
- **49** serif+sans OK como contraste, desencorajado como default sem pedido/personalidade. `type-serif-default`.
- **50** stagger 30-80ms conforme contexto. `motion-stagger`.
- **51** dark mode só quando existe; dual-mode disciplinado só em sistema/SaaS/app. `darkmode-conditional`.
- **52** máx 1 pergunta → regra de comportamento do AGENTE (não entrou no house-style; vai pro prompt do agente).
- **53** literal do que a fonte dá; inventar só onde não há fonte. `content-real-numbers`.

Fonte da lista 1-53: cross-read de 6 skills (taste-skill, interface-design, bencium, baseline-ui, make-interfaces-feel-better, shadcn). Consenso, redundâncias e conflitos completos ficaram na conversa da sessão.

---

## 3. Veredito das 5 skills de motion/3D/design (custo-substituição por seam)

**Núcleo honesto**: o salto criativo (Farm Minerals → Uncraft, zero contexto, que o Sol fez) é **gosto + síntese** — a única coisa que NENHUMA skill contém. Skills codificam regras/vocabulário/correção-de-ofício (o chão e as mãos), nunca o olho. Logo "barato + skills = Sol" NÃO fecha na síntese criativa. Fecha na EXECUÇÃO.

- **gsap-skills (oficial, ~23k tokens; subset útil ~9.4k)**: introspecção ≈ ZERO (nosso bridge/item 154 segue proprietário). Autoria = denso em anti-erros que modelo barato comete (start/end, ScrollTrigger em child de timeline, immediateRender, scrub+toggleActions, licenciamento pós-Webflow). Vendorizar subset (scrolltrigger+core+timeline), corrigir bug do exemplo (`Max.max`), remover advocacy.
- **motion-design-skill (LottieFiles, ~3.1k)**: sem código; tabelas de parâmetro + quality-checklist com severidade (vira rubric de juiz). Conflito: doutrina "3 camadas de motion" empurra pro OPOSTO do anti-slop → adotar com clamp (Corporate/Premium, tetos do house-style, ambiente off).
- **genjutsu (~127k, ~55% SwiftUI/Compose = peso morto)**: orquestradores inúteis no pipeline; ouro nos sub-skills `_jutsu/`: gsap-traps (pares RUIM/BOM), css-native (scroll-driven, View Transitions, @starting-style — pós-cutoff), **design-audit = greps determinísticos** (QA de motion sem LLM → vai pro eval), perfil Kowalski ≈ nosso house-style.
- **design-dna (~6.7k)**: método mais fraco que o nosso (adivinha no olho, força "nenhum campo vazio" = alucinação). Schema tem 4 itens roubáveis pro Layer B: **effects taxonomy** (13 categorias com params — dimensão que nos falta), **brand_voice_in_ui**, **interaction_feel**, **absence flags** (`enabled:false`). E: nós preenchemos a metade mensurável do schema com verdade medida.
- **threejs-skills (~35-40k)**: NÃO muda "rasterizar, não re-autorar" no clone (gargalo é estimar params de pixels, não sintaxe). Serve só pra gerar herói 3D do zero; rebrand de repo alheio com 4 erros de API. Prioridade baixa.

**Ruído pra geração**: taste/interface-design/baseline-ui/feel-better (house-style já destilou). Salvar 1 coisa do interface-design: o split de registro brand-vs-product. shadcn: irrelevante (emitimos HTML cru).

---

## 4. Arquitetura de geração CRIATIVA decomposta (o reframe)

Demarcelizer não é só transplante — é transplante CRIATIVO (gerar sites, estilo Lovable). Espectro: `clonar → transplante de cópia → transplante criativo → inventar do prompt`. O house-style anti-slop foi escrito pra ponta FIEL (source-conditional); na ponta criativa, `HOUSE_STYLE_INVENT` já acolhe invenção deliberada — as skills que "conflitavam" no clone viram ativos aqui, gated por registro.

**A conta fecha por DECOMPOSIÇÃO** (pesquisa Aura, [[project_tiered_routing_strategy_2026-04-24]]):
1. **Sol só no brief criativo** (~2k tokens de direção de arte: conceito, composição, paleta, signature). Curto = barato.
2. **Execução voluminosa (16k tokens de HTML/motion) → modelos baratos + skills** (ensinável).
3. **Verificação → grep (design-audit) + juiz (motion-design checklist) + slop test.**

O ganho não é "barato faz tudo"; é **encolher o Sol até o brief e entregar a emissão cara pra baratos que as skills tornam confiáveis.**

**Experimento que responde com dados (3 braços)**, a rodar SEM skill primeiro (lição 143/145 — skill é hipótese a medir):
- (A) Sol monolito = teto/baseline de custo.
- (B) Sol brief + executor barato **sem skill** = testa a decomposição pura.
- (C) (B) + skills = precifica a skill (C vs B) e mede alcance do teto (C vs A).

---

## 5. Ditto na arquitetura (substrato determinístico)

Ditto (MIT, zero-LLM, capture-to-code) — ver `docs/superpowers/handoffs/2026-07-22-ditto-clone-cost-handoff.md`. Fronteira medida: estático/leve → ~95% por $0; motion pesado → quebra (= onde vive nosso motion editor = moat reafirmado). Plugado no pipeline decomposto em 3 pontos:
1. **Preenche a metade MENSURÁVEL do brief de design-DNA** ($0): tokens, breakpoints, fontes, sections. Sol só faz a metade qualitativa; bridge preenche `visual_effects.motion` do GSAP real.
2. **Transforma transplante de "emitir documento" em "editar delta"**: o `content.ts` do Ditto separa conteúdo do markup → [demarcelize.inject](../../../packages/web-shell/lib/demarcelize.js) para de re-emitir 32k tokens e passa a editar ~2k (ou zero LLM). Corte de 10×+, output vira código mantível.
3. **Baseline de $0 que o eval usa pra precificar o prêmio criativo do Sol.**

Tudo gated pelo roteador estático-vs-animado (detect.js como classificador — pré-requisito de tudo).

---

## 6. A "superskill" se decompõe (não vira monolito)

Os findings (Sol + decomposição + Ditto) mudam a FORMA, não o valor. Uma superskill única injetada no gerador é errada: (a) o Sol já tem gosto acima das skills → peso morto + risco 143/145; (b) a decomposição parte a necessidade em 3 lugares que não querem estar juntos; (c) a verdade determinística migrou pro Ditto/probes. A consolidação (lista 1-53) sai em 3 formas certas: **(1) house-style.js** = guardrail de geração (switchboard, feito); **(2) assinatura anti-slop → RUBRIC do eval** (dados pontuados, não prosa — verificação não sofre de 143/145); **(3) skills de execução** separadas e roteadas.

---

## 7. Pendências (ordem de retorno)

1. **Banco de referências próprio (plano do Adilson — substitui as "refs-ouro" do rubric).** Crawling → banco com PESOS; demarcelizer e site builder buscam e/ou MISTURAM referências desse banco inteligentemente e constroem a partir daí. O rubric do eval calibra a partir desse banco, não de links estáticos. Ver `project_reference_bank_plan.md`. **Isso destrava o rubric.**
2. Roteador estático-vs-animado (detect.js como gate) — pré-requisito dos encaixes do Ditto.
3. Spike do `content.ts` como delta de transplante (o ganho de custo mais mensurável, só depende do gate).
4. Experimento de decomposição de 3 braços (§4) — rodar sem skill primeiro.
5. Esboçar o rubric do eval espelhando o switchboard (cada critério → 1 check pontuado); thresholds pendentes do banco de referências.
6. Se/quando: vendorizar subset gsap-skills, enxertar effects-taxonomy do design-dna no Layer B, colher greps do design-audit pro eval.

**Anti-instruções**: skills são commodity (não são moat — moat = capacidade de transplante criativo do modelo de fronteira + produto integrado + ground-truth proprietário). Não empilhar prompt (143/145). Não tratar barato+skill como substituto do Sol na síntese criativa.
