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

---

# ADENDO — revisão adversarial Claude executada (2026-08-21)

Rodada ANTES do Sol, por agente Claude independente, sobre o diff completo.
**14 achados**, dos quais 2 ALTA. Todos verificados por mim lendo o código
antes de corrigir. ⚠️ Continua NÃO substituindo o Sol (item 176).

## Corrigidos nesta sessão

| # | Grav. | Achado | Correção |
|---|---|---|---|
| 1 | ALTA | **Preview apontava para rota de LABORATÓRIO** (`/api/native-clone/...`): 503 em produção, ignora o bundleId. A feature nasceu morta e ainda gravava até 8MB por clone. | Rota nova `app/api/nodes/[id]/preview-video/route.js`, autorizada por dono do board (padrão do thumbnail); `previewVideoUrl(descriptor, nodeId)`. Teste de regressão proíbe voltar a `native-clone`. |
| 2 | ALTA | **Console sem gate**: custo de PROVEDOR (`usageMicrocents`/`costUsd`) e o seletor de MODELO serviam a qualquer usuário. | `{user?.role === 'admin' && <DevWidget/>}`. |
| 3 | MÉDIA | `HARNESSES[id]` lia a **cadeia de protótipos** — cookie `constructor` devolvia a função `Object`, furando o fail-closed (não explorável hoje, mas a garantia era falsa). | `Object.hasOwn` no servidor e no cliente + casos de protótipo no teste. |
| 4 | MÉDIA | Teto do vídeo conferido **depois** de bufferizar (mesma classe do P0 do `res.body()`); e o produtor não recebia `signal`, então captura fora do prazo seguia escrevendo em /tmp. | `stat` antes do `readFile` (teste prova que não lê) + `signal: deadline.signal` no produtor. |
| 5 | MÉDIA | Efeito de medição era **código morto**: `contentSizeRef` nasce `{w:null,h:null}` (truthy). | Guarda passa a testar o CONTEÚDO (`?.w && ?.h`). |
| 8 | MÉDIA | **Teste testava uma cópia** do predicado — o componente podia divergir sem ficar vermelho. | `shouldShowPreviewVideo` exportado de `lib/preview-video.js`, usado pelo componente E importado pelo teste. |
| 9 | M-BAIXA | Teste do harness afirmava mais do que cobria. | Casos `constructor`/`__proto__`/etc. |
| 10 | BAIXA | Dedup devolvia `usageMicrocents: 0` — `0` é valor CONHECIDO e viraria `costUsd: 0` para um clone de $0.53 no primeiro caller que esquecesse o guard. | `null` (o "desconhecido" do módulo). |
| 11 | BAIXA | `poster` com PNG de página inteira dentro de box `cover` = zoom duro no canto. | `poster` removido. |
| 12 | BAIXA | Teto de 8MB multiplica por N nodes visíveis. | Teto para 3MB. |
| 13 | BAIXA | Rótulo caía em `meta.originUrl`, campo que não existe. | `node.origin_url`. |
| 14 | BAIXA | ⌥D roubava a tecla dentro de campos de texto. | Sai cedo em input/textarea/contentEditable. |

## NÃO corrigido — decisão deliberada, vai para o Sol

**#7 — o switch de harness NÃO alcança o clone animado.** O produtor native não
chama modelo; a única chamada daquele caminho é a geração de controles, com
modelo **hardcoded** (`control-generation.js:15`). Cheguei a adicionar o slot e
**revertí**: a fiação toca 5 pontos e um deles é `normalizeUsage`, que reporta o
modelo para o METERING — fiar às cegas, sem poder rodar o caminho, arrisca
cobrar pelo modelo errado. A verdade ficou escrita no `lib/harness.js`.
⚠️ **Consequência para o A/B:** o "−43% por clone" do Terra vale para iter9 e
clone de imagem; **não é testável hoje no clone native**.

**#6 — `cloneVision` alcança uma segunda chamada em `styleclone`** (o
`generateDesignMd`), então um A/B ali mede duas trocas. Estreitar para um campo
dirigido é follow-up.

## Suspeitas do revisor que EU não consegui fechar
- Gravar vídeo pode empurrar clones para `control_conversion_timeout` (que
  estorna e não cria node). **Não medido** — ver abaixo.
- O preview entra no `runtimeFingerprint` (lista de caminhos), então o mesmo
  site fingerprinta diferente com/sem vídeo. Nenhum consumidor comparando
  fingerprints entre capturas foi encontrado; sem dano demonstrado.

## ⚠️ O QUE CONTINUA SEM MEDIÇÃO (pendência dura)
A gravação ponta a ponta e **o custo em tempo do preview** NÃO foram medidos.
Duas tentativas em ambientes de nuvem falharam pela mesma causa: `curl` passa
(proxy por variável de ambiente) mas o **Chromium leva `ERR_CONNECTION_RESET`**.
Registro em `_teste-skill-video/WITNESS-preview-video.md`. O script
`scripts/witness-preview-video.mjs` está pronto e é uma linha na máquina local:
```
node scripts/witness-preview-video.mjs https://www.farmminerals.com/promo 2
```
Enquanto esse número não existir, a regra do Adilson ("se sacrificar
performance, volta pro estático") está apoiada só no interruptor do Console,
não em medida.
