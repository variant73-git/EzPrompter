# Handoff — Banco de referências próprio ("banco pesado") — 2026-07-22

> **Para uma sessão paralela.** O Adilson vai construir um **banco de referências próprio, com PESOS**, alimentado por crawling. O **demarcelizer** e o **site builder** vão buscar e/ou MISTURAR referências desse banco, com inteligência, e construir a partir daí. Este doc transfere TODO o contexto necessário e lista as decisões que essa sessão precisa fechar — sem cravar o design, que é do Adilson.
>
> **Primeira ação da sessão: ler este doc + a memória `project_reference_bank_plan` + o handoff do eval anti-slop (`docs/superpowers/handoffs/2026-07-06-anti-slop-eval-handoff.md`), e então BRAINSTORMAR o design com o Adilson (não pular pra código).** O banco é a peça que destrava o rubric do eval — a calibração de gosto vem DELE, não de refs-ouro estáticas.

## Por que existe (dois papéis, um artefato)

1. **Destrava o rubric do eval anti-slop.** O handoff de eval (2026-07-06) pedia "3-5 refs-ouro + a assinatura anti-slop explícita" pra construir o rubric. O Adilson NÃO vai dar refs estáticas — vai dar um banco pesado, e o rubric calibra a partir dele (os exemplares/thresholds do juiz saem das referências de maior peso). Sem o banco, o rubric fica com o gosto do agente, não o do Adilson — que é justamente o que não se quer.
2. **Alimenta a geração criativa.** No pipeline decomposto (ver handoff `2026-07-22-skills-audit-housestyle-switchboard-handoff.md`): a etapa criativa (hoje o GPT 5.6 Sol emitindo um brief de direção de arte) parte de referências. O banco dá material PONDERADO pra essa etapa buscar e MISTURAR, em vez de o modelo partir do nada ou de uma única referência. É a matéria-prima da direção de arte.

## O que é (a intenção do Adilson, a detalhar no brainstorm)

- **Crawler** que popula o banco com referências (sites/telas/seções de design de alta qualidade).
- **Store** com PESO por referência (o Adilson atribui pesos — provavelmente por qualidade/afinidade com o gosto dele).
- **Busca**: o demarcelizer e o site builder CONSULTAM o banco (dado um brief/subject, recuperam referências relevantes ponderadas).
- **Mistura**: combinar N referências ponderadas numa direção coerente (não copiar uma; sintetizar de várias) — casa com o princípio anti-convergência e com o "transplante criativo".

## Como conecta com o que já existe (não reinventar)

- **Style-extract determinístico já pronto**: `packages/web-shell/lib/design/style-extract.js` (Layer B brief), `sample-palette.js` (paleta por pixel — bate LLM), `design-md.js`, `demarcelize.js` (extract/inject/reskin). O banco NÃO substitui isso — ALIMENTA a etapa que decide QUAIS referências extrair/misturar. A extração de uma referência já é resolvida; o banco resolve a SELEÇÃO e a PONDERAÇÃO.
- **house-style.js virou switchboard** (38 critérios toggláveis) — é o guardrail de geração. O banco é a fonte de exemplares positivos; o switchboard é o filtro de anti-slop. Complementares: banco = "parece com isto (peso alto)"; switchboard = "não faça isto".
- **Ditto** (substrato determinístico, ver `2026-07-22-ditto-clone-cost-handoff.md`) pode SER um alimentador do banco: capturar referências como tokens/breakpoints/estrutura determinística ($0) em vez de só imagem.
- **land-book.com** já mapeado como mina de templates ([[source_landbook_template_pipeline]] na memória nativa) — candidato natural a fonte de crawling.
- **Refero MCP** e **Maxibestof MCP** (design inspiration) estão conectados nesta sessão — possíveis fontes/estruturas de referência a estudar antes de crawlar do zero.

## Decisões que ESSA sessão precisa fechar (brainstorm)

1. **Fontes de crawling**: land-book? Awwwards? Refero/Maxibestof via MCP? Sites que o Adilson curar à mão? Mix?
2. **Schema de peso**: peso é um número único? Multi-dimensional (qualidade × afinidade × recência × categoria)? Quem atribui — Adilson à mão, ou um juiz LLM calibrado, ou híbrido?
3. **O que se guarda por referência**: só URL+screenshot? Ou já o brief extraído (style-extract) + paleta determinística + tokens (Ditto)? Guardar a extração pré-computada barateia a busca depois.
4. **Interface de busca**: como demarcelizer/builder consultam — por categoria? por embedding de similaridade visual? por tags? Dado um subject/brief, o que entra na query?
5. **Mecânica de mistura**: como combinar N referências ponderadas numa direção única sem virar colcha de retalhos (o anti-slop odeia isso). Uma referência dominante + acentos de outras? Média ponderada de tokens?
6. **Ligação com o rubric**: as referências de maior peso viram os exemplares few-shot do juiz do eval? Os thresholds saem da distribuição do banco?

## Regras da casa (não reaprender na dor)

- **Texto de produto em INGLÊS**; conversa em PT ([[feedback_ui_text_english]]).
- **Legal/ética**: ferramenta de inspiração e aprendizado ("papel vegetal") — o banco é referência pra SINTETIZAR, não pra copiar 1:1. Cuidado com armazenar/redistribuir assets de terceiros.
- **web-shell usa bun** (bun.lock é source of truth), testes Vitest.
- **Não reinventar**: buscar 3rd-party/OSS antes de construir ([[proactive-oss-tooling]]); style-extract/sample-palette já resolvem a extração — o banco é seleção+peso+mistura.
- **Determinístico só onde há DOM** (lição 143): guardar tokens/paleta medidos quando a referência é um site vivo; visão/inferência só onde não há DOM.
- **`.firecrawl/variant/` fica untracked** (pseudo-secrets); nunca `git add -A`.

## Pointers

- Memória nativa: `project_reference_bank_plan`, `source_landbook_template_pipeline`, `checkpoint_2026-07-22_skills-audit-decomposition-housestyle`, `research_aura_build` (multi-modelo por subtask).
- Repo: `docs/superpowers/handoffs/2026-07-06-anti-slop-eval-handoff.md` (o rubric que isto destrava), `2026-07-22-skills-audit-housestyle-switchboard-handoff.md` (a arquitetura de geração decomposta que consome o banco), `packages/web-shell/lib/design/` (style-extract, sample-palette, house-style).
- Vault Brain: `Uncraft/🕸 Canvas.md` (Demarcelizer), `Uncraft/Pesquisa/`.
