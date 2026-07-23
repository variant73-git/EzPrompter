# Handoff — Componentização própria + roteador free-vs-pago + hardening do extract (2026-07-23)

> **Para o próximo agente.** Branch `main` (working tree, HEAD `e3dfa013`). Esta sessão fechou três coisas e abriu UMA frente com direção clara. A frente aberta — **componentização do nosso próprio clone** — é o teu trabalho, com um caminho primário e um fallback já decididos. Este doc conta o PROCESSO e o PORQUÊ de cada decisão, não só o quê, porque as decisões vieram de descartar alternativas com dados/review — repetir a análise seria desperdício.
>
> **Ordem de leitura**: este doc → `2026-07-22-ditto-clone-cost-handoff.md` (o que é o Ditto, testes de campo) → o spec `docs/superpowers/specs/2026-07-23-clone-router-and-ditto-export-design.md` (parcialmente superado por este handoff; ver §5). Regras da casa no fim.

---

## 0. TL;DR das decisões desta sessão

1. **Hardening do extract — FEITO e validado (Claude+Sol).** O `.md` que travava em ~90% era ausência de deadline nas chamadas de LLM. Corrigido nos 3 seams + cliente. Código commitado nesta sessão (ver §1).
2. **Ditto como caminho de EXPORT (re-clonando a URL) — DESCARTADO.** Dois motivos que se somam: (a) ele re-captura a URL, então exporta o site ORIGINAL, ignorando o que o usuário editou no canvas — errado pro produto; (b) a segurança do export dele NÃO é previsível pela fonte (só verificando o output). Ver §3.
3. **Componentização própria — DIREÇÃO NOVA (teu trabalho).** Fazer a componentização SOBRE O NOSSO DOM (o clone editado). Caminho 1: Ditto como BIBLIOTECA (checar se o compilador dele aceita HTML nosso como input). Fallback: componentizador nosso, usando os algoritmos MIT do Ditto de referência. Ver §4. **Motivação dupla — e a segunda é a mais forte: seções estáveis** (ver §4.0).
4. **Classificador free-vs-pago — construído (núcleo + shadow), REFOCADO.** Sem gate de Ditto. Trabalho único: decidir se a fotocópia grátis funciona ou se o site precisa do rebuild pago, pra o designer NUNCA receber um clone quebrado calado. Ver §2.

---

## 1. FEITO: hardening do extract (bug do `.md` que travava)

**Sintoma (relatado pelo Adilson):** extrair um `.md` do farmminerals travava com o loader parado perto do fim (~90%).

**Causa (confirmada por Claude + Sol, código-grounded):** a rota `POST /api/nodes/[id]/extract` é síncrona (sem SSE) e o `callLLM` dos seams aguarda o SDK do provider **sem timeout**. Uma chamada lenta/presa (modelo pesado, ou um `UNCRAFT_LLM_MODEL` global mal-roteado) segura o request pra sempre; o "90%" é um anel de progresso sintético (estimativa) que congela. NÃO é recaptura (o extract lê `s.html` já armazenado — Sol e Claude confirmaram).

**Correção (código commitado nesta sessão):**
- Novo `packages/web-shell/lib/llm-deadline.js`: `withDeadline(run,{ms,label})` (corrida contra deadline + abort real via signal + blindagem contra unhandled-rejection quando o timeout vence e a chamada rejeita depois) e `assertProvider(model, supported)` (fast-fail de modelo mal-roteado ANTES da chamada). Default 150s, env `UNCRAFT_LLM_DEADLINE_MS`.
- Ligado em `design-md.js` (callLLM), `demarcelize.js` (callLLM), `extract-llm.js` (callText + callVision) — passando o AbortSignal aos SDKs (Anthropic `stream(body,{signal})`, OpenAI `create(body,{signal})`, Gemini `config.abortSignal` — todos verificados nos types dos SDKs instalados).
- Timeout no cliente: `canvas-api.js` `extractNode` via `fetchWithTimeout` (180s, > deadline do servidor pra o erro limpo do servidor ganhar).
- Instrumentação: log de provider/modelo/tamanho de input por seam.
- **Review Sol pegou 1 regressão real**: meu `providerFor` rejeitava `models/gemini-*` (forma válida que o else-fallthrough antigo aceitava). Corrigido (normaliza prefixo `models/`, trata `tunedModels/`).
- Testes: `llm-deadline.test.js` (10 casos). Suíte cheia **822/822 verde** (era 802 no main).

Efeito: chamada presa para em ~150s com erro claro, em vez de congelar pra sempre. Modelo errado falha rápido com mensagem explicando (em vez de 404 no SDK errado).

---

## 2. CONSTRUÍDO + REFOCADO: classificador free-vs-pago

**O problema que ele resolve (o "porteiro"):** quando o designer traz um site, decidir se a fotocópia grátis (`snapshot.js`) renderiza fiel, ou se é site pesado/animado que precisa do reconstruct pago (iter9). Hoje existe o `detectAnimatedBuilder` (binário grosseiro) que erra dos dois lados: deixa passar sites de GSAP-puro (score 0 → cópia quebrada calada) e marca à toa sites que a fotocópia já resolveria.

**⚠️ O produto NUNCA empurra pago.** Correção explícita do Adilson: o classificador **informa custo** ("isto é um site de web builder, uma reconstrução fiel custa X créditos"), gated pelo sistema de créditos que já existe (`reconstruction-policy.js` + `deferred-reconstruction.js` — captura grátis, paga só quando a AÇÃO precisa do runtime editável). O classificador só melhora a PRECISÃO do sinal `animatedDetected` que essa policy já consome.

**Jornada do desenho (importante — não repetir os erros):**
- Meu 1º desenho (probe de `opacity:0` no DOM vivo) foi **reprovado por Claude+Sol convergindo**: mede o DOM com JS rodando, mas a fotocópia entregue tem os **scripts removidos** → sub-detecta a quebra → falso-livre. Correção: medir o **artefato strippado vs a fonte** (diff de cobertura de texto visível), robusto a UI condicional (carrossel/modal escondido nos dois lados se cancela).
- O Adilson então propôs simplificar por **sinais** (web builder via `detect.js` + GSAP/Three global). **Está certo pro caso comum** (builders deixam impressão digital confiável; já temos `detect.js` com 8 builders). O buraco: GSAP/Three **bundled** (webpack) é invisível em `window` — sinais não pegam.
- Fechamento (correção do Adilson que venceu): "vê que quebrou e rebuilda na mão" é frase de dev, não de designer — **cópia quebrada calada é falha de produto real**. Logo detectar a quebra (não só sinais) TEM valor: o produto ou entrega cópia boa, ou diz honestamente "precisa de rebuild".

**Desenho final (o que fazer): sinais como primário + coverage-diff como rede.**
- **Sinais** (barato, confiável): `detect.js` (builder) + GSAP/Three/lenis global + sticky-pesado → pesado → nosso.
- **Coverage-diff** pega a quebra que os sinais não veem (GSAP bundled, JS custom) → pra o designer nunca receber lixo calado.
- **Fail-safe = estado `unknown`** (não "coerça pra pesado"): a fotocópia grátis é inspecionável, então baixa-confiança mostra o grátis COM ressalva, não afirma "pague". Só site confirmado pesado dispara `animatedDetected`.

**Código construído (commitado, shadow):**
- `packages/web-shell/lib/classify-site.js`: lógica pura (`classify`, `textCoverage`, `toMeta`) + extratores browser-side (`extractVisibleText` que pula elementos escondidos por opacity/visibility/display, `extractMotion` positive-only). Thresholds `COVERAGE_OK=0.90`, `COVERAGE_BROKEN=0.70` (não calibrados). Sem `dittoSafe` (Ditto saiu). 12 testes.
- `snapshot.js`: bloco **shadow** gated por `UNCRAFT_CLASSIFY_SHADOW` (off por default → zero custo/risco), todo try/caught. Renderiza o artefato strippado num page JS-desligado, compara com a fonte, e **loga** o veredito novo vs legado — sem mudar comportamento. É a instrumentação pra medir se os sinais têm buraco que importe.

**Shadow mode explicado (pro Adilson, que perguntou):** é o classificador rodando quietinho por trás, só ANOTANDO no log o que ELE decidiria, sem afetar o usuário — pra a gente conferir se o veredito é bom antes de deixá-lo mandar de verdade. Por quê: os thresholds são chute até testar contra sites reais.

**Pendente do classificador:** decidir se roda shadow pra calibrar (precisa do dev server + rede — não dá fielmente em ambiente sem captura real) OU, dado que a falha é user-facing, construir a checagem como coisa de verdade após conferida rápida. Um `scripts/calibrate-classify.mjs` foi desenhado (não escrito): roda uma lista de URLs rotuladas pelo humano com o flag, salva screenshots pra o humano validar, imprime tabela (coverage/categoria/legado/rótulo) + placar falso-pago vs quebrado-grátis + sugestão de thresholds. Precisa de ~15-30 sites diversos (com UI condicional + GSAP bundled), não só os 3 âncoras (langchain/sanity/farmminerals = smoke).

---

## 3. DESCARTADO: Ditto como export re-clonando a URL

Contexto do Ditto: `docs/superpowers/handoffs/2026-07-22-ditto-clone-cost-handoff.md` (clonador MIT, zero-IA, DOM→código componentizado). Fronteira medida: estático/leve → ~95%/$0; animado pesado → quebra.

**Por que descartamos o Ditto COMO ESTÁ (re-clonador de URL), com o raciocínio completo:**
- **No clone**: não agrega — nossa fotocópia grátis já cobre estático/leve, e no sanity.io até GANHA dele (nossa captura absolutiza assets pro serviço VIVO, os ícones carregam; o Ditto tentou auto-conter e quebrou → 404 nos ícones do icon-server da Sanity).
- **No custo**: não reduz — o caminho pago é o site pesado, justo onde o Ditto quebra igual.
- **Segurança do export NÃO é previsível pela fonte** (achado Claude+Sol, alta convergência): a quebra do Ditto depende do que o COMPILADOR dele faz, não de propriedades da página. Os 404 do Sanity eram recursos same-origin válidos na fonte; `page.evaluate` não adivinha. Logo um "Ditto-safe" decidido antes de rodar é não-confiável — só verificando o OUTPUT (rodar Ditto, caçar 404, diff visual).
- **Erro arquitetural fatal pro nosso caso**: o Ditto clona a URL DE NOVO. Então o export sai do site ORIGINAL, **ignorando o que o usuário editou no canvas**. O ponto do Uncraft é o usuário EDITAR. Export do original = errado.

**Conclusão**: o export-to-code é um capricho legítimo (o Adilson gostaria de ter), mas **não via Ditto-reclona-URL**. Fazer sobre o NOSSO DOM. → §4.

---

## 4. FRENTE ABERTA (teu trabalho): componentização do nosso próprio clone

### 4.0. Motivação — DUAS, e a segunda é a mais forte

1. **Export-to-code limpo** (o capricho): designer clona/edita → sai um projeto componentizado (Next.js `components/` + `sections/` + conteúdo separado em `content.ts` + tokens) pra handoff a dev / continuar em código. Nice-to-have, off-core (Uncraft é designer-in-browser), mas legítimo.
2. **⭐ SEÇÕES ESTÁVEIS (a real motivação).** O Adilson: *"gostaria de ter/criar/deduzir seções claras do site e atualmente isso está muito instável no nosso modelo. Com sites animados fica mais difícil ainda."* O motor de componentização faz **segmentação de seções determinística** (Hero, Pricing, Footer…) como parte do trabalho — resolvendo de brinde um problema que hoje é instável no produto (e pior em animado). Isso vale mais que o export em si: seções estáveis alimentam o editor, o canvas, o run-flow, o motion editor.

### 4.1. Princípios a honrar (decididos, não re-litigar)
- **Roda sobre o DOM EDITADO** (o HTML do node), não re-captura URL → o export/seções refletem o que o usuário fez.
- **Mantém assets apontando pro serviço vivo** (nossa filosofia de `absolutizeUrls` em `snapshot.js`) → evita a quebra de ícones que derrubou o Ditto no sanity.io. (Tensão honesta: código auto-contido quebra assets dinâmicos; link-vivo depende da origem. É difícil pra QUALQUER UM — Ditto incluso; não é problema que o Ditto resolve e nós não.)
- Determinístico, $0 IA (é transformação de DOM, não mágica).

### 4.2. Caminho 1 (PRIMÁRIO): Ditto como BIBLIOTECA
Checar (é meia hora) se o compilador do Ditto **aceita HTML/DOM arbitrário como input**, em vez de só clonar URL. Se aceitar, reusamos o MOTOR de componentização + segmentação de seções dele, rodando no NOSSO HTML editado — sem a captura dele. É o encaixe onde o Ditto ainda serve.
- Onde olhar (repo Ditto, MIT, `github.com/ion-design/ditto.site`): o `compiler/`, `packages/core/`, o comando local `npm run validate-site -- runs/...`. O handoff do Ditto (§4 encaixe 6, §6 passo 2) já marcou "investigar se o compiler aceita HTML/DOM arbitrário".
- Se o compilador for acoplado à captura Playwright dele (só URL), Caminho 1 falha → Caminho 2.

### 4.3. Caminho 2 (FALLBACK): componentizador nosso
Construir, usando os algoritmos MIT do Ditto como referência (o `compiler/` deles resolve os problemas que vamos encontrar):
- **DOM repetido → componente** (5 cards parecidos → UM componente).
- **Segmentação de seções** (a joia — Hero/Pricing/… limpos). ← a motivação #2.
- **Conteúdo separado do markup** (`content.ts`).
- **Extração de tokens** (cor/fonte/espaçamento → CSS vars) — já temos peças: `sample-palette.js`, `style-extract.js`.
- Emitir como projeto de framework (Next.js/React).
- Já temos pedaços do entendimento de DOM no editor e detecção de seções no canvas — inventariar antes de construir.

### 4.4. Prioridade honesta
Export-to-code é capricho (não agora como produto). MAS a **segmentação de seções** pode ser puxada pra frente independente do export, porque destrava dores atuais. Sugestão pro próximo agente: começar pelo **check de meia hora do Caminho 1**; se o compilador do Ditto aceitar nosso HTML, um spike de "nossas seções via motor do Ditto" tem retorno alto e baixo custo. Se não, escopar o segmentador de seções nosso primeiro (o pedaço de maior valor), export completo depois.

---

## 5. Relação com o spec `2026-07-23-clone-router-and-ditto-export-design.md`
O spec foi escrito ANTES destas decisões e está PARCIALMENTE SUPERADO:
- ✅ Ainda vale: o hardening do extract (§6 do spec), a integração com `reconstruction-policy.js` (§4), o classificador free-vs-pago (§3-4) — mas com o mecanismo revisado pelos reviews (medir artefato, não DOM vivo; estado `unknown`).
- ❌ Superado: o "Entregável 2 — Ditto export gated por dittoSafe" (§5 do spec) — CORTADO. Ditto não entra como re-clonador; componentização é própria (este handoff §4).
- O spec tem o registro completo dos reviews (probe de quebra, fail-safe, gate do Ditto, hardening) — útil como histórico.

---

## 6. Estado do código (nesta sessão, main)
Commitado (ver commit desta sessão): `llm-deadline.js` (+test), wiring em `design-md.js`/`demarcelize.js`/`extract-llm.js`/`canvas-api.js`, `classify-site.js` (+test), bloco shadow em `snapshot.js`. **822/822 testes.** Nenhum código de Ditto foi escrito (decisão de descartar veio antes de construir).

---

## Regras da casa (não reaprender na dor)
- Trabalho é no **`main`** (tronco; house-style switchboard já lá como item 158; camada `reconstruction-policy.js`/`deferred-reconstruction.js` presente). **Sessão paralela também mexe no main** — coordenar antes de commits grandes; nunca `git add -A`.
- **web-shell usa bun** (bun.lock source of truth), testes Vitest; mock de SDK class-based.
- **snapshot.js é o caminho de captura — delicado.** Mudanças gated + try/caught (o bloco shadow segue esse padrão).
- **Codex/Sol neste repo**: bundle escopado (`--mode diff` estoura com untracked) + `--timeout 1500`; validar mudanças substantivas (regra global do Adilson).
- Texto de produto em INGLÊS; conversa em PT.
- Ditto: repo MIT em `github.com/ion-design/ditto.site`; instalação/testes de campo no handoff `2026-07-22-ditto-clone-cost-handoff.md`; a API key hospedada do Adilson existe mas não está em env (perguntar a ele).
