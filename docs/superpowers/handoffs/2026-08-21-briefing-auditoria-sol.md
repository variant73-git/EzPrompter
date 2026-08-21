# Briefing da auditoria do Sol — sessão de telemetria/harness/preview (2026-08-21)

> STANDING do item 168: tudo passa por auditoria do Sol. Esta sessão foi
> REMOTA e **o Sol não existe neste container** (o CLI dele roda na máquina do
> Adilson). O que foi feito aqui: revisão adversarial por agente Claude
> independente. ⚠️ **Isso NÃO substitui o Sol** — o item 176 registra o caso em
> que o revisor Claude não pegou NADA e a diversidade de fornecedor foi a única
> defesa que funcionou. Esta auditoria está PENDENTE, e o código é
> money-adjacent.

## Como rodar (padrão do repo)

Bundle escopado, nunca `--mode diff` aqui (lição: estoura com untracked):
```
git diff origin/main...claude/skill-clone-comparison-fg9h0l -- packages/web-shell > /tmp/uncraft-sessao.diff
codex --mode prose --file /tmp/uncraft-sessao.diff --timeout 1500
```

## O que o Sol precisa atacar, em ordem de risco

### 1. DINHEIRO (prioridade máxima — é o histórico do repo)
- `lib/billing/context.js` passou a **devolver `usageMicrocents`** nos três
  retornos (sucesso e dois caminhos de dedup). Pergunta ao Sol: a exposição
  altera qualquer decisão de cobrança, ou é estritamente leitura? O dedup
  devolve `usageMicrocents: 0` — isso é honesto (replay não roda modelo) ou
  mascara custo real de alguma forma?
- `lib/deferred-reconstruction.js` grava `meta.cloneTelemetry` **depois** do
  settle, e só quando `!deduped && result?.ok`. O `UPDATE nodes` da telemetria
  é `.catch()`-ado (fail-open). Pergunta: existe caminho em que essa gravação
  interfira no estado do node ou corra com outra escrita de meta?
- `app/api/nodes/[id]/extract/route.js` grava `meta.cloneCost` pós-settle e
  **muta `billed.result.node.meta`** antes de responder. Pergunta: isso pode
  contaminar a resposta ARMAZENADA de dedup (a que é replayada num retry)?
- Escala de unidade: µ¢ → USD divide por 1e6; credits = ¢. Conferir em
  `lib/clone-telemetry.js` (`usdFromMicrocents`) e no `costUsd` da rota.
- `lib/agent/cost.js`: terra repriced para $2/$12 e kimi-k2.6 adicionado
  ($0.95/$4). Conferir contra as páginas oficiais — preço errado na tabela
  contamina metering E cobrança (mult sobre µ¢).

### 2. SEGURANÇA
- **Cookie escolhe modelo.** `lib/harness.js` + as três rotas: o valor vem do
  usuário. A mitigação é registry fechado (`HARNESSES[id] || baseline`).
  Pergunta ao Sol: existe QUALQUER caminho em que uma string fora do registro
  chegue a uma chamada de provider (ex.: `harness?.cloneVision` undefined
  virando string vazia e o SDK caindo num default)? E o `UNCRAFT_HARNESS` do
  env vence o cookie — isso é o desejado em produção?
- **Gravação de vídeo da página capturada** (`capture-bundle.js`): o arquivo
  entra no bundle e é servido por `/api/native-clone/[...path]`. Perguntas:
  (a) o bundle já era servido com que autorização? o vídeo herda a mesma?
  (b) captura autenticada/privada (o `privateCapture` que a geração de
  controles conhece) — o preview de uma página logada vira arquivo persistido;
  isso precisa do mesmo tratamento de ZDR/privacidade?
  (c) `_uncraft/preview.webm` pode colidir com um caminho REAL do site
  capturado, ou ser usado para escapar do diretório?

### 3. RECURSO / ROBUSTEZ
- `mkdtemp` + `rm(recursive)` no `finally`. O `aoCancelar` do signal fecha o
  browser por fora — o `finally` ainda roda e limpa? Em serverless o /tmp é
  compartilhado; sobra lixo em algum caminho de erro?
- `recordVideo` mantém o vídeo aberto até `context.close()`. Se a captura
  aborta ANTES do close, o arquivo fica órfão até o `rm`. Confirmar.
- Custo em tempo da gravação: medido por `scripts/witness-preview-video.mjs`
  (resultado em `_teste-skill-video/WITNESS-preview-video.md`). Se o Sol achar
  o método de medição frouxo (ordem dos braços, cache, n=2), dizer.

### 4. CORRETUDE DE UI
- `components/CanvasNode.jsx`: `<video>` substitui o `<img>` sob três guardas
  (Console, bundle-tem-vídeo, `!offscreenParked`). Perguntas: o desmonte ao
  sair da tela realmente libera o decodificador? `object-fit: cover` num vídeo
  16:9 dentro de um node alto — o que o usuário vê é aceitável ou engana sobre
  o conteúdo da página? A medição de `contentSizeRef` via `new Image()` tem
  corrida com o desmonte do node?

### 5. O MÉTODO (meta-auditoria)
- O `finding` do iter9 (`2026-08-21-iter9-tem-lugar-finding.md`) separa F
  (medido) de I (inferido). Pedir ao Sol para atacar **as inferências I1-I3** e
  o desenho do experimento §4: os critérios de decisão foram escritos antes do
  resultado, e o braço de controle é suficiente?
- Testes novos: `preview-attach.test.js`, `PreviewVideo.test.jsx`,
  `harness.test.js`, `clone-telemetry.test.js`, os de telemetria em
  `deferred-reconstruction.test.js` e na rota de extract. Pedir para procurar
  **teste que passaria com o código quebrado** (o padrão do mock sempre-true,
  item 183).

## O que já foi verificado nesta sessão (não repetir à toa)
- Suíte: 1920 passed, 77 skipped. As 2 falhas são de INFRA do container remoto
  (binário do Playwright ausente), não do código.
- `next build` compila.
- A gravação do vídeo tem testemunha própria: unit de anexação (5 casos,
  incluindo teto, vazio e exceção) + script de testemunha real.
