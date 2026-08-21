# Finding — o iter9 tem lugar? (investigação do "buraco", 2026-08-21)

**Pergunta do Adilson:** "o iter9 a princípio é só um bom método legado com
utilidade pra sites 100% estáticos. É isso que devia ser a função dele CASO ele
seja mais barato pra clones estáticos que o native."

Investigação em nível de CÓDIGO. Abaixo, o que está **medido** separado do que
está **inferido da estrutura** — a disciplina da Tabela A/B (item 173). Nada
aqui autoriza mudar roteamento antes da medição do §4.

---

## 1. FATOS (lidos no código, verificáveis por quem abrir o arquivo)

**F1 — o produtor native NUNCA propõe candidatos.**
`lib/native-clone/capture-bundle.js:352` devolve `candidateControls: []`,
literal, em todo clone.

**F2 — lista vazia OBRIGA a chamada de modelo.**
`needsCustomGeneration` (`lib/motion-editor/control-capabilities.js:191`):
`return (classifiedControls||[]).length === 0 || useful.length < target`.
Ou seja, **zero candidatos ⇒ `true`**. Com F1, o predicado é verdadeiro em
TODO clone native — inclusive num site 100% estático, onde não há movimento
algum para converter.

**F3 — a chamada é de raciocínio, não de visão.**
`control-generation.js`: `model: gpt-5.6-terra`, `reasoning: { effort: 'medium' }`,
entrada = `JSON.stringify({ evidence, remainingGaps })` (texto pequeno, sem
imagem), `max_output_tokens: 4096`, saída em json_schema estrito.

**F4 — o iter9 é uma chamada de visão com até 12 screenshots.**
`lib/reconstruct.js`: `MAX_STOPS = 12`, cada stop é um PNG de viewport inteiro,
mais miniaturas de assets, `max_completion_tokens: 32000`, modelo do harness
(hoje `gpt-5.5`; com o switch desta sessão, também `gpt-5.6-terra`).

**F5 — o custo de TEMPO do native já foi medido antes desta sessão:**
22–24s a captura isolada (zero LLM) contra 177s do iter9 (handoff 2026-08-10).
O que NUNCA foi medido é o tempo/custo da etapa `motion-controls` — que a
telemetria desta sessão passa a gravar em stage separado.

---

## 2. INFERÊNCIA (estrutura, ainda NÃO medida)

**I1 — o native paga modelo em site estático, e paga pelo pior motivo.**
De F1+F2: a etapa de controles roda sempre. Num site sem animação ela gasta
tokens de raciocínio para concluir que não há nada a propor. É a hipótese
central a medir.

**I2 — o iter9 dificilmente é o mais barato, nem em estático.**
De F3+F4: uma chamada de texto pequeno com raciocínio médio (teto de 4096 de
saída) contra uma chamada com ~12 imagens de viewport e saída de até 32k
tokens. A ordem de grandeza favorece o native com folga; a hipótese do Adilson
("iter9 mais barato para estáticos") tende a CAIR. Mas ordem de grandeza não é
medida — §4 decide.

**I3 — se I1 for confirmado, o remédio NÃO é rotear para o iter9, é o
curto-circuito.** Um clone sem evidência de movimento não precisa de proposta
de controles: sem candidatos E sem engine detectada, o manifesto vazio é a
resposta correta e custa zero. Isso tornaria o native ~zero-LLM para sites
estáticos — e aí o iter9 perde a última justificativa de custo.

⚠️ **Cuidado que essa mudança exige:** `needsCustomGeneration` também devolve
`true` quando há candidatos porém poucos (`useful.length < target`), que é o
caso legítimo de "peça ajuda ao modelo". O curto-circuito só pode valer para o
caso **vazio E sem engine detectada** — `capture-bundle` já reporta
`detectedEngines` (gsap, ScrollTrigger, lenis, lottie, browserAnimations), e é
esse o discriminador honesto. Site com GSAP e zero candidatos continua indo ao
modelo.

---

## 3. O QUE MUDA NA DOUTRINA (proposta, não decisão)

A doutrina do 183 diz: "clone é UM — o animado". Se I1+I2 se confirmarem, ela
não muda: o iter9 **não** vira o motor dos estáticos, porque é mais caro que o
native também neles. O papel dele fica sendo o que já é hoje —
(a) exceção deliberada da composição textual (`/run`, 179#10), e
(b) motor por nome, para comparação e para o caso em que o bundle não serve.

Se, ao contrário, a medição mostrar o iter9 mais barato num perfil real de site
estático, aí sim a regra do Adilson entra: iter9 passa a ser o motor NOMEADO
desse perfil, com o detector decidindo — e valeria a pena porque seria
economia recorrente.

---

## 4. COMO MEDIR (o experimento que decide)

O Console já grava tudo que o experimento precisa; não é preciso instrumento
novo. Procedimento:

1. Escolher 3 sites **100% estáticos** (sem GSAP/Lenis/Lottie — confirmar pelo
   `detectedEngines` do relatório, não pela aparência) e 1 animado como
   controle.
2. Para cada um, clonar DUAS vezes: o padrão (native) e "Clone with iter9
   (static)" pelo menu do node.
3. Ler no Console, por linha: `engine`, `totalMs`, o stage `motion-controls`,
   `costUsd`, `credits`, e o SSIM quando houver.
4. Comparar **por site**, não em média — a variância entre sites é maior que a
   diferença entre motores (lição 183: ±40% na mesma config).

**Critérios de decisão, escritos ANTES de ver o resultado:**
- Se `motion-controls` em site estático custar ~zero → I1 cai, não há o que
  otimizar, iter9 segue só nos dois papéis atuais.
- Se custar de verdade E o iter9 total for MAIOR → confirma I2: implementar o
  curto-circuito de I3 e manter o iter9 onde está.
- Se o iter9 total for MENOR em estático → a regra do Adilson vale: rotear
  estático por nome para o iter9 (e ainda assim implementar I3, que é
  ortogonal).

**Contra-prova obrigatória:** o braço de controle (site animado) tem que
mostrar `motion-controls` com custo claramente maior que o dos estáticos. Se
não mostrar, o instrumento não está medindo o que se pensa (lição do "zero sem
controle", item 177).
