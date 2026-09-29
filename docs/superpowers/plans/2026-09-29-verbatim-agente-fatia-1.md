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

## 8. Fila — JEV como ADAPTADOR DE PROMPT por site (pedido do Adilson, 2026-09-29)

**Ideia:** o prompt do verbatim é um só para todo site. Sites diferem no que têm — GSAP, ScrollTrigger, Lottie, parallax, pin, smooth-scroll (Lenis), vídeo, canvas/WebGL, 3D — e no que não têm. Um prompt que fala de Lottie para um site sem Lottie gasta atenção do modelo; um que não fala de pin num site cheio de pin perde fidelidade. O JEV adaptaria o prompt ao site.

**Divisão de trabalho, para não errar de novo o alvo do JEV:**
1. **Fatos, determinísticos e grátis (já existem):** `engines` da captura (`gsap`, `scrollTrigger`, `lenis`, `lottie`, `browserAnimations`); inventário de movimento (contagens, scrub/pin/start/end por gatilho, durações, easings); sinais de stack (`meta generator`, nomes de bundle, marcadores de hydration — Webflow/Framer/Next/Vite); chamadas de runtime (`envelopesDeReplay` > 0 = conteúdo buscado em runtime); challenge; formulários/consent/auth; `<video>`, `<canvas>`, WebGL; sliders; sticky.
2. **JEV — julgamento sobre os fatos (uma-de-N / sim-não / nota):** arquétipo do site (`marketing-animado` · `spa-com-dados-em-runtime` · `estático` · `webgl-pesado` · `challenge-first`…); **família** de cada gatilho de rolagem (`reveal` · `parallax` · `pin` · `scrub` · `wipe` · `loop`) — os números vêm do inventário, o NOME da família é julgamento; e as chaves não-animação que mudam o prompt (tem formulário → neutralizar; tem vídeo de fundo → reproduzir playback; conteúdo em runtime → o replay tem que estar no substrato).
3. **Prompt condicional:** o template ganha blocos ligados/desligados pelo resultado do JEV, em vez de um parágrafo genérico para tudo.

**Critério de aceite (sem ele é fé):** A/B pelo portão no MESMO site — prompt genérico × prompt adaptado — nas dimensões de fidelidade, movimento e vestígios. Se o adaptado não ganhar de forma clara, a adaptação não paga (mesmo custando ~US$ 0,0001 por site em JEV).

**Ordem:** depois das execuções 1 e 2 (verbatim puro e terceira via), porque só faz sentido adaptar um prompt cujo resultado base já foi medido.

## 9. Fila — Sonnet 5.5 na receita, medir custo (pedido do Adilson, 2026-09-29)

Dois encaixes possíveis, e são medições distintas:

| encaixe | o que troca | contra quem compara |
|---|---|---|
| **(a) o agente do verbatim puro** | a execução inteira roda em Sonnet 5.5 em vez de Fable 5.1 | execução 1 (Fable): mesmo prompt, mesmos quadros, mesma URL, mesmo portão |
| **(b) a emissão por visão (iter9 / `extract-llm`)** | `STRONG_VISION_MODEL` = Sonnet 5.5 no lugar de `gpt-5.5` / `gpt-5.6-terra` | a tabela de abril (Gemini 3.1 Pro $0,525; Sonnet 4.6 "nada muito melhor", 2× o preço) |

Regras para o número valer: (1) confirmar o **id e o preço** do Sonnet 5.5 na doc oficial no dia do run — não usar a tabela de `lib/agent/cost.js`, que ainda só tem `claude-sonnet-4-6` ($3/$15); (2) custo = uso reportado da execução, por fase, no `WORKLOG.md`, como na execução 1; (3) qualidade pelo portão com autocontrole, nunca por opinião; (4) uma execução primeiro, variância depois.

**Ordem:** (a) logo depois da execução 1, porque é a comparação mais limpa (tudo igual, só o modelo). (b) é outra frente (o clone por visão), quando o iter9 voltar à mesa.


## 10. Execução 1 — resultado, auditado (Astra A) — 2026-09-29

### O protocolo REAL (corrige o §6–7): farmminerals.com/promo, insumo = prompt do Adilson + 24 quadros por parada + URL viva. **Não** gsap.com, **não** pacote nativo. O piso 0,886 do gsap.com NÃO se transporta; o autocontrole do farmminerals está sendo medido agora.

### Custo (o denominador)
- **315.117 tokens** reportados pelo harness (entrada + saída; sem divisão, sem cache/imagem/raciocínio discriminados), 85 chamadas de ferramenta, fases do agente 17 min 07 s, envelope do harness ~18 min.
- **"~US$ 4" RETIRADO**: não é derivável desses dados (preços de entrada e saída diferem 5×). Fica "0,3 M tokens"; dólares só com a divisão — a próxima execução tem que registrar entrada/saída/cache separados.

### "O agente espelhou" — agora é número, não indício
Sobreposição estrutural entre o `index.html` entregue e o HTML vivo capturado (native3):
- sequência de tags: **99.76%** (1228 vs 1231 tags)
- sequência de textos: **99.62%** (533 = 533)
- scripts com o mesmo nome: **8/8 byte-idênticos**; diferença = os 2 schemas bloqueados por ORB (removidos) + jQuery sem o sufixo de hash.

**Mas (Astra): isso é CUMPRIMENTO do prompt, não incapacidade.** "Keep the exact DOM and layout logic where observable" + URL viva torna o DOM observável → espelhar é obedecer. **Esta execução não testa a hipótese de homogeneização.**

### O que o relatório do agente afirma e o que o portão pode confirmar
Verificáveis pelo portão: altura, rolagem, texto/imagens, requisições na trajetória, console, SSIM, movimento, editabilidade, vestígios. **Auto-relato** (não provado): horários, 323 respostas, 369 downloads sem falha, 378+31 substituições, versões de bibliotecas, ffprobe, tablet/mobile/menu.
SSIM do agente, os 24 (a lista tinha 7 dos 9 abaixo de 0,98 — os 2 que faltavam estão aqui): 000 0.61 · 001 0.93 · 002 0.98 · 003 0.96 · 004 0.99 · 005 1.00 · 006 0.98 · 007 0.97 · 008 0.90 · 009 1.00 · 010 0.83 · 011 0.69 · 012 1.00 · 013 1.00 · 014 1.00 · 015 0.99 · 016 0.99 · 017 1.00 · 018 0.99 · 019 1.00 · 020 1.00 · 021 1.00 · 022 1.00 · 023 1.00. Every frame below 0.95 was inspected: 000 = reference still shows the preloader (its load took 10.9 s; locally load fires at ~4 s so the intro had finished) — the intro choreography itself was compared against the reference video at 0.5 s steps and matches stage for stage; 001/008/010/011 = the reference caught SplitText char reveals mid-stagger (from:"random", capture delays up to 132 s in report.json) and looping videos at other playback moments; 003/007 side-by-side difference images show only the video frame / a reveal already completed. Tablet 768 and mobile 390 render with 0 errors / 0 broken images; MENU opens the side bar; CONTACT hover, grow-button click work.
As justificativas (preloader 10,9 s vs ~4 s; SplitText aleatório; vídeo em outra fase) são **mecanismos plausíveis, não causas demonstradas** — exigem diff por região. E a diferença de timing do preloader **viola** "exact timing", não absolve.

### O que discrimina de verdade (Astra)
Native e espelho terem a mesma fidelidade não é inteiramente tautológico (o portão ainda pega falha de localização/asset/runtime), mas a comparação discrimina só **empacotamento, independência, custo e latência** — não homogeneização. A sonda de editabilidade detecta patologias (pe:none, split, obstrução), **não** conformidade a uma representação homogênea.

**Métrica mínima proposta — Cobertura Canônica de Edição:** `unidades visíveis mapeadas 1:1 para um nó canônico e editáveis pela API padrão (sem HTML/JS opaco, sem adaptador específico) / unidades visíveis pré-selecionadas na referência`; a edição persiste após reload e não altera pixels fora do alvo além de tolerância. Denominador: texto, mídia e containers escolhidos ANTES na referência.

**Menor mudança de prompt que testa a hipótese (execução 2):** trocar a cláusula do DOM por — *"Keep the exact rendered geometry and behavior, but express the page in Uncraft's canonical editor schema: one semantic editable node per visible unit, with no copied source DOM, page-specific selector graph, or executable page code. Original content, media and libraries may be reused."* As demais exigências (pixel, conteúdo, ordem, movimento, responsivo) impedem redesign. **Pré-requisito:** o schema canônico precisa existir por escrito; "clean, organized code" não é tratamento experimental.

### Conclusão honesta HOJE
- Evidência forte, agora estrutural, de que o agente produziu um **espelho localizado** — exatamente o que o prompt pediu.
- Se o portão confirmar paridade, o **`native` é provisoriamente superior** para a tarefa "espelho local 1:1": mesmo resultado, 24 s, zero tokens.
- **NÃO se pode concluir:** que o agente não consegue homogeneizar; que native e verbatim têm a mesma editabilidade (a medir); que a terceira via perde; que os SSIM baixos são inofensivos; quanto Sonnet custaria; que qualquer coisa generaliza para outros sites.

## 11. Astra B1 (portão) — adjudicado, 2026-09-29

Cinco achados, cinco procedentes. Aplicados agora (lado do `compare` + metadata da rajada):
- **#2 censura seletiva por deriva** — ponto fora de sincronia onde a REFERÊNCIA se move não some do denominador: vira `inconclusivo-deriva-em-ponto-movel` e torna SSIM e movimento inconclusivos. Maioria global sozinha deixava passar exatamente os quadros que animam.
- **#3 regime por XOR** — coberto pela deriva por quadro + #2 (déficit por parada já está em `atrasoAcumuladoMs`).
- **#4 backends misturados** — cada rajada registra `captureMode` + viewport/DPR; `compare` recusa `cdp` vs `playwright` no mesmo ponto; falha do CDP refaz a rajada INTEIRA no Playwright; `caret:'hide'` nos dois.
- **#5 mínimo absoluto = falso vermelho** — vira ESCOPO: página com < 3 pontos móveis recebe veredito *limitado a N ponto(s)*, com a instabilidade declarada; inconclusivo só por ponto móvel perdido.

**Pendente — muda o instrumento e exige recapturar:**
- **#1 calibração não transferível (Crítico).** Energia é média sobre o quadro inteiro: depende de área, contraste e tipo (deslocamento ≠ opacidade ≠ vídeo). Um botão 200×50 se movendo 8 px lê ~0,10 e cai abaixo de `PISO_REFERENCIA=0,5` (falso "referência parada"); um cursor/vídeo/canvas alheio dá energia a um candidato com a animação principal congelada (falso verde). Correção desenhada: **energia por REGIÃO** — máscara dos pixels que mudaram na referência, energia do candidato medida só nela e normalizada pela área; calibração por classe; piso medido em página viva ociosa, não só em `<img>`. Exige guardar o mapa de diferença por parada → re-runs.
