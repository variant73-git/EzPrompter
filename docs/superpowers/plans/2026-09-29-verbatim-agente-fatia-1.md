# Verbatim como motor — fatia 1: uma execução medida, num site que não é a cobaia de sempre

> **Data:** 2026-09-29 · **Estado:** ordem de serviço pronta; **nenhum token gasto**. A primeira execução gasta IA de verdade e só parte com OK explícito.

## 1. O que a fatia 1 responde

Duas perguntas, e só elas:
1. **Quanto custa** (tokens, tempo, iterações) uma execução do verbatim como agente, por etapa.
2. **Onde o resultado fica** em relação ao `native` + editor, medido pelo MESMO portão — não por opinião.

Não é a versão de produto. É o **denominador** que hoje não existe: sem ele, "o verbatim é caro" e "o JEV economiza" são frases sem número.

## 2. O que JÁ está automatizado (grátis, sem IA)

| etapa da receita | ferramenta | estado |
|---|---|---|
| 1 — gravar referência | `scripts/verbatim-source.mjs` | pronto (`_verbatim/source-gsap/reference.mp4` + meta) |
| 2 — baixar tudo | produtor nativo (`captureNativeBundle`) | pronto — `_verbatim/cobaia7`, 32 arquivos, paridade de fidelidade |
| 2 — inventário de movimento | `verbatim-source.mjs` → `motion-inventory.json` | pronto, **só como verificação**: 66 seletores inválidos, 18× de sobre-casamento, 55 easings opacos — não é insumo de re-expressão (medido nas duas cobaias) |
| 6 — vestígios | `scripts/verbatim-traces.mjs --dom` | pronto — resíduo de ~24 ocorrências no gsap.com |
| 7 — validar | `scripts/verbatim-gate.mjs` (autocontrole obrigatório) | pronto — piso do site contra si: 0,886 |

## 3. O que o AGENTE faz (a parte cara)

Etapas 2-investigação, 3 (reprodução 1:1) e as decisões de 6 que sobraram. Insumo que ele recebe:

- o pacote nativo `_verbatim/cobaia7/assets` (HTML 343 KB, JS 261 KB + 29 KB + 22 KB, fontes, imagens) — **~188 mil tokens de texto**; Lottie/JSON fora do insumo por regra;
- a gravação `reference.mp4` + `reference.meta.json` (altura 10357, rolagem 9157, 194 animações, 44 gatilhos);
- o site vivo, só para inspecionar (a receita permite; a entrega não pode depender dele);
- a ordem de serviço `docs/clone-verbatim/CLONE_PROMPT.md`, com o alvo trocado para `https://gsap.com`.

Saída: uma pasta `_verbatim/verbatim-gsap/assets` servível pelo portão, com `index.html` na raiz.

**A fonte de verdade do movimento é o JS do site** (`tf-assets/index-*.js` e `js/header.js`), lido pelo agente — exatamente como no processo manual do Adilson. O inventário de máquina serve para o agente CONFERIR que não esqueceu nada, nunca para escrever a partir dele.

## 4. Aceite — pelo portão, com autocontrole

```
node scripts/verbatim-gate.mjs --reference https://gsap.com --out _verbatim/ref-A
node scripts/verbatim-gate.mjs --reference https://gsap.com --out _verbatim/ref-B --trajectory _verbatim/ref-A/trajectory.json
node scripts/verbatim-gate.mjs --compare _verbatim/ref-A _verbatim/ref-B        # piso: site contra si
node scripts/verbatim-gate.mjs --candidate bundle:_verbatim/verbatim-gsap --out _verbatim/verbatim-gsap-run --trajectory _verbatim/ref-A/trajectory.json
node scripts/verbatim-gate.mjs --compare _verbatim/ref-A _verbatim/verbatim-gsap-run
node scripts/verbatim-gate.mjs --compare _verbatim/ref-A _verbatim/cobaia7-run2  # o native, para comparar
node scripts/verbatim-traces.mjs --bundle _verbatim/verbatim-gsap --dom          # vestígios que sobraram
```

Dimensões, nunca média: altura, texto, imagens, independência (externas/sucedidas/faltando), editabilidade (alcançável/obstruído), SSIM mínimo **contra o piso do autocontrole**, movimento (≥3 pontos conclusivos, deriva por quadro), vestígios residuais. Uma execução do portão por candidato **sem outra carga na máquina** — medido: capturar e sondar na mesma leva estourou a cadência.

## 5. Contabilidade de custo (o número que a fatia existe para produzir)

Registrar, por execução: modelo; tokens de entrada/saída por etapa (investigação, escrita, iterações de correção); tempo de parede; número de iterações até o portão aceitar; e o resultado do portão. Comparar com o `native` na mesma tabela. **Sem isso não há decisão** — a receita manual funcionou, mas nunca foi medida.

## 6. Escolhas já feitas (técnicas) e a que falta (produto)

- **Site: gsap.com**, não farmminerals — menor (188 mil vs 429 mil tokens sem Lottie), stack diferente (Vite/SPA vs Webflow), e é a cobaia que expôs o `fetch` de runtime. A cobaia de sempre esconde a classe.
- **Uma execução, não três** — primeiro o denominador; variância vem depois, se o número justificar.
- **Falta o OK para gastar** e a escolha do modelo do agente. Estimativa honesta: leitura de ~190 mil tokens + escrita de uma página de 10 mil px + 2–4 iterações contra o portão. Ordem de grandeza de **1–3 milhões de tokens** por execução; o preço depende do modelo escolhido.

## 7. Execução 1 — verbatim PURO (iniciada 2026-09-29 ~16:46 BRT)

- **Alvo:** `https://www.farmminerals.com/promo` — a cobaia onde existe a régua manual de 17/jul, para comparar o método automatizado com o que o Adilson fez à mão. (gsap.com fica para a execução 2 / terceira via.)
- **Insumo do agente, e só ele:** o prompt do Adilson (`PROMPT_VERBATIM_PURO.template.md` renderizado), a gravação na forma de 24 quadros por parada (`_verbatim/ref3`, 1440×1200) + `reference.meta.json`, e a URL viva. Sem inventário de máquina, sem pacote nativo — é o braço 2 da comparação de três.
- **Modelo:** Fable 5.1 via `Agent` desta sessão. **Custo** sai do uso reportado ao fim + `WORKLOG.md` com carimbo por fase.
- **Saída:** `_verbatim/verbatim-farm/assets/index.html`.
- **Julgamento (depois, máquina livre):** referência dupla nova sob o portão atual → autocontrole; candidato verbatim; candidato native (`_verbatim/native3`) na mesma trajetória; `verbatim-traces --dom` nos dois.
