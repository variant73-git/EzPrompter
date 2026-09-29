# Handoff — JEV para baratear a triagem do clone verbatim

> **Data:** 2026-09-29 · **Origem:** sessão de análise `claude/jev-integration-opportunities-40ndwv` · **Destino:** sessão que cuida do clone verbatim
> **Status:** análise + proposta de protótipo. **Zero código de produção.** Nada foi medido com o JEV ainda — todo número de economia abaixo é hipótese a medir.

## 1. O que é o JEV (e o que ele NÃO é)

- Modelo da **TypeSafe AI** (acesso antecipado desde 15/09/2026). Não gera texto: recebe **texto + pergunta** e devolve **valor tipado** — sim/não, uma-de-N opções, ou nota — **com confiança**.
- Anunciado: 70–500 ms por resposta, **US$ 0,042 / milhão de tokens de entrada, saída grátis** (≈ US$ 0,00001 por decisão curta). Várias perguntas saem numa passada paralela.
- **Só lê texto.** Não vê imagem/vídeo, não escreve HTML/CSS/JS. Tudo que é visão ou geração continua onde está.
- ⚠️ **Não verificado nesta sessão:** formato exato do SDK/endpoint, limites de contexto por pergunta, cotas do acesso antecipado. Conferir na doc oficial antes de escrever código.

Fontes: [Wikipedia](https://en.wikipedia.org/wiki/Jev_(AI_model)) · [Flavio Copes](https://flaviocopes.com/jev/) · [LangChain](https://www.langchain.com/blog/building-a-harness-with-jev) · [awesome-typesafe-jev](https://github.com/AbdelStark/awesome-typesafe-jev)

## 2. Onde está o custo do verbatim hoje

O verbatim (`docs/clone-verbatim/CLONE_PROMPT.md`) é uma **ordem de serviço para agente supervisionado** — não há script no repo que o execute. As etapas de **julgamento** são feitas pelo agente (LLM caro, com raciocínio) ou por pessoa. Parte delas é **decisão sobre texto** — exatamente o formato do JEV:

| Etapa | Decisão | Hoje | Natureza | JEV? |
|---|---|---|---|---|
| 1 — gravação completa | "o vídeo tem a página inteira, sem frames faltando" | agente/pessoa | **visual** | ❌ |
| 2 — inventário | categorizar animações (sticky/pin/reveal/parallax) e recursos "necessários" | agente | misto (vídeo + DOM/JS) | ⚠️ só a parte textual (classificar trechos de JS/CSS por tipo de efeito) — baixo valor, adiar |
| **6 — vestígios** | **classificar cada ocorrência** de `http(s)://`, domínio, CDN, plataforma, caminho absoluto (`CLONE_PROMPT.md:115`) | agente | **texto** | ✅ **alvo principal** |
| **6 — atributos** | remover vs preservar atributos de plataforma (ex.: `data-wf-domain` removido, `data-wf-page`/`data-wf-site` mantidos — `gemeo/INDEPENDENCE-REPORT.md:60`) | agente | **texto** | ✅ |
| **6 — links** | externo/social/`mailto` vs navegação interna inexistente → neutralizar, manter texto (`gemeo/INDEPENDENCE-REPORT.md:64-68`) | agente | **texto** | ✅ |
| **7 — console** | aviso **crítico** vs **paridade com a fonte** (`relatorios/OFFLINE_QA_REPORT.json:39-44`) | agente | **texto** | ✅ |
| 7 — rede | zero requisição externa | script | determinístico | ❌ (já é grátis) |
| 7 — SSIM / quadro a quadro | "sem diferença significativa" (ex.: 0,842 justificado como timing de mídia) | agente/pessoa | **visual** | ❌ |

**Onde o JEV barateia:** as linhas ✅ são as de maior **volume** (centenas de ocorrências por site — o gêmeo tinha 373 URLs de origem só no HTML cru e 52 `w3.org`), e hoje cada uma consome tokens de raciocínio do agente principal ou atenção humana. Trocar isso por uma passada JEV de ~1s tira do agente caro a parte repetitiva e deixa para ele só o **resíduo de baixa confiança**.

## 3. Taxonomia proposta (derivada dos relatórios existentes, não inventada)

Rótulos já usados de fato nos relatórios do farmminerals — viram as opções de uma pergunta "uma-de-N" por ocorrência:

**3a. Ocorrência de URL/string no pacote de produção** (`OFFLINE_QA_REPORT.json` `productionAudit` + `gemeo/INDEPENDENCE-REPORT.md` §4–6)
1. `rewrite_local` — referência de asset/rede que deve virar caminho local neutro (`/assets`, `/media`, `/vendor`)
2. `remove` — metadado/vestígio dispensável (`Last Published`, source map, comentário de build, caminho absoluto da máquina)
3. `technical_namespace` — namespace exigido (`http://www.w3.org/...`) → **permitido**
4. `dormant_library_string` — string dentro de lib minificada de terceiro que não dispara rede na navegação (licença GSAP, endpoints de editor do Webflow) → **mantida, provada pelo teste offline**
5. `essential_runtime_identifier` — identificador necessário a CSS/JS/IX/GSAP/Lottie → **mantido**
6. `visible_copy` — texto visível da marca (ex.: `hello@…`) → **texto mantido, ação neutralizada**

**3b. Link** → `external_neutralize` · `internal_missing_neutralize` · `internal_existing_keep`

**3c. Atributo de plataforma** → `remove` · `keep_runtime_required`

**3d. Aviso de console** → `critical` · `source_parity_noncritical`

Contexto que cada pergunta precisa receber (texto): a ocorrência, **arquivo**, ~200 caracteres ao redor, tipo do arquivo (html/css/js/json/svg), e se está dentro de lib minificada de terceiro.

## 4. Regras de segurança (inegociáveis — vêm da doutrina do verbatim)

- **Errar "essencial" como "remover" quebra a animação em silêncio.** Portanto:
  - **Assimetria:** confiança baixa em qualquer rótulo que **remove/altera** → cai para **manter + marcar para revisão** do agente. Nunca remover no escuro.
  - **O teste offline da etapa 7 continua sendo o juiz.** O JEV propõe; a limpeza só vale se o pacote passar de novo com a rede desligada (zero requisição externa, zero erro de console crítico) e sem regressão visual.
- **Não é substituição textual cega** (`CLONE_PROMPT.md:109`) — o JEV classifica **ocorrência a ocorrência com contexto**, não por padrão de string.
- `rewrite_local` e `remove` continuam **executados por código determinístico** (a reescrita por posição de `lib/native-clone/rewrite-references.js` é o modelo). O JEV só decide o rótulo.
- Nada de JEV em decisão **visual** (etapas 1, SSIM, quadro a quadro) nem em gate de rede (já é script).
- Privacidade: o que vai ao JEV é código/strings do site-fonte, não dados do usuário — ainda assim é um fornecedor novo; registrar.

## 5. Bônus no clone NATIVO do produto (mesma classe)

`packages/web-shell/lib/native-clone/capture-bundle.js` **guarda toda resposta** que a página faz — não existe filtro de rastreador/analytics/beacon (só tetos, SSRF, 204/304, 206 parcial; o teto de 20s existe justamente por um beacon da Cloudflare). Classificar **host/URL** em `asset` · `tracker_analytics` · `beacon_longpoll` · `form_endpoint` aproximaria o nativo da etapa 6 do verbatim (pacote menor, menos vestígio).
**Ordem certa:** lista pública determinística (EasyPrivacy/similar) primeiro; JEV só no **resíduo desconhecido**; nunca descartar sem o controle positivo de que a página ainda renderiza.

## 6. Protótipo sugerido (medir ANTES de decidir — "zero sem controle é zero")

Ground truth já existe: os rótulos do farmminerals em `relatorios/OFFLINE_QA_REPORT.json` e `gemeo/INDEPENDENCE-REPORT.md` §4–6.

1. **Extrair o corpus:** varredura recursiva do pacote `dist` do farmminerals (a mesma da etapa 6) → lista de ocorrências com arquivo + contexto. Rotular à mão/pelos relatórios com a taxonomia do §3.
2. **Controle positivo do harness:** confirmar que o corpus tem exemplares de **todas** as classes (especialmente `essential_runtime_identifier` e `dormant_library_string`, as perigosas). Sem isso, acerto alto não significa nada.
3. **Rodar o JEV** em cada ocorrência (uma-de-N + confiança). Registrar latência e custo reais.
4. **Medir:** matriz de confusão por classe. Métrica que importa: **zero** `essential_runtime_identifier` → `remove` acima do limiar de confiança. Acurácia global é secundária.
5. **Fechar o laço:** aplicar a limpeza proposta numa cópia, rodar a validação offline da etapa 7, comparar com o pacote de referência.
6. **Segundo site** (não o farmminerals — "a cobaia pode esconder a classe inteira"): um Next.js ou Framer, onde os vestígios são diferentes.
7. Só depois: comparar custo/tempo contra o agente fazendo a mesma triagem.

**Critério para adotar:** zero remoção indevida de essencial no 2º site + resíduo de baixa confiança pequeno o bastante para o agente revisar. Se falhar, o JEV fica só como **pré-ordenação** (o agente revisa primeiro o que o JEV marcou como incerto).

## 7. O que este handoff NÃO afirma

- Não afirma economia em US$ — o custo por site da triagem do agente hoje não está medido.
- Não afirma que o JEV acerta essa taxonomia — é a hipótese do protótipo.
- Não propõe JEV nas partes caras de verdade do clone (visão/geração do iter9 e do `extract.clone`) — ele não faz isso.
