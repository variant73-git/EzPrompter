# Cópia editável no Edit — desenho da 1ª entrega

> Data: 2026-10-09 · Status: para revisão do Adilson · Decisões de produto: Adilson (2026-10-08/09) ·
> Arquitetura: Claude, com segunda opinião do Codex · Teste decisivo: Vercel Sandbox (§11)

## 0. Resumo (o que o usuário vai ver)

1. Clica em **Edit** num node de site. O node mostra o site atual **borrado**, um **número grande de
   porcentagem** no centro e o **contorno do node enchendo** junto com o número.
2. Em alguns minutos (a montagem medida levou 5 a 6 minutos em dois sites; o total do clique até a cópia
   ainda vai ser medido) aparece a **cópia editável**: a nossa estrutura limpa do site, com as animações tocando
   pelo nosso tocador. Em sites com cena 3D, a cena original aparece intacta, por trás ou por cima.
3. Ele edita texto, cor, fonte, imagem e layout (fora das áreas presas à cena 3D) e **edita as animações**
   (linha do tempo e quadros-chave).
4. Salva. Ao ligar o node a outros (style transfer, compor, extrair seção), a criação usa **a cópia com as
   edições** — o que ele vê é o que se cria.
5. Se a preparação falhar: aparece o motivo e duas opções — **Try again** ou **Open live clone instead**.
6. Nodes que já tinham edições no clone nativo continuam no nativo; o menu oferece **Convert to editable
   copy**, que leva as edições antigas para a cópia.

Custo de IA: zero (nada disso chama modelo). Custo de máquina: uma máquina virtual de ~6 min por Edit.

## 1. Objetivo e critérios de sucesso

**Objetivo:** o Edit de um node de site passa a abrir a cópia canônica (estrutura normalizada + movimento em
fichas + cena 3D nativa como camada + trava de layout), e a criação por nodes passa a enxergar as edições.

**Critérios de sucesso (a validar em M1–M4; o que já foi medido está em §11 — só a montagem de farmminerals
e landonorris):**
- Os 5 sites da bateria (farmminerals, gsap.com, landonorris, uptechsoft, bleibtgleich) abrem a cópia no
  node, com nota da régua de trajetória **no nível da referência gravada na própria máquina** (§11) e tempo
  total do clique até a cópia **≤ 8 min** (alvo; medido até agora só a montagem: 4,9–6,2 min em dois sites,
  sem captura, subida da máquina, transferência e publicação).
- Uma edição de texto, cor, fonte e de animação **sobrevive a recarregar** e **aparece na criação** (style
  transfer a partir do node editado usa o texto/cor editados).
- Falha em qualquer etapa termina em erro tipado + escolha, **sem cobrança da preparação** e sem node quebrado.
- Nenhuma credencial do banco ou do armazenamento entra na máquina que executa o código do site.

## 2. Decisões de produto (Adilson)

| tema | decisão |
|---|---|
| Espera | barra de progresso: blur sobre o site atual no node, numeral grande de % no centro, contorno do node como barra (anel que já existe) |
| Cena 3D | manter SÓ a cena do nativo, intacta, sem edição; layout em volta travado (conservador). 3D novo entra por node de code snippet; futuro = node 3D em three.js (memória `decision_3d_estrategia`) |
| Falha | motivo + escolha "Try again" / "Open live clone instead" |
| Nodes já editados no nativo | seguem no nativo; "Convert to editable copy" opcional |
| Edição na 1ª entrega | visual + **edição completa de animação** nas fichas |
| Criação por nodes | node com cópia cria a partir do documento dela, com edições; node nunca editado segue na captura; teste A/B antes de trocar todos |
| Nível de animação | declarado + observação, **sem** verificação (mesmo tempo; farm 0,943 × verificada 0,945) |
| Protocolo de gravação | laço agrupado + leitura assentada a 1,0 s (decisão de 2026-10-08) |

## 3. O que existe hoje (fatos que o desenho usa)

- **Edit hoje:** `handleEditingToggle` → `planEditEntry` → `POST /api/nodes/[id]/reconstruct` →
  `reconstructSiteNode` → produtor nativo `captureNativeBundle` (~25 s; Browserbase ou Chromium local) →
  `registerNativeBundle` (Blob, descritor v1) → snapshot `native-bundle` → servido por sessão de edição
  (`runtime-session`, lease por hostname, `/api/rt/...`, CSP única) com a ponte (`runtime-bridge-source.js`)
  → editado pelos painéis de fora (`NativeMotionEditor` + `useNativeMotionController`), salvo como manifesto
  de transações (`motion_manifest` v2) e reaplicado ao recarregar. Rota com `maxDuration = 300`; sem fila.
- **Criação hoje:** `/api/nodes/[id]/run` lê `snapshots.html` da fonte. O commit de uma edição nativa grava
  snapshot `native-edit` com `html = NULL`, e `assertRunPreconditions` (`lib/clone-document-freshness.js`)
  **recusa** fonte com edições ("its document does not include yet") — editar e depois criar está quebrado.
- **Cópia canônica:** existe só em scripts. `scripts/normalizar-clone.mjs normalizarCaptura` serve a captura
  por um servidor local, abre Chromium local, grava o movimento (100 px por parada), normaliza o DOM e escreve
  `index.html` + `motion.json` (+ `motion.<modo>.json`) + `vendor/` + arquivos usados + `plano.json`.
  O tocador (`lib/motion-program/uncraft-motion.js`) lê o programa embutido ou `motion.json` e expõe
  `__uncraftMotion` com `validar/montar/desmontar/aplicar(id, campos)/relatorio/fichas`.
- **Cena 3D:** `lib/native-plane/plane-mode.js` (o nativo só com canvas, transparente) + `plane-host.js`
  (iframe irmão, rolagem sincronizada, prazo para o "pronto"). Posição e âncoras hoje vêm de uma análise com
  **placa de vídeo** (`scripts/plano-nativo.mjs`), indisponível no servidor.
- **Trava de layout:** `data-u-trava` (`layout`/`regiao`/`fixa`) respeitada no editor-core e na ponte.
- **Padrão de tarefa persistida:** `challenge_jobs` (status + geração; o canvas consulta e dispara).

## 4. Arquitetura

```
Edit (canvas) ──POST──▶ rota Edit ──▶ (se preciso) captura nativa, como hoje
                              │
                              └──▶ cria canonical_job (status=queued) ──▶ 202 {jobId}
canvas ──consulta a cada ~2 s──▶ rota de consulta ──▶ avança a tarefa (passos curtos, idempotentes):
     queued → provisioning (cria máquina, entrega captura+código) → recording/normalizing (lê progresso
     da máquina) → packaging (busca o resultado) → committing (registra pacote, snapshot, cobrança) → ready
     └─ falha em qualquer passo → failed {código} (devolve cobrança, desliga máquina)
```

### 4.1 Tarefa `canonical_jobs` (fonte de verdade)
Campos: `id`, `node_id`, `user_id`, `source_snapshot_id` (versão do node ao enfileirar), `native_bundle_id`,
`status`, `stage`, `progress_done`, `progress_total`, `progress_pct` (monotônico), `generation`,
`attempt`, `lease_owner`, `lease_expires_at`, `sandbox_id`, `result_bundle_id`, `error_code`,
`error_detail`, `idem_key`, `created_at`, `updated_at`.
- Toda transição é **cercada** por `status + generation + attempt + lease_owner` (Codex: no `challenge_jobs`
  o `acquireLease` só olha id e validade — aqui não).
- **Uma tarefa ativa por node** (índice único parcial); um segundo Edit durante a preparação reencontra a
  mesma tarefa.
- **Publicação por comparação-e-troca:** só publica se o node ainda aponta para `source_snapshot_id` e a
  tarefa ainda está em `committing` da mesma geração/tentativa. Senão descarta o resultado.
- **Canvas fechado no meio:** a máquina termina a montagem sozinha (comando destacado) e fica viva até o prazo
  dela (30 min). Quem reabrir o canvas antes disso recebe o resultado (a consulta retoma a tarefa); depois, a
  tarefa falha e devolve a cobrança. Aceito na 1ª entrega.
- **Reconciliação:** um cron varre tarefas com prazo vencido → desliga a máquina, marca `failed`, devolve
  cobrança. No plano Hobby o cron roda 1×/dia (no Pro, por minuto) — o prazo da própria máquina é o limite real
  de custo; o cron só arruma o registro.

### 4.2 Execução: máquina virtual descartável (Vercel Sandbox)
- **Uma tarefa por máquina**, criada para a tarefa e desligada no fim (sucesso ou falha), `persistent: false`
  (o padrão guarda cópia do disco — estourou a cota do plano gratuito no teste).
- **4 vCPU / 8 GB** (2 vCPU reprovou em site com animação de canvas, §11). Prazo da máquina: 30 min.
- **Imagem própria** com Node, Chromium 148 (build Ubuntu 24.04 do Playwright 1.60), bibliotecas fixas
  (playwright-core 1.60.0, gsap 3.15.0, lenis 1.3.26, lottie-web 5.13.0) e o código da montagem — elimina os
  30–50 s de instalação medidos. Enquanto a imagem não existir: instalação na subida (medida e aceita).
- **Sem credenciais na máquina:** o servidor entrega a captura e o código por escrita de arquivos, dispara a
  montagem como comando destacado (o servidor não segura a conexão) e busca o resultado por leitura de
  arquivos; a máquina não recebe token do banco nem do armazenamento. Se um dia for preciso concluir sem
  ninguém consultando, a máquina ganha **só** um token de envio desta tarefa (um caminho, validade curta).
- **Rede de saída da máquina:** no teste ela estava ligada. Desligá-la durante a montagem (a captura é servida
  localmente) só vale se a medida mostrar o mesmo resultado — a medir em M1, não afirmado aqui.
- **Nunca retomar no meio:** se a máquina cair, a tarefa recomeça do zero numa máquina nova (uma vez); depois
  `failed`. A gravação é um experimento contínuo sobre uma página — não se picota.

### 4.3 Progresso (o número grande)
Etapas com peso fixo: captura nativa 0–10 % (avança por tempo estimado enquanto a captura roda e salta para
10 % quando ela termina; node que já tem captura começa em 10 %), subir a máquina 10–15 %,
**gravação 15–85 %** (paradas feitas / paradas previstas), montar 85–95 %, publicar 95–100 %.
- As paradas previstas saem da altura da página no início; a captura já carregou o conteúdo preguiçoso, então
  muda pouco. Se a página crescer, o total sobe e o número **desacelera — nunca volta**.
- A montagem escreve uma linha de progresso por parada num arquivo que a rota de consulta lê.

### 4.4 Falha
Códigos tipados: `capture_failed`, `sandbox_unavailable`, `recording_failed`, `timeout`, `publish_conflict`,
`internal`. O node mostra o motivo em inglês + "Try again" (nova tarefa) / "Open live clone instead" (abre o
nativo editável como hoje). Cobrança devolvida em toda falha.

### 4.5 Cobrança
A captura nativa cobra como hoje — ela continua útil mesmo se a preparação falhar (é o que abre em "Open live
clone instead"). A preparação da cópia ganha o ciclo **reservar ao enfileirar → finalizar só na publicação
bem-sucedida → devolver em falha**, pela tabela `operations` (idempotência por etiqueta, já existente), com a
finalização cercada como o resto. O preço da preparação é decisão de pricing (começa em 0).

## 5. Produção da cópia (dentro da máquina)

1. Entrada: a captura nativa já registrada (`native_bundle_id`).
2. `normalizarCaptura` com o protocolo decidido e movimento **declarado + observação** (o `motion.json` do
   pacote passa a ser esse modo; hoje ele é o de observação).
3. **Cena 3D sem placa de vídeo:** posição (atrás/na frente) pela **ordem de camadas** da página nativa — se o
   canvas pinta acima do conteúdo, ele é transparente fora dos desenhos (frente); se abaixo, é fundo (atrás).
   Trava **conservadora**: região que o canvas cobre; cena de tela inteira = layout da página inteira travado
   (texto, cor e fonte livres). **Antes de valer, confere-se contra a análise com placa de vídeo** nos sites já
   medidos (gilhuybrecht frente, landonorris atrás, bleibtgleich frente; farmminerals e tengilemalamala sem
   plano).
4. Saída: pacote com `index.html`, `motion.json`, `vendor/`, arquivos usados e `plano.json` — este **sem
   caminho absoluto**: aponta para o pacote nativo por `native_bundle_id`.
5. Registro: `registerNativeBundle({ sourceRoot })` (já aceita pasta) → snapshot **`canonical`** com
   `html = index.html da cópia` (o documento que a criação lê) e `native_bundle_id` da cópia; a cena 3D guarda
   o id do pacote nativo no plano.

## 6. Mostrar no node

- O gateway serve o pacote canônico pela sessão de edição, com a ponte e o tocador (já servidos como arquivos
  do pacote: `motion.json` e `vendor/` entram no índice).
- O canvas escolhe o editor pela origem do snapshot (`node-editor-kind`): `canonical`/`canonical-edit` abrem os
  mesmos painéis do editor nativo (`snapshots.source` é `VARCHAR(20)`; os dois nomes cabem).
- **Cena 3D:** um **segundo arrendamento** da mesma sessão, com papel `plano`, serve o pacote nativo em modo
  plano num **domínio diferente** (medido: só domínio diferente põe a cena em processo próprio; fluidez igual
  nesta máquina, mas a separação protege máquinas fracas). CSP do documento canônico ganha `frame-src` só para
  o endereço do plano; o plano ganha `frame-ancestors` só para o endereço canônico; mensagens checam origem,
  janela, sessão e nonce exatos (hoje o modo plano usa `'*'`).
- **Vigia:** se a página principal começar a perder quadros com o plano ligado, o plano sai e a cópia fica sem
  a cena (aviso discreto). Sem aviso de desalinhamento (decisão de 2026-10-06).

## 7. Edição

### 7.1 Visual
Pelos painéis de fora, pela ponte, como hoje: `style`, `text`, `attribute` sobre os ids canônicos
(descritivos e estáveis), respeitando a trava de layout (já implementada nas duas portas).

### 7.2 Animação (fichas)
- **Adaptador de fichas na ponte:** quando o documento tem `__uncraftMotion`, a ponte publica cada ficha como
  uma animação no formato que a linha do tempo e o inspetor já consomem (alvo, trilhas por propriedade,
  quadros-chave `de`/`para`/`quadros`, duração, curva, atraso, motor) — e NÃO publica os tweens GSAP que o
  tocador cria (uma fonte de verdade só).
- **Edição:** novo tipo de patch `ficha` (`{ fichaId, campos, antes }`) aplicado por
  `__uncraftMotion.aplicar(id, campos)`. O efeito NÃO se limita à ficha: numa ficha de linha, mudar `motor`
  vale para todos os membros da linha (o tocador propaga), e a remontagem inclui quem depende dela.
  Por isso: (a) a transformação do programa (mesclar campos + propagar pela linha + validar) sai do tocador
  para um **módulo partilhado** que o tocador, a ponte e a materialização usam — nenhum dos três reimplementa;
  (b) `antes` guarda o estado anterior de **toda ficha que a transformação tocou**, e desfazer restaura todas.
- **Linha do tempo:** a régua continua sendo a rolagem da página (fichas de rolagem) e o relógio da carga
  (fichas de carga/tempo); arrastar faixas muda `motor.inicio/fim` ou `atraso`/`duracao`.
- O contrato exato (forma das trilhas, quais campos cada controle edita) é a primeira tarefa do plano, lida
  do código atual dos painéis.

### 7.3 Salvar (manifesto + documento pronto)
- Durante a edição: manifesto de transações, como hoje (desfazer, autosave, reaplicar ao recarregar).
- **A cada salvamento:** o servidor **materializa** o manifesto num pacote novo e imutável — aplica `style`
  (atributo `style` no elemento do id; vence a regra por id, que não tem `!important`), `text`, `attribute` e
  `ficha` (pela transformação partilhada de §7.2) sobre o pacote base — e grava snapshot **`canonical-edit`**
  com o `html` pronto. Determinístico, sem navegador, em segundos. O manifesto segue sendo a verdade de
  autoria; o documento é a projeção que a criação lê.
- **O programa vai DENTRO do documento:** hoje a montagem grava as fichas só em `motion.json`, fora da página —
  uma edição de animação deixaria o `html` idêntico e a criação nunca a veria. A materialização (e a montagem)
  embute o programa em `<script type="application/json" id="uncraft-motion-programa">`, que o tocador já lê
  antes de `motion.json`; o `motion.json` continua em sincronia. O custo desse tamanho a mais na criação entra
  no teste A/B (§8).
- **Salvamentos concorrentes:** a materialização roda **dentro do salvamento que já existe**
  (`motion-session/commit`, que recusa revisão desatualizada com `revision_conflict`/`base_snapshot_changed`,
  409). Materializa a partir da revisão-base e da versão do manifesto daquele salvamento, e só aponta o node
  para o snapshot novo na mesma troca cercada; um salvamento antigo que chegue depois é recusado, nunca
  publicado por cima.
- **Alvo de cada patch:** a ponte nomeia elementos por `el-<hash(semente)>`, e na cópia todo elemento tem id
  próprio, então a semente é o id. A materialização resolve o alvo **pela mesma função da ponte** (módulo
  partilhado, não reescrito) e recusa casamento ambíguo — o mesmo contrato do `findSavedElement`.
- **Pacote novo sem recopiar tudo:** só documento, programa e arquivos novos (imagem trocada na edição) são
  gravados; o resto é o do pacote base. Se o descritor atual não permitir referenciar arquivos de outro pacote,
  o plano acrescenta essa capacidade — recopiar 17–33 MB por salvamento não é aceitável.

## 8. Criação por nodes

- `/run` (compor, style transfer, extrair): fonte com snapshot `canonical`/`canonical-edit` → usa o `html`
  materializado (sempre em dia por construção). O portão de frescor passa a aceitar esse caso; com edição
  **aberta e não salva**, mantém a recusa de hoje ("Save or discard them before running").
- Nodes nunca editados: continuam usando a captura, como hoje.
- **Teste A/B (fora do caminho crítico):** style transfer, compor e extrair seção a partir da captura × da cópia
  nos mesmos sites — qualidade (verificador de regras + visual) e custo (tamanho do documento). Se a cópia
  empatar ou ganhar, uma entrega seguinte troca todos os nodes. É gasto real de IA no provedor: roda só com
  OK do Adilson.

## 9. Nodes antigos e conversão

- Snapshot `native-bundle`/`native-edit` com edições: o Edit abre o nativo, como hoje.
- **"Convert to editable copy":** cria a tarefa com uma etapa extra — antes de gravar, **reaplica o manifesto
  salvo no nativo** (as mesmas transações que o recarregamento reaplica), e só então grava e normaliza. As
  edições de estilo/texto/imagem entram na estrutura; as de animação GSAP entram pela observação. Transação
  que não puder ser reaplicada é listada no aviso ("2 edits could not be carried over").
- A reaplicação roda dentro da máquina, sem o editor aberto. O plano de M5 começa medindo se ela reproduz o
  que o editor reaplica ao recarregar (mesmo resultado nos mesmos nodes) antes de construir em cima.

## 10. Entregas internas (cada uma com plano e testes próprios)

1. **M1 — Preparar e mostrar:** tarefa, máquina, progresso no node, publicação, falha com escolha, cobrança
   assíncrona; o node mostra a cópia (sem cena 3D, sem edição de animação). Sites com cena 3D, até M2: a
   cópia abre sem a cena.
2. **M2 — Cena 3D:** posição por ordem de camadas (validada), trava conservadora, segundo arrendamento em
   domínio diferente, CSP, vigia.
3. **M3 — Edição visual + salvar + criação:** materialização a cada salvamento, snapshot `canonical-edit`,
   `/run` lendo o documento, portão de frescor.
4. **M4 — Edição de animação:** adaptador de fichas, patch `ficha`, linha do tempo sobre as fichas.
5. **M5 — Conversão de nodes antigos** com reaplicação do manifesto.

M1–M4 ficam atrás de um interruptor (só desenvolvimento): sem M3, uma edição salva na cópia não chegaria à
criação, e sem M4 a entrega não cumpre "edição completa de animação já". Liga para usuários depois de M4;
M5 pode vir em seguida.

## 11. Evidência do teste decisivo (2026-10-09, Vercel Sandbox, plano Hobby)

| | montagem | nota (local) | estabilidade entre 3 rodadas |
|---|---|---|---|
| farmminerals, 2 vCPU | 4,9–5,2 min | 0,934–0,935 (0,943) | 0 janelas; 1 quadro de 142 numa sequência de canvas |
| landonorris, 2 vCPU | 7,8–10,9 min ❌ | 0,581–0,622 ❌ (0,620) | 9–15 janelas ❌ |
| landonorris, 4 vCPU | 5,2–6,2 min ✅ | 0,622–0,623 ✅ | 1–3 janelas (local: 2) ✅ |

Memória ≤ 2,2 GB. Referência e régua rodadas **dentro** da máquina (fontes do Linux ≠ macOS). Ubuntu 26.04
das imagens prontas não é suportado pelo Playwright 1.60 → `PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64`
(mesmo Chrome 148). Cena 3D em domínio diferente: processo próprio confirmado; fluidez da página igual nos
três modos nesta máquina (gilhuybrecht e landonorris).

## 12. Riscos e resíduos declarados

- **Plano da Vercel:** Hobby limita 4 vCPU, 45 min por máquina e armazenamento; uso real provavelmente pede
  Pro. Custo por clone medido em M1.
- **Sites com canvas pesado** dependem dos 4 vCPU; um site mais pesado que o landonorris pode passar de 6 min.
- **Uma imagem a mais ou a menos** numa sequência de canvas entre rodadas (farmminerals) — variação da máquina.
- **Posição da cena sem placa de vídeo** é heurística até ser conferida (M2); a trava conservadora prende mais
  do que o necessário em cena de tela inteira.
- **Tarefa sem canvas aberto** só avança pela reconciliação (cron); a 1ª entrega aceita.
- **Domínio da cena 3D** é pré-requisito de M2 (§13).

## 13. O que preciso do Adilson

- **M2:** um segundo domínio com subdomínios curinga (`*.dominio`) para a cena 3D (registro ~US$ 10/ano) —
  cada sessão ganha endereço próprio, como no domínio do editor. Um `*.vercel.app` de outro projeto também é
  domínio diferente para o navegador e não custa nada, mas não tem curinga: todas as sessões partilhariam um
  endereço só.
- **Antes de abrir a usuários:** decidir o plano da Vercel (Hobby × Pro) com o custo por clone medido em M1.

## 14. Fora desta entrega

Workflow da Vercel como orquestrador (a consulta + reconciliação basta agora); troca da captura pela cópia em
todos os nodes (depende do A/B); edição de 3D; sites só-WebGL com rolagem virtual; exportação para o Figma.
