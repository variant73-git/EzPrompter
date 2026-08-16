# Handoff — instalar o verificador de regras dentro do Uncraft

> **Para o Adilson pedir, e para a próxima sessão executar.**
> Estado: o verificador existe e funciona. Falta ele ser acionável de dentro do Uncraft.
> Ramo `feat/design-eval-checker` (commits `8b681766`, `8c14e9ff`), suíte 1822 verde.

## Corrigindo a procedência

Este verificador **nasceu para o Uncraft**. O projeto Amigo Secreto foi **cobaia** — serviu
para testar o verificador contra páginas reais, e serviu bem: três defeitos do verificador
só apareceram lá. Mas ele **não pertence** àquele projeto, e o único acionador que existe
hoje mora lá, o que é o inverso do que deveria ser.

## O que já está pronto

Pacote `@uncraft/design-eval` (em `packages/design-eval/`). Abre uma página gerada num
Chromium real e diz quais das 39 regras do `house-style` ela quebrou.

- **Não usa IA.** Custo zero por página, em qualquer volume.
- **É detector, não avaliador.** Devolve `violations` / `notDetected` / `unjudged`. Sem
  nota, sem limiar, sem peso — decisão de produto do Adilson.
- `notDetected` **não é aprovação**: nenhum critério tem cobertura completa; cada lacuna
  está declarada em `COVERAGE`.
- Importar **só** `packages/design-eval/src/index.js`. Nunca os arquivos atrás dele.
- Duas portas: `runDesignEval(page, html, ground)` para artefato em string;
  `runDesignEvalOnPage(page, ground, { source })` para página já carregada por URL — use
  esta quando o CSS for externo, senão os checks de CSS ficam cegos.

**Interruptor das regras:** `UNCRAFT_HOUSESTYLE=off` desliga a diretiva inteira na
geração (10.488 caracteres → 0). `houseStyleEnabled()` diz de que lado a execução estava.

## ✅ Estado em 2026-08-13, fim do dia

As três peças foram feitas. O que segue abaixo é o plano original, mantido como registro.

- **Peça 1 — feita** (`711cc4fd`): `packages/web-shell/scripts/check-house-style.mjs`. Recebe
  arquivo ou endereço, sobe o Chromium, imprime legível. Arquivo local é SERVIDO por HTTP
  (`lib/serve-folder.js`, com teste próprio contra escape de pasta). Auditoria do Sol: 6
  achados, todos corrigidos — dois graves (o servidor podia entregar arquivo de fora da pasta;
  os bytes conferidos podiam vir de outra requisição que não a medida).
- **Peça 3 — feita** (`56bf9ea` no repo do Amigo Secreto): o `tools/slop.mjs` de lá virou casca
  que só guarda o chão de verdade daquele projeto e chama o acionador do Uncraft. Saída
  idêntica à de antes, verificada.
- **Peça 2 — construída** (`edea08eb`), e o desenho mudou por dois achados:

  1. ⚠️ **O banco não chegava na geração.** A rota de plano gravava em modo sombra e nada
     injetava no prompt. Comparar "com banco" e "sem banco" mediria o vazio. Ligado em
     `878b67eb`: `lib/design/reference-directive.js` + `runCompose({ referencePlan })`, com
     interruptor `UNCRAFT_REFERENCES=off`.
  2. ⚠️ **O interruptor levava junto o que não devia.** `UNCRAFT_HOUSESTYLE=off` desliga 37
     guardrails **mais o bloco ABSORB** — e o ABSORB é a doutrina de referência ("REFERENCE
     USE — preserve section topology…"), o mesmo vocabulário do plano do banco. Os dois lados
     da comparação passavam a diferir em mais de uma coisa. Corrigido em `fb230977`: existe
     agora `guardrails-off`, que é o estado que o experimento usa.

  Isso já adianta parte da resposta: **as duas fontes se sobrepõem por desenho** — o
  house-style diz COMO absorver uma referência, o banco diz QUAIS e com que papel.

  ⭐ **Autoridade por dimensão declarada no prompt** (advise do Sol, contra a minha inclinação
  de deixar ambíguo): a referência manda em estrutura, escala, ritmo e proporção; os guardrails
  mandam em fonte, cor e detalhes banidos; pedido explícito do usuário ganha dos dois. Deixar
  ambíguo faria o modelo resolver de um jeito diferente a cada geração, e a comparação mediria
  esse sorteio.

  **Como rodar:**
  ```
  node scripts/comparar-gosto-e-banco.mjs --brief-file brief.txt --seco        # sem gastar
  node scripts/comparar-gosto-e-banco.mjs --brief-file brief.txt --k 3 --user-id 1
  node scripts/relatorio-gosto-e-banco.mjs --pasta _comparacao-gosto-banco
  ```

---

## O que falta — três peças, em ordem

### 1. Um acionador dentro do Uncraft

Hoje não existe nada que o Adilson possa apontar. Precisa de um comando que receba uma
página (arquivo ou endereço), suba o Chromium, rode o verificador e imprima o resultado
legível.

Referência de como fazer: `tools/slop.mjs` no projeto Amigo Secreto — ele já resolve o
caso do CSS externo navegando por URL em vez de injetar string. **Trazer a ideia, não o
arquivo**; aquele runner tem paleta e chão de verdade do outro projeto embutidos.

Chão de verdade que o Uncraft já sabe medir e deveria passar: paleta medida da fonte
(`lib/design/sample-palette.js`), contagem de itálico e presença de monoespaçada na fonte.
Sem isso, esses checks voltam `unjudged` — corretamente, mas sem valor.

### 2. ⭐ A comparação: regras × banco de referências

**Esta é a pergunta de produto em aberto**, e é o motivo pelo qual o interruptor existe:
as regras de gosto e o banco de referências **se somam ou conflitam?**

Gerar a mesma página nos dois modos — com `UNCRAFT_HOUSESTYLE=off` e sem —, rodar o
verificador nos dois resultados e colocar lado a lado. **Entregar como imagem ou endereço
para abrir**, não como relatório: o Adilson não tem acesso visual a nada enquanto se
trabalha, e essa é regra fechada ([[feedback_dinamica_de_trabalho_uncraft]]).

Sem essa comparação, ninguém sabe se as duas fontes de orientação estão dizendo a mesma
coisa por caminhos diferentes ou brigando.

### 3. Recolher o acionador da cobaia

Depois que o Uncraft tiver o seu, o `tools/slop.mjs` do Amigo Secreto pode apontar para o
mesmo caminho ou ser aposentado. Ele já importa do pacote, então não quebra.

## Como o Adilson usa, em palavras

- "roda o verificador nesta página" → aciona a peça 1
- "roda com as regras desligadas" → mesma coisa com o interruptor em `off`
- "compara os dois modos" → peça 2

## O que NÃO fazer

- **Não ligar no caminho da geração.** Decisão dele: é ferramenta sob demanda, não roda
  sozinho, não custa nada por site gerado.
- **Não construir o "olho"** (modelo julgando a página por visão). Despriorizado: só
  valeria se rodasse automático, e não vai rodar.
- **Não reintroduzir nota, limiar ou peso.** Os critérios são ordens objetivas de
  construção; a pergunta é se a ordem foi seguida ([[decision_eval_compliance_not_grade]]).
- **Não voltar a ler HTML/CSS como texto.** Custou seis rodadas de auditoria e é a mesma
  lição do hero pixelado (itens 163/164): o caminho é o DOM via CSSOM.

## Contexto completo

`packages/design-eval/README.md` (uso, e o que o verificador NÃO alcança) ·
[[checkpoint_2026-08-13_verificador-de-regras]] · item 179 do CLAUDE.md
