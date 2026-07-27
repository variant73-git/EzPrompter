# Handoff — Live Animated Clone Editing

**Data:** 2026-07-26
**Status:** Tasks 1–11 concluídas e verificadas; decisão da Task 12 resolvida e pacote de execução preparado
**Checkout:** `/Users/adilsonporto/Desktop/IA/Uncraft`
**Branch:** `codex/live-animated-clone-editing`
**Base:** `main` em `ec297fffd8303e512c8ce3a910930cc2d51b3635`

## Autoridades

- Produto: `docs/superpowers/specs/2026-07-26-live-animated-clone-editing-design.md`
- Execução: `docs/superpowers/plans/2026-07-26-live-animated-clone-editing-implementation.md`
- Contexto histórico: `docs/superpowers/handoffs/2026-07-25-edit-animated-clone-brainstorm-continuation-handoff.md`

Os três documentos foram lidos integralmente, na ordem solicitada. O spec segue
como autoridade de produto e o plano como autoridade de execução.

## Task 0 — checkout, ownership e baseline

### Checkout registrado

- Git root confirmado: `/Users/adilsonporto/Desktop/IA/Uncraft`.
- Branch de origem confirmada: `main`.
- HEAD de origem: `ec297fffd8303e512c8ce3a910930cc2d51b3635`.
- Branch isolada criada: `codex/live-animated-clone-editing`.
- Arquivos versionados modificados antes da Task 0: nenhum.
- Arquivos não versionados observados antes da branch: 1.510.
- Nada não versionado foi limpo, movido ou absorvido por esta implementação.
- Node: `v25.9.0`; npm: `11.12.1`; Bun: `1.3.11`.
- Lockfile versionado: `bun.lock`.
- Migration head por ordem de arquivos: `2026-07-16-workflow-templates.sql`.

### Decisões do primeiro checkpoint

O checkpoint foi encerrado após nova auditoria e a delegação explícita do usuário:

1. `main` é a linha de integração; esta branch é a owner do novo contrato do
   produtor e da integração em deferred reconstruction.
2. `/Users/adilsonporto/Desktop/IA/Uncraft-Demarcelizer-4`, branch
   `feat/demarcelizer-4-core`, é somente donor/reference. Ela está 54 commits
   atrás de `main`, zero à frente e contém 30 arquivos versionados modificados
   sem commit. Não fazer merge amplo nem editar esse worktree.
3. A funcionalidade útil do Demarcelizer já existe em `main` em forma integrada
   e endurecida: política de reconstrução adiada, idempotência, preservação do
   snapshot original e enquadramento de câmera. O novo contrato foi acoplado a
   esses boundaries atuais.
4. O provider de produção escolhido para bundles imutáveis é Vercel Blob
   privado. Desenvolvimento usa um diretório explicitamente configurado; não há
   fallback silencioso para disco local em produção.

### Baseline antes da implementação

```text
Baseline focal: 7 files, 98 tests passed
Suíte completa: 126 files passed, 1 skipped; 920 tests passed, 4 skipped
Build: Next.js 15.5.15; compiled; 41/41 static pages; exit 0
```

Aviso não bloqueante já presente na suíte:

```text
Warning: --localstorage-file was provided without a valid path
```

## Task 1 — contrato e armazenamento imutável de bundles

**Commit:** `41911ec8 feat(native-clone): add immutable bundle contract`

### Resultado

Foi criado um boundary estrito para snapshots nativos sem permitir que clones
legados com `animatedDetected` ou snapshots Iter9 se apresentem como bundles
nativos.

Novos módulos:

- `packages/web-shell/lib/native-clone/bundle-contract.js`
- `packages/web-shell/lib/native-clone/bundle-store.js`
- `packages/web-shell/lib/native-clone/register-bundle.js`

Novos testes:

- `packages/web-shell/lib/native-clone/bundle-contract.test.js`
- `packages/web-shell/lib/native-clone/bundle-store.test.js`
- `packages/web-shell/lib/native-clone/register-bundle.test.js`
- `packages/web-shell/app/api/nodes/[id]/reconstruct/route.test.js`

Integração modificada:

- `packages/web-shell/lib/deferred-reconstruction.js`
- `packages/web-shell/lib/deferred-reconstruction.test.js`
- `packages/web-shell/app/api/nodes/[id]/reconstruct/route.js`
- `packages/web-shell/package.json`
- `packages/web-shell/.env.example`
- `packages/web-shell/.gitignore`
- `bun.lock`

### Contrato entregue

- Schema v1 com parse/serialize estritos, UUID e SHA-256 validados.
- Índice de assets obrigatório e entrypoint contido nesse índice.
- Paths normalizados; paths absolutos, UNC/Windows, traversal simples ou
  codificado, bytes nulos, esquemas de storage e duplicatas normalizadas são
  rejeitados.
- Registro a partir de assets em memória ou de um diretório real.
- Symlinks que escapam do diretório-fonte são rejeitados.
- Hash e tamanho de cada asset são conferidos antes da materialização.
- Bundle ID determinístico derivado do hash do conteúdo.
- Escrita imutável e rejeição de colisões/mismatch de conteúdo.
- Candidatos nativos sempre entram como `status: pending`.
- O resultado persistido/retornado expõe somente o descriptor; paths do sistema
  operacional não atravessam o boundary.

### Storage

- Adapter em memória para testes.
- Adapter de filesystem somente fora de produção e apenas quando
  `UNCRAFT_NATIVE_BUNDLE_STORE_ROOT` estiver explicitamente configurado.
- Adapter Vercel Blob privado em produção via `@vercel/blob@^2.6.1`, exigindo
  `BLOB_READ_WRITE_TOKEN`.
- Nenhum fallback de produção para filesystem efêmero.

### Coexistência com o fluxo atual

- Resultado sem tag `{ html }` continua sendo Iter9 e conserva o SQL/status
  existentes.
- Apenas `{ kind: 'native', bundle }` entra no novo registro validado.
- Snapshot nativo usa `snapshotSource: 'native-bundle'`; Iter9 continua usando
  `snapshotSource: 'reconstruct'`.
- Os testes anteriores de preservação de snapshot original permanecem íntegros.

### Evidência tests-first e exit gate

Os novos testes falharam primeiro pela ausência dos módulos/exports e pela fonte
de snapshot ainda antiga. Depois da implementação:

```text
Suíte focal final: 8 files, 51 tests passed
Suíte completa: 130 files passed, 1 skipped; 949 tests passed, 4 skipped
Build: Next.js 15.5.15; compiled; 41/41 static pages; exit 0
git diff --check: clean
```

O mesmo aviso não bloqueante de `--localstorage-file` apareceu na suíte completa.

### Verificação com bundle real

O diretório real `Clone/dist` foi registrado pelo adapter em memória sem depender
de `UNCRAFT_NATIVE_CLONE_ROOT`:

```text
bundleId: fb297e47-6cd7-5567-8d43-9850f99127e9
contentHash: sha256:fb297e476cd7a5670d439850f99127e9f7d871dd57ede9fb44df212cab02806c
assets: 370
entryBytes: 135207
entryHasHtml: true
```

Foi observado apenas um warning do Node sobre reparsing ESM do script de
verificação. Ele não aparece nos testes/build e não justifica alterar o tipo de
módulo do app Next.js.

### Limite operacional ainda não exercitado

Não há credencial Vercel Blob disponível no checkout. O adapter de produção foi
testado isoladamente contra o contrato do SDK e participou do build, mas o upload
contra uma store real deverá ser exercitado quando a store privada e
`BLOB_READ_WRITE_TOKEN` estiverem configurados no ambiente.

## Task 2 — persistência de bundles, manifests e sessões

### Resultado

Foi adicionada a persistência server-side que ancora uma sessão mutável em um
snapshot/bundle imutável, sem substituir ou alterar o `save-edit` legado.

Novos arquivos:

- `packages/web-shell/migrations/2026-07-26-native-motion-editing.sql`
- `packages/web-shell/lib/motion-editor/manifest.js`
- `packages/web-shell/lib/motion-editor/manifest.test.js`
- `packages/web-shell/lib/motion-editor/edit-session-store.js`
- `packages/web-shell/lib/motion-editor/edit-session-store.test.js`

Arquivos modificados:

- `packages/web-shell/schema.sql`
- `packages/web-shell/app/api/nodes/[id]/snapshots/route.js`
- `packages/web-shell/app/api/nodes/[id]/snapshots/route.test.js`
- `packages/web-shell/app/api/nodes/[id]/snapshots/[snapId]/route.js`
- `packages/web-shell/app/api/nodes/[id]/snapshots/[snapId]/route.test.js`

### Contratos entregues

- Manifest v2 estrito, ancorado a `baseBundleId` e `runtimeFingerprint`.
- Histórico v1 adaptado deterministicamente; patches agrupados conservam uma
  única transação e valores estruturados de keyframes permanecem íntegros.
- Patch kinds, transaction sources e control kinds desconhecidos são rejeitados.
- Valores não JSON, ciclos e chaves inseguras não entram no manifest.
- Descriptor de bundle é persistido de forma idempotente; colisões imutáveis
  falham sem `DO UPDATE`.
- Abertura retoma a sessão ativa existente e exige node/snapshot nativo owned e
  corrente.
- Drafts usam revisão otimista e detectam revision, bundle, base-snapshot e
  sessão fechada como conflitos separados.
- Commit cria snapshot nativo, avança `nodes.current_snapshot_id` e fecha a
  sessão em uma única instrução PostgreSQL com CTEs mutáveis.
- Discard/expire alteram somente a sessão; o snapshot-base permanece íntegro.

### Schema e APIs

- `native_bundles` armazena metadata imutável, hash único, índice de assets e
  capabilities de reconstrução.
- `snapshots` recebeu `native_bundle_id`, `motion_manifest` e
  `motion_manifest_version`, com FK `ON DELETE RESTRICT` e check que impede
  manifest/bundle divergentes.
- `native_motion_edit_sessions` registra owner, node, snapshot-base, draft,
  revisão e status, com índice parcial garantindo uma sessão ativa por node.
- A lista de snapshots continua idêntica para snapshots legados e acrescenta
  somente IDs/versão nativos presentes.
- O detalhe continua idêntico para snapshots legados; snapshots nativos recebem
  metadata segura do bundle e manifest validado, sem `storage_key`.

### Evidência tests-first e exit gate

Os testes falharam primeiro pela ausência dos módulos e dos campos nativos nas
APIs. Depois da implementação:

```text
Suíte focal final: 4 files, 25 tests passed
Suíte completa: 132 files passed, 1 skipped; 970 tests passed, 4 skipped
Build: Next.js 15.5.15; compiled; 41/41 static pages; exit 0
git diff --check: clean
```

O aviso não bloqueante já conhecido de `--localstorage-file` permaneceu na suíte
completa.

### Verificação PostgreSQL real

Em um PostgreSQL 16 descartável:

- o schema legado da base da branch recebeu a migration;
- a migration foi aplicada duas vezes sem erro;
- o índice de content hash foi confirmado como unique;
- os dois constraints de snapshot foram confirmados uma única vez;
- abrir duas vezes retomou a mesma sessão ativa;
- autosave avançou a revisão de 0 para 1;
- uma escrita com revisão 0 foi rejeitada como `revision_conflict`;
- commit criou e manteve legível o snapshot com manifest;
- discard da sessão seguinte preservou o snapshot commitado;
- um manifest cujo `baseBundleId` divergia da FK foi rejeitado pelo banco.

O container e todos os dados descartáveis foram removidos após a verificação.

## Task 3 — gateway runtime assinado e node-scoped

### Resultado

O gateway local baseado em `UNCRAFT_NATIVE_CLONE_ROOT` deixou de ser um
boundary implícito de produção. Snapshots nativos agora podem abrir ou retomar
uma sessão owned e receber uma URL curta, assinada e read-only para o bundle
imutável correspondente.

Novos arquivos:

- `packages/web-shell/lib/motion-editor/runtime-session-token.js`
- `packages/web-shell/lib/motion-editor/runtime-session-token.test.js`
- `packages/web-shell/app/api/nodes/[id]/runtime-session/route.js`
- `packages/web-shell/app/api/nodes/[id]/runtime-session/route.test.js`
- `packages/web-shell/app/api/runtime/[token]/[...path]/route.js`
- `packages/web-shell/app/api/runtime/[token]/[...path]/route.test.js`

Arquivos modificados:

- `packages/web-shell/lib/motion-editor/native-clone-gateway.js`
- `packages/web-shell/lib/motion-editor/native-clone-gateway.test.js`
- `packages/web-shell/app/api/native-clone/[...path]/route.js`
- `packages/web-shell/app/api/native-clone/[...path]/route.test.js`
- `packages/web-shell/next.config.js`
- `packages/web-shell/.env.example`

### Contrato entregue

- Token HS256 dedicado, com audience, issuer, tipo, scope read-only, node,
  bundle, edit session, entry prefix, nonce e TTL máximo de cinco minutos.
- `UNCRAFT_RUNTIME_SESSION_SECRET` é obrigatório, tem tamanho mínimo e é
  rejeitado quando coincide com `JWT_SECRET`.
- Produção exige `UNCRAFT_RUNTIME_ORIGIN` HTTPS diferente da origem do app; a
  rota assinada recusa o host do app mesmo se houver configuração incorreta.
- A criação da sessão exige o usuário autenticado, o node owned e o snapshot
  nativo corrente. Configuração inválida não deixa uma sessão ativa órfã.
- O runtime ignora cookies ambientes do app. O cookie `uncraft_sess` permanece
  host-only e a rota de runtime não chama o boundary de login.
- Token expirado, alterado ou divergente em node/session/bundle produz a mesma
  página inerte e não técnica.
- Somente assets presentes no índice validado do bundle são lidos do store;
  traversal simples/codificado, bytes nulos, path confusion e assets não
  declarados são rejeitados.
- HTML recebe CSP, bootstrap com manifest/fingerprint/nonce e uma única bridge.
- Paths root-relative em HTML, CSS, módulos, JSON e SVG são rebased para o
  prefixo assinado. Bytes binários de imagens, fontes, vídeo e mídia não são
  alterados.
- HTML usa `no-store`; assets usam cache privado e imutável limitado pela
  expiração do token, com ETag do conteúdo efetivamente servido.
- Respostas assinadas usam `Referrer-Policy: no-referrer`, CSP restritiva,
  HSTS, CORS sem credenciais e headers compatíveis com o iframe sandboxed.
- O gateway `/api/native-clone` permanece disponível somente como adapter
  explícito do motion lab em desenvolvimento/testes e é recusado em produção.
- Os headers globais do app não são aplicados à rota isolada, evitando que
  `SAMEORIGIN` bloqueie o runtime cross-origin; a rota possui sua própria
  política mais restritiva.
- Falhas técnicas são registradas apenas por código sanitizado e digest curto
  do token, nunca com a URL assinada completa.

### Evidência tests-first e exit gate

Os testes falharam primeiro pela ausência do token/rotas, pela base ainda fixa
em `/api/native-clone` e pela injeção duplicável. Depois da implementação:

```text
Suíte focal final: 5 files, 31 tests passed
Suíte completa: 135 files passed, 1 skipped; 994 tests passed, 4 skipped
Build: Next.js 15.5.15; compiled; 41/41 static pages; exit 0
git diff --check: clean
```

O aviso não bloqueante já conhecido de `--localstorage-file` permaneceu na
suíte completa.

### Verificação com bundle real e browser

O bundle real `Clone/dist` foi registrado no store em memória e aberto em
Chrome dentro do mesmo iframe sandboxed usado pelo motion lab, servido por HTTP
com o prefixo assinado. Requests fora da origem local foram bloqueados.

```text
bundleId: fb297e47-6cd7-5567-8d43-9850f99127e9
assets: 370
bridge status: runtime-ready
external requests: 0
local 4xx responses: 0
browser console errors: 0
file:// used: false
UNCRAFT_NATIVE_CLONE_ROOT used: false
```

O primeiro smoke encontrou fonts/SVGs root-relative que escapavam a partir de
CSS e módulos. O rebasing foi ampliado somente para conteúdo textual; a segunda
execução ficou limpa. O script descartável exibiu apenas o warning já observado
de reparsing ESM por ausência de `type: module`; isso não aparece em testes nem
no build e não justifica mudar o tipo de módulo do app.

### Limite operacional ainda não exercitado

O domínio HTTPS dedicado e o upload/download contra Vercel Blob privado ainda
dependem da configuração real de `UNCRAFT_RUNTIME_ORIGIN`,
`UNCRAFT_RUNTIME_SESSION_SECRET` e `BLOB_READ_WRITE_TOKEN`. A rota de produção
recusa exposição sem as duas primeiras; o adapter Vercel permanece coberto por
teste isolado, mas não houve credencial real disponível para um smoke remoto.

## Task 4 — protocolo v2 transacional, validação e health

### Resultado

O bridge existente passou a negociar protocol v2 sem remover o envelope v1 do
motion lab. O host só promove uma mutação a histórico depois de receber
`transaction-committed`; transações rejeitadas ou interrompidas não entram em
Undo, Redo ou Save.

Novo módulo:

- `packages/web-shell/lib/motion-editor/transaction.js`

Novo teste:

- `packages/web-shell/lib/motion-editor/transaction.test.js`

Arquivos modificados:

- `packages/web-shell/lib/motion-editor/protocol.js`
- `packages/web-shell/lib/motion-editor/protocol.test.js`
- `packages/web-shell/lib/motion-editor/runtime-bridge-source.js`
- `packages/web-shell/lib/motion-editor/runtime-bridge-source.test.js`
- `packages/web-shell/components/motion-editor/NativeMotionEditor.jsx`
- `packages/web-shell/components/motion-editor/NativeMotionEditor.test.jsx`
- `packages/web-shell/app/api/runtime/[token]/[...path]/route.js`

### Contrato entregue

- `runtime-ready` permanece legível por clientes v1 e anuncia v2; o host negocia
  explicitamente antes de emitir comandos v2.
- Todo envelope v2 carrega versão suportada, session nonce, request ID, runtime
  generation, bundle e edit session. Source window, origin e todo o contexto são
  conferidos antes de qualquer mutação.
- `apply-transaction`, `rollback-transaction` e `validate-transaction` possuem
  acknowledgements explícitos e códigos de erro estáveis.
- Todos os valores `before` são lidos no runtime antes do primeiro write. Uma
  falha intermediária restaura as mutações anteriores em ordem reversa.
- Request IDs duplicados são idempotentes. O ledger do host segura respostas
  fora de ordem até que possam ser liberadas na ordem das ações do usuário.
- O ciclo de gesto captura `before` uma vez, coalesce previews por frame, limita
  contagem/tamanho/tempo, valida no fim e produz um único `after`.
- Cancelamento ou falha restaura o valor anterior sem histórico. Validação
  aplica, observa e restaura sem emitir uma transação persistível.
- Heartbeats e `runtime-health` são emitidos pelo bridge; o host detecta timeout
  e conserva somente mudanças já confirmadas.
- Uma nova geração de runtime invalida comandos e acknowledgements antigos. Um
  reload durante uma transação pendente mantém o histórico confirmado e rejeita
  a mudança ainda não reconhecida.
- Edições originadas dentro do runtime, como texto inline e move livre, também
  chegam ao host como uma única transação confirmada em v2.
- O bootstrap assinado agora inclui explicitamente bundle e edit-session IDs,
  além do nonce, manifest e fingerprint já existentes.
- A mensagem de falha permanece automática e não técnica; nenhum Retry, Repair
  ou detalhe do runtime foi exposto na UI.

### Evidência tests-first e exit gate

Os testes falharam primeiro pela ausência de `transaction.js`, dos exports v2 e
dos comandos transacionais no bridge. O primeiro fault-injection do bridge
registrou sete falhas esperadas antes da implementação. Depois da implementação:

```text
Suíte focal final: 5 files, 98 tests passed
Suíte completa: 136 files passed, 1 skipped; 1012 tests passed, 4 skipped
Build: Next.js 15.5.15; compiled; 41/41 static pages; exit 0
git diff --check: clean
```

O warning não bloqueante já conhecido de `--localstorage-file` apareceu somente
na suíte completa.

### Verificação de falhas

- Uma falha no terceiro patch de uma transação restaurou estilo e atributo dos
  dois patches anteriores exatamente aos valores lidos do DOM.
- Um rollback reconhecido foi executado como uma segunda transação atômica.
- Uma validation transaction aplicou `opacity`, observou o resultado e restaurou
  o estado anterior sem `transaction-committed`.
- Dois previews foram coalescidos e confirmados como uma única entrada; o fluxo
  cancelado restaurou `before` e criou zero entradas de histórico.
- Nonce, origin, bundle, edit session ou runtime generation divergentes foram
  ignorados sem mutar o DOM.
- Um reload simulado com transação pendente preservou uma mudança confirmada e
  não promoveu a mudança sem acknowledgement.

## Task 5 — controller nativo compartilhado e lab preservado

### Resultado

O engine que estava embutido em `NativeMotionEditor.jsx` foi extraído para um
único hook reutilizável. O motion lab continua sendo consumidor desse mesmo
controller, sem fork de protocolo, bridge, timeline ou painéis e sem iniciar o
roteamento do canvas.

Novos arquivos:

- `packages/web-shell/components/motion-editor/useNativeMotionController.js`
- `packages/web-shell/components/motion-editor/useNativeMotionController.test.jsx`
- `packages/web-shell/lib/motion-editor/session-history.js`
- `packages/web-shell/lib/motion-editor/session-history.test.js`
- `packages/web-shell/lib/motion-editor/devices.js`
- `packages/web-shell/lib/motion-editor/devices.test.js`

Arquivos modificados:

- `packages/web-shell/components/motion-editor/NativeMotionEditor.jsx`
- `packages/web-shell/components/motion-editor/NativeMotionEditor.test.jsx`
- `packages/web-shell/app/motion-editor/page.jsx`

### Contrato entregue

- O controller agora possui conexão com o bridge, negociação v1/v2, runtime e
  health, seleção, inspeção do viewport, fila transacional, histórico da sessão,
  playback, timeline, device, recovery e comandos de mutação.
- O componente visual conserva apenas layout: abas, escala do stage, expansão
  de layers, zoom e dimensões visuais da timeline.
- O hook recebe `iframeRef` e persistence adapter; `NativeMotionEditor` recebe
  runtime URL e adapter do chamador. A rota isolada fornece explicitamente sua
  URL e usa o adapter local atual.
- `localStorage` não é autoridade do controller. Ele existe somente no adapter
  do lab para o patch manifest legado e nas preferências visuais do próprio lab.
- Histórico é transacional e node/session-scoped: somente transações de usuário
  reconhecidas entram; Undo e Redo atravessam a sessão corrente em ordem; uma
  mudança após Undo remove somente o branch abandonado.
- Reparos automáticos ficam aninhados na transação causadora e acompanham essa
  única entrada em replay, Undo, Redo e persistência.
- Trocar device não cria histórico. As dimensões canônicas compartilhadas agora
  são desktop `1280x800`, tablet `768x920` e mobile `390x844`.
- Teardown remove listeners e timers; eventos tardios são recusados. Dois
  controllers na mesma página permanecem isolados pela source window do iframe.
- `NativeMotionEditor` caiu de 2.636 para 2.010 linhas e não contém mais ledger,
  message listener, histórico ou implementação do protocolo.

### Evidência tests-first e exit gate

Os testes novos falharam primeiro pela ausência dos três módulos e pelas
dimensões antigas do lab. Depois da extração:

```text
Suíte focal final: 7 files, 99 tests passed
Suíte completa: 139 files passed, 1 skipped; 1025 tests passed, 4 skipped
Build: Next.js 15.5.15; compiled; 41/41 static pages; exit 0
git diff --check: clean
```

O warning não bloqueante já conhecido de `--localstorage-file` permaneceu na
suíte. Não houve warning novo de build.

### Verificação com bundle real e browser

O motion lab abriu `Clone/dist` pelo gateway explícito de desenvolvimento e
preservou o fluxo principal depois da extração:

```text
runtime: connected
iframe sandbox: allow-scripts allow-pointer-lock
desktop viewport: 1280x800
tablet viewport: 768x920
Preview -> Edit: ok
Motion tab + Timeline: opened
browser console errors: 0
```

O clone emitiu um warning GSAP sobre `force3D`; ele vem do bundle servido, não
do controller, e não bloqueou runtime, interação ou build.

## Task 6 — roteamento elegível e viewport nativo no canvas

### Resultado

O canvas agora resolve o editor por contrato de snapshot e monta o controller
compartilhado em um viewport nativo fixo somente quando a feature flag e a
metadata nativa validada estão presentes. Static e Iter9 continuam no caminho
legado.

Novos arquivos:

- `packages/web-shell/lib/node-editor-kind.js`
- `packages/web-shell/lib/node-editor-kind.test.js`
- `packages/web-shell/components/motion-editor/NativeEditViewport.jsx`
- `packages/web-shell/components/motion-editor/NativeEditViewport.test.jsx`
- `packages/web-shell/components/CanvasNode.test.jsx`

Arquivos modificados:

- `packages/web-shell/components/CanvasClient.jsx`
- `packages/web-shell/components/CanvasNodeItem.jsx`
- `packages/web-shell/components/CanvasNode.jsx`
- `packages/web-shell/app/canvas/[boardId]/page.jsx`
- `packages/web-shell/app/api/boards/[id]/route.js`
- `packages/web-shell/app/api/boards/[id]/route.test.js`
- `packages/web-shell/app/api/nodes/[id]/route.js`
- `packages/web-shell/app/api/nodes/[id]/route.test.js`
- `packages/web-shell/lib/node-viewport.js`
- `packages/web-shell/lib/node-viewport.test.js`
- `packages/web-shell/.env.example`

### Contrato entregue

- `resolveNodeEditorKind(node, snapshot, flags)` é puro e só escolhe `native`
  para site/template/chunk com bundle UUID válido, manifest v2 suportado e
  `NEXT_PUBLIC_NATIVE_MOTION_CANVAS_EDIT` ativo.
- `animatedDetected`, `animatedRuntime` ou metadata do node não substituem a
  identidade do snapshot. Static, Iter9, manifest antigo e bundle inválido
  continuam no editor legado.
- A query inicial do board e os GETs de refresh carregam apenas bundle ID e
  versão do manifest. O manifest completo continua fora do payload inicial.
- A URL assinada é pedida somente ao abrir Edit. O iframe nativo usa
  `allow-scripts allow-pointer-lock`, sem `allow-same-origin`, e mantém
  `Referrer-Policy: no-referrer`.
- `NativeEditViewport` usa o mesmo `useNativeMotionController` do lab. Não foi
  criado fork de bridge, protocolo, seleção ou timeline.
- Desktop `1280x800`, tablet `768x920` e mobile `390x844` vêm da configuração
  compartilhada. O viewport temporário não persiste como geometria do node.
- O framing nativo usa somente o retângulo fixo do device e não mede
  `scrollHeight`. Até a Task 7 adicionar painéis nativos, ele ocupa a região
  livre abaixo da topbar.
- O estado de Edit já existente bloqueia pan do canvas; scroll permanece dentro
  do iframe. Resize/Expand e `CanvasEditorCore` não montam no branch nativo.
- Done, Cancel, falha de abertura, remoção do node, route change e runtime
  unhealthy restauram a geometria e a câmera anteriores. Timers/RAFs tardios
  são cancelados para não reenquadrar depois da saída.
- Falha de runtime fecha automaticamente o estado parcial, mostra somente
  `This website couldn't be opened for editing.` e emite um evento sanitizado
  `uncraft:native-edit-unavailable`.
- O node nativo em repouso usa o screenshot corrente quando disponível e uma
  mensagem simples quando não há thumbnail.
- Nenhum painel da Task 7 foi iniciado.

### Evidência tests-first e exit gate

Os testes novos falharam primeiro pela ausência do resolver, do viewport e dos
helpers de framing. Depois da implementação:

```text
Suíte focal: 11 files, 77 tests passed
Suíte completa: 142 files passed, 1 skipped; 1040 tests passed, 4 skipped
Build com NEXT_PUBLIC_NATIVE_MOTION_CANVAS_EDIT=true:
Next.js 15.5.15; compiled; 41/41 static pages; exit 0
git diff --check: clean
```

O warning não bloqueante já conhecido de `--localstorage-file` permaneceu na
suíte completa.

### Limite operacional ainda não exercitado

O checkout não possui a configuração conjunta do runtime assinado e do bundle
store de desenvolvimento necessária para abrir um snapshot nativo real no
board sem criar dados/credenciais artificiais. O fluxo foi verificado no
boundary de componentes, controller e rotas, e o build foi compilado com a
feature flag ativa; o smoke em browser com um node nativo persistido continua
dependente de um ambiente com `UNCRAFT_RUNTIME_SESSION_SECRET`,
`UNCRAFT_RUNTIME_ORIGIN` e `UNCRAFT_NATIVE_BUNDLE_STORE_ROOT`.

## Task 7 — shell nativo de edição no canvas

### Resultado

O canvas agora monta o chrome de edição aprovado no application layer e o
viewport, os painéis e a timeline consomem uma única instância do controller
compartilhado. O lab isolado continua com o mesmo controller e mantém sua
persistência local própria.

Novos arquivos:

- `packages/web-shell/components/motion-editor/NativeEditSidebar.jsx`
- `packages/web-shell/components/motion-editor/NativeEditSidebar.test.jsx`
- `packages/web-shell/components/motion-editor/NativeMotionInspector.jsx`
- `packages/web-shell/components/motion-editor/NativeMotionInspector.test.jsx`
- `packages/web-shell/components/motion-editor/NativeMotionTimelineDock.jsx`
- `packages/web-shell/components/motion-editor/NativeMotionTimelineDock.test.jsx`
- `packages/web-shell/components/motion-editor/NativeMotionEditChrome.jsx`
- `packages/web-shell/components/motion-editor/NativeMotionEditChrome.test.jsx`
- `packages/web-shell/components/motion-editor/native-motion-canvas.module.css`

Arquivos modificados:

- `packages/web-shell/components/CanvasClient.jsx`
- `packages/web-shell/components/motion-editor/NativeEditViewport.jsx`
- `packages/web-shell/components/motion-editor/NativeMotionEditor.jsx`
- `packages/web-shell/components/motion-editor/native-motion-editor.module.css`
- `packages/web-shell/components/motion-editor/useNativeMotionController.js`
- `packages/web-shell/components/motion-editor/useNativeMotionController.test.jsx`
- `packages/web-shell/app/globals.css`

### Contrato entregue

- `NativeMotionEditSessionProvider` vive no nível do canvas, cria uma única
  sessão de controller e a compartilha por contexto com o viewport e o chrome.
  `NativeEditViewport` mantém um fallback standalone para seus testes e usos
  isolados, mas não cria um segundo controller quando está dentro do canvas.
- A sidebar esquerda oferece `Layers`, `Sections` e `Assets`. Layers/Sections
  selecionam por stable element ID através do bridge; Assets reutiliza o painel
  do lab e ficou navegável por teclado.
- O inspector direito oferece somente `Properties`, `Motion` e `Code`; Assets
  não foi reintroduzido como quarta aba direita.
- A timeline reutiliza `TimelinePanel`, aparece somente quando a seleção ou a
  página expõe motion e fica dockada abaixo da região central, entre os dois
  painéis. O resize vertical do lab não é exposto no dock do canvas para evitar
  que a timeline invada o viewport reservado.
- O topbar contextual conserva Cancel, Done e device controls e agora inclui
  Undo/Redo ligados ao mesmo controller. Nenhuma ação da Task 8 foi simulada.
- Painéis ficam fora do mundo transformado e do iframe. O clone continua
  rolando dentro do viewport; CSS do app não atravessa o sandbox.
- O framing reserva left/right/bottom de forma responsiva: `224/248/200` em
  hosts largos, `176/224/200` abaixo de 900 px e rail esquerdo de 52 px abaixo
  de 720 px. Controles essenciais do topbar permanecem alcançáveis em hosts
  estreitos.
- Tabs, tabpanels, toolbar, timeline region, foco visível e estados vazios têm
  semântica acessível. O chrome nativo só monta para um editor elegível;
  repouso e editores legados continuam no inspector anterior.
- A saída limpa runtime, seleção, timeline e histórico efêmero do controller,
  impedindo estado de um node de aparecer na sessão nativa seguinte.
- Persistência, autosave, commit, restore e discard server-side permanecem
  exclusivamente na Task 8. O lab continua usando `localStorage`; o canvas não
  ganhou fallback de persistência local.

### Evidência tests-first e exit gate

Os três testes de superfície falharam primeiro porque sidebar, inspector e
timeline dock ainda não existiam. Depois da implementação:

```text
Suíte focal: 11 files, 70 tests passed
Suíte completa: 146 files passed, 1 skipped; 1048 tests passed, 4 skipped
Build com NEXT_PUBLIC_NATIVE_MOTION_CANVAS_EDIT=true:
Next.js 15.5.15; compiled; 41/41 static pages; exit 0
git diff --check: clean
```

O warning não bloqueante já conhecido de `--localstorage-file` permaneceu na
suíte completa.

### Verificação visual e limite operacional

- `/motion-editor` foi aberto com o bundle real `Clone/dist`: rota e assets
  retornaram HTTP 200, o runtime conectou, os painéis/timeline renderizaram com
  a hierarquia esperada e não houve erro ou warning no console do browser.
- O smoke do shell dentro de `/canvas` não pôde alcançar um board neste
  ambiente porque o banco apontado por `.env.local` ainda não possui a coluna
  `native_bundle_id` criada pela migration da Task 2. O erro foi observado antes
  de qualquer interação do shell. A migration não foi aplicada automaticamente
  e nenhum dado externo foi alterado.
- Mesmo após a migration, o smoke completo de um node nativo persistido continua
  exigindo a configuração conjunta já registrada na Task 6:
  `UNCRAFT_RUNTIME_SESSION_SECRET`, `UNCRAFT_RUNTIME_ORIGIN` e
  `UNCRAFT_NATIVE_BUNDLE_STORE_ROOT`.

### Rollback da Task 7

Remover o provider/chrome nativo do `CanvasClient`, devolver ao viewport seu
controller standalone, restaurar reservas nativas a zero e remover os quatro
componentes de shell e seus estilos. Não há migration, bundle, manifest ou
sessão durável da Task 7 para reverter.

## Task 8 — autosave, commit, restore, discard e histórico de sessão

### Resultado

O controller compartilhado agora usa um adapter server-backed no canvas. Cada
transação reconhecida atualiza o draft local imediatamente, agenda autosave do
manifest e só altera Undo/Redo e persistência depois do acknowledgement do
runtime. O lab isolado mantém seu adapter local e não ganhou dependência do
backend do canvas.

Novos arquivos:

- `packages/web-shell/lib/motion-editor/native-edit-api.js`
- `packages/web-shell/lib/motion-editor/native-edit-api.test.js`
- `packages/web-shell/app/api/nodes/[id]/motion-session/route.js`
- `packages/web-shell/app/api/nodes/[id]/motion-session/route.test.js`
- `packages/web-shell/app/api/nodes/[id]/motion-session/commit/route.js`
- `packages/web-shell/app/api/nodes/[id]/motion-session/commit/route.test.js`
- `packages/web-shell/app/api/nodes/[id]/motion-session/discard/route.js`
- `packages/web-shell/app/api/nodes/[id]/motion-session/discard/route.test.js`

Arquivos modificados:

- `packages/web-shell/components/motion-editor/useNativeMotionController.js`
- `packages/web-shell/components/motion-editor/useNativeMotionController.test.jsx`
- `packages/web-shell/components/motion-editor/NativeMotionEditChrome.jsx`
- `packages/web-shell/components/motion-editor/NativeMotionEditChrome.test.jsx`
- `packages/web-shell/components/CanvasClient.jsx`
- `packages/web-shell/components/CanvasNode.jsx`
- `packages/web-shell/lib/canvas-api.js`
- `packages/web-shell/lib/motion-editor/edit-session-store.js`
- `packages/web-shell/lib/motion-editor/edit-session-store.test.js`
- `packages/web-shell/lib/motion-editor/session-history.js`
- `packages/web-shell/lib/motion-editor/session-history.test.js`
- `packages/web-shell/app/api/nodes/[id]/restore-version/route.js`
- `packages/web-shell/app/api/nodes/[id]/restore-version/route.test.js`

### Contrato entregue

- Abrir Edit cria ou retoma o único draft owned do snapshot nativo corrente; o
  controller recarrega e reaplica o histórico confirmado depois de um reload.
- O autosave usa debounce curto de 180 ms, uma única escrita em voo, revisão
  otimista monotônica e coalescing para que respostas antigas nunca substituam
  um manifest mais novo.
- Falhas transitórias mantêm o draft local e repetem automaticamente com
  backoff limitado entre 500 ms e 8 s. Conflitos semânticos não entram em retry
  cego nem fazem merge silencioso.
- Somente transações reconhecidas entram no manifest. Gestos contínuos continuam
  sendo uma transação; refresh de inventário/runtime não cria histórico nem
  autosave.
- Undo e Redo mudam o draft somente depois do acknowledgement. Rejeição conserva
  cursor e histórico anteriores e emite somente um evento diagnóstico
  sanitizado. Repairs automáticos persistidos acompanham a transação causadora
  no replay, Undo e Redo.
- Preview, `visibilitychange`, `pagehide` e commit forçam flush do draft
  confirmado. O adapter conserva revisões locais ainda não confirmadas.
- Done faz flush, cria snapshot imutável, avança o ponteiro do node, fecha a
  sessão e só então sai de Edit. Cancel descarta a sessão sem persistir o draft
  local pendente e restaura o node ao snapshot-base já corrente.
- `save-version` e `before-structural-operation` criam snapshot imutável e
  reancoram a mesma sessão ativa no novo base, com revisão avançada. Apenas
  `exit` fecha Edit e encerra o histórico efêmero.
- O canvas atualiza bundle ID, versão do manifest e snapshot corrente no estado
  local depois do commit. `save-edit` continua exclusivo do editor legado.
- Restore retorna bundle e manifest do snapshot escolhido, invalida qualquer
  sessão ativa anterior e nunca usa HTML capturado como fonte do snapshot
  nativo.
- Fechar ou descartar a sessão revoga na prática a URL runtime: o gateway já
  exige `status = 'active'` para cada request e o token curto deixa de servir o
  bundle imediatamente.

### Evidência tests-first e exit gate

Os quatro novos arquivos de teste falharam primeiro pela ausência do adapter e
das três rotas. Depois da implementação:

```text
Suíte focal: 10 files, 52 tests passed
Suíte completa: 150 files passed, 1 skipped; 1072 tests passed, 4 skipped
Build com NEXT_PUBLIC_NATIVE_MOTION_CANVAS_EDIT=true:
Next.js 15.5.15; compiled; 41/41 static pages; exit 0
git diff --check: clean
```

O warning não bloqueante já conhecido de `--localstorage-file` permaneceu na
suíte completa. Não houve warning novo de build.

### Verificação PostgreSQL real

Em um PostgreSQL 16 descartável com o schema da branch:

- `Save version` criou um snapshot `native-edit`, avançou o node, conservou a
  mesma sessão ativa, reancorou `base_snapshot_id` e avançou a revisão de 0
  para 1;
- o autosave seguinte foi aceito somente na revisão 1 e avançou para 2;
- Done criou um segundo snapshot `native-edit`, avançou o node e fechou a
  sessão como `committed` em uma única instrução CTE;
- a cadeia terminou com três snapshots, dois manifests nativos editados e o
  ponteiro exatamente no snapshot do Done;
- restore de uma versão anterior descartou uma sessão ativa em aberto, revogou
  seu runtime e moveu o node ao snapshot escolhido.

O container e todos os dados descartáveis foram removidos após a verificação.

### Limite operacional ainda não exercitado

O smoke completo dentro de `/canvas` continua bloqueado pela configuração local
já registrada na Task 7: o banco de `.env.local` não possui a migration nativa
e o checkout não reúne `UNCRAFT_RUNTIME_SESSION_SECRET`,
`UNCRAFT_RUNTIME_ORIGIN` e `UNCRAFT_NATIVE_BUNDLE_STORE_ROOT` para um node real.
Nenhuma migration foi aplicada automaticamente e nenhum dado externo foi
alterado. Controller, rotas, build, gateway de revogação e transações PostgreSQL
foram verificados separadamente; o fluxo visual real permanece o primeiro smoke
quando esse ambiente dedicado existir.

### Rollback da Task 8

Desativar `NEXT_PUBLIC_NATIVE_MOTION_CANVAS_EDIT`, remover o adapter e as três
rotas de motion session, devolver Done/Cancel ao lifecycle anterior e reverter
somente o commit contínuo e os campos nativos extras de restore. Snapshots já
commitados e seus bundles/manifests permanecem válidos e não devem ser apagados;
sessões ativas devem ser expiradas ou descartadas antes da remoção das rotas.

## Task 9 — estado híbrido de freeze, settlement, loop e Preview

### Resultado

O runtime agora conserva a página viva durante navegação e congela somente os
writers que afetam a seleção quando o elemento está significativamente visível.
Sequências finitas assentam no final; loops preservam o frame corrente. Preview
libera o estado de playback original e volta exatamente ao contexto congelado.

Novos arquivos:

- `packages/web-shell/lib/motion-editor/edit-state-machine.js`
- `packages/web-shell/lib/motion-editor/edit-state-machine.test.js`
- `packages/web-shell/lib/motion-editor/visibility.js`
- `packages/web-shell/lib/motion-editor/visibility.test.js`
- `packages/web-shell/lib/motion-editor/settlement.js`
- `packages/web-shell/lib/motion-editor/settlement.test.js`

Arquivos modificados:

- `packages/web-shell/lib/motion-editor/runtime-bridge-source.js`
- `packages/web-shell/lib/motion-editor/runtime-bridge-source.test.js`
- `packages/web-shell/components/motion-editor/useNativeMotionController.js`
- `packages/web-shell/components/motion-editor/useNativeMotionController.test.jsx`
- `packages/web-shell/components/motion-editor/NativeMotionEditor.jsx`
- `packages/web-shell/components/motion-editor/NativeMotionEditChrome.jsx`
- `packages/web-shell/components/motion-editor/NativeMotionEditChrome.test.jsx`
- `packages/web-shell/components/motion-editor/NativeMotionInspector.jsx`
- `packages/web-shell/components/motion-editor/NativeMotionInspector.test.jsx`
- `packages/web-shell/components/motion-editor/NativeMotionTimelineDock.jsx`
- `packages/web-shell/components/motion-editor/NativeMotionTimelineDock.test.jsx`
- `packages/web-shell/components/motion-editor/NativeEditViewport.jsx`
- `packages/web-shell/components/motion-editor/native-motion-canvas.module.css`
- `packages/web-shell/app/globals.css`

### Contrato entregue

- A máquina de estados representa explicitamente `navigating`,
  `selection-pending`, `settling`, `editing-frozen`, `scrubbing`, `previewing`,
  `recovering` e `unavailable`. Acknowledgements antigos de outra seleção ou
  operação não substituem o estado corrente.
- A visibilidade significativa é centralizada em `visibility.js`: pelo menos
  25% da área ou um bloco visível de 32 × 32 px. Uma fresta de 1–2 px nunca
  inicia settlement nem movimenta a câmera.
- Cada settlement captura tempo/progresso, playback rate, paused/reversed,
  time scale, posição de scroll e estado do ScrollTrigger antes de tocar no
  writer. A saída, a troca de seleção, o scroll e Preview restauram esse estado.
- CSS Animations, WAAPI, GSAP e ScrollTrigger usam os writers já inventariados
  pelo bridge. Sequências finitas são ordenadas pelo final efetivo e assentadas
  com callbacks suprimidos quando a API suporta isso. Loops pausam no progresso
  normalizado já visível, sem salto inventado.
- Writers alheios continuam rodando. Um GSAP compartilhado só é congelado se
  todos os seus targets pertencem à seleção; grupos que alcançam siblings são
  recusados de forma segura como `shared-writer`.
- Settlement duplicado é idempotente. A operação tem limite síncrono de 800 ms,
  uma tentativa automática de recovery e degrada somente a seleção afetada.
- Durante scroll o writer selecionado volta ao estado vivo, o runtime entra em
  `navigating` e reavalia o freeze 120 ms depois de o scroll assentar. O draft e
  as alterações confirmadas do manifest não são tocados.
- Scrub é um comando transitório: começa em `scrubbing`, atualiza o frame sem
  patch e congela o ponto escolhido ao soltar. Play, pause e Preview continuam
  fora do histórico durável.
- Preview restaura playback e scroll, remove seleção e chrome de edição e deixa
  somente `Back to Edit`. Ao voltar, a seleção e seu frame congelado reaparecem.
- `Loop` aparece somente no header de Motion da seleção e ao lado da row da
  timeline; nenhum badge foi colocado sobre o elemento no canvas.
- O viewport expõe o estado atual para diagnóstico acessível. Reset/teardown
  envia `release-edit-state`, remove observers/timers e libera todos os freezes.
- Nenhum ownership analysis, retargeting, decomposição de transform ou UI de
  ambiguidade da Task 10 foi iniciado.

### Evidência tests-first e exit gate

Os helpers puros e os cenários de runtime falharam primeiro pela ausência da
máquina de estados, do critério geométrico e do settlement. Depois da integração:

```text
Suíte focal: 10 files, 122 tests passed
Suíte completa: 153 files passed, 1 skipped; 1101 tests passed, 4 skipped
Build com NEXT_PUBLIC_NATIVE_MOTION_CANVAS_EDIT=true:
Next.js 15.5.15; compiled; 41/41 static pages; exit 0
git diff --check: clean
```

As fixtures novas cobrem sequência finita, loop no frame corrente, browser
animations CSS/WAAPI, GSAP, ScrollTrigger, writers mistos, troca de seleção,
scroll + reassentamento, Preview reversível, scrub sem patch, seleção duplicada
e fresta de 1 px. A suíte anterior conserva cobertura de split text, nested
motion, grupos e inventário de múltiplos engines.

### Verificação visual e limite operacional

- `/motion-editor` abriu o bundle real `Clone/dist`; rota e assets responderam
  HTTP 200 e o runtime conectou.
- Selecionar `CropTab™` produziu exatamente uma seleção e
  `data-uncraft-edit-state="editing-frozen"`.
- Preview mudou o runtime para `previewing` e removeu a seleção. Voltar a Edit
  restaurou a mesma seleção em `editing-frozen`.
- O layout, outline, inspector Motion e timeline permaneceram estáveis. Não
  houve erro no console. O único warning foi o `force3D` já conhecido do bundle,
  fora do controller.
- O smoke do chrome da Task 9 dentro de `/canvas` permanece dependente do mesmo
  ambiente nativo dedicado registrado nas Tasks 7–8: migration nativa aplicada,
  runtime assinado e bundle store configurado. Nenhuma migration ou dado externo
  foi alterado nesta tarefa; Preview/Loop do shell estão cobertos por testes de
  componente e pelo build com a flag ativa.

### Rollback da Task 9

Remover os três helpers puros, retirar o settlement/Preview transitório do
bridge e do controller e restaurar o chrome anterior sem `Loop`/`Back to Edit`.
Não há migration, bundle, snapshot ou manifest persistido novo para reverter;
as sessões e versões duráveis das Tasks 1–8 permanecem válidas.

## Task 10 — ownership, retarget do alvo final e transforms semânticos

### Resultado

Properties agora altera o alvo final do writer que realmente controla o valor,
sem criar keyframe invisível nem sobrescrever timing, easing, playback, loops ou
estrutura da timeline. Ambiguidades genuínas ficam no tab Motion e exigem uma
escolha explícita com nomes como `Entrance`, `Hover`, `Scroll` e `Loop`.

Novos arquivos:

- `packages/web-shell/lib/motion-editor/motion-ownership.js`
- `packages/web-shell/lib/motion-editor/motion-ownership.test.js`
- `packages/web-shell/lib/motion-editor/retarget-patch.js`
- `packages/web-shell/lib/motion-editor/retarget-patch.test.js`
- `packages/web-shell/lib/motion-editor/transform-components.js`
- `packages/web-shell/lib/motion-editor/transform-components.test.js`
- `packages/web-shell/components/motion-editor/MotionOwnershipChoice.jsx`
- `packages/web-shell/components/motion-editor/MotionOwnershipChoice.test.jsx`

Integração modificada:

- `packages/web-shell/lib/motion-editor/motion-ir.js`
- `packages/web-shell/lib/motion-editor/motion-ir.test.js`
- `packages/web-shell/lib/motion-editor/runtime-bridge-source.js`
- `packages/web-shell/lib/motion-editor/runtime-bridge-source.test.js`
- `packages/web-shell/components/motion-editor/useNativeMotionController.js`
- `packages/web-shell/components/motion-editor/useNativeMotionController.test.jsx`
- `packages/web-shell/components/motion-editor/NativeMotionEditor.jsx`
- `packages/web-shell/components/motion-editor/NativeMotionInspector.jsx`
- `packages/web-shell/components/motion-editor/NativeMotionInspector.test.jsx`
- os dois CSS modules do editor nativo.

### Contrato entregue

- O bridge enumera writers CSS/WAAPI/GSAP por propriedade, target, comportamento,
  ordem de execução, sequência, write model e quantidade de targets afetados.
- Um único writer seguro é resolvido automaticamente. Em sequências reais, o
  último child que determina o estado de repouso recebe o retarget; containers
  que apenas agendam não viram owners.
- Writers de descendants não são confundidos com a propriedade do host row.
  Isso evita que uma edição no heading retargete por acidente um caractere de
  split text.
- Dois writers independentes produzem `ambiguous`. Properties conserva o valor
  calculado, mostra o indicador de múltiplos controllers e abre Motion somente
  com os contributors relevantes.
- A escolha do contributor e o retarget são uma única transação v2. O hint fica
  no manifest, é revalidado contra os channels atuais e participa de undo/redo,
  restore e rollback atômico.
- `retarget.final` altera o último keyframe/target já existente. Nenhum scrub ou
  playhead intermediário cria keyframe; timing, easing, paths, tracks, repeats,
  yoyo e estrutura continuam sob ações explícitas de Motion.
- Loops CSS/WAAPI deslocam a base em torno do frame congelado. Loops GSAP
  preservam a excursão relativa; valores `+=`/`-=` mantêm a expressão e valores
  calculados por função recebem um wrapper de offset sem perder a função
  original.
- Grupos/staggers com escopo de target não comprovado permanecem visíveis, mas
  recusam o retarget padrão em vez de aplicar uma alteração ampla silenciosa.
- Translate X/Y, scale X/Y, rotate, skew X/Y e transform-origin X/Y são campos
  independentes. Transform 2D preserva componentes e ordem autoral; matrix 2D é
  decomposta e recomposta. Matrix 3D e transforms procedurais aparecem como
  controle específico necessário ou `Code only`, nunca como posição inventada.
- A ladder de editabilidade agora distingue `direct`, `known`, `declarative`,
  `custom` e `code`, mantendo `adapter` apenas como alias de migração.

### Evidência tests-first e exit gate

Os quatro primeiros arquivos de teste falharam pela ausência dos módulos de
ownership, retarget, transform e escolha. Depois da integração:

```text
Suíte focal: 8 files, 101 tests passed
Suíte completa: 157 files passed, 1 skipped; 1133 tests passed, 4 skipped
Build com NEXT_PUBLIC_NATIVE_MOTION_CANVAS_EDIT=true:
Next.js 15.5.15; compiled; 41/41 static pages; exit 0
git diff --check: clean
```

As fixtures cobrem owner único, último writer sequencial, parent scheduler,
propriedade sem motion, descendants, ambiguity + hint, transform 2D/matrix,
transform complexo, retarget browser, loop no frame visível, GSAP relativo,
GSAP function-valued e commit/rollback v2 de hint + alvo final.

### Verificação visual

- `/motion-editor` abriu o `Clone/dist` real; runtime e assets responderam HTTP
  200 e `CropTab™` foi selecionado em estado congelado.
- O inspector exibiu os nove controles semânticos de transform com a hierarquia
  esperada e sem quebrar Layout, Appearance ou Typography.
- Alterar X para `40px` produziu `translateX(40px)` no elemento real. Undo
  restaurou exatamente `transform: none` e removeu o inline style.
- Não houve erro no console. O warning `force3D` do bundle, já documentado antes
  desta Task, permaneceu fora do controller.
- O smoke completo dentro de `/canvas` ainda depende do ambiente nativo dedicado
  registrado nas Tasks 7–9; nenhuma migration ou configuração externa foi
  alterada nesta Task.

### Rollback da Task 10

Remover os três módulos puros e a escolha de ownership, retirar
`ownership.hint`/`retarget.final` do bridge e devolver Properties ao write direto
anterior. Não há migration nova. Manifests que já contenham patches v2 devem ser
preservados e migrados ou rejeitados explicitamente antes de retirar o reader.

## Task 11 — scopes responsivos shared, per-device e computed

### Resultado

Cada campo editável de Properties agora resolve e revela seu alcance responsivo
sem criar outro modo de edição. Valores compartilhados, overrides esparsos por
dispositivo e valores calculados pelo runtime convivem no mesmo manifest da
sessão e no mesmo histórico transacional.

Novos arquivos:

- `packages/web-shell/lib/motion-editor/responsive-manifest.js`
- `packages/web-shell/lib/motion-editor/responsive-manifest.test.js`
- `packages/web-shell/components/motion-editor/PropertyScopeButton.jsx`
- `packages/web-shell/components/motion-editor/PropertyScopeButton.test.jsx`
- `packages/web-shell/components/motion-editor/MotionDeviceScopeDialog.jsx`
- `packages/web-shell/components/motion-editor/MotionDeviceScopeDialog.test.jsx`

Integração modificada:

- `packages/web-shell/lib/motion-editor/manifest.js`
- `packages/web-shell/lib/motion-editor/native-edit-api.js`
- `packages/web-shell/components/motion-editor/useNativeMotionController.js`
- `packages/web-shell/components/motion-editor/NativeMotionEditor.jsx`
- `packages/web-shell/components/motion-editor/NativeMotionInspector.jsx`
- `packages/web-shell/components/motion-editor/NativeMotionEditChrome.jsx`
- os dois CSS modules do editor nativo e os testes focais correspondentes.

### Contrato entregue

- O responsive manifest v1 conserva um valor base compartilhado e somente os
  overrides explícitos de desktop, tablet ou mobile. Binding, proveniência e
  relevância por dispositivo são validados e persistidos com a sessão.
- Cada selector de Properties resolve `shared`, `per-device` ou `computed` para
  o dispositivo ativo. Campos declarados para outro viewport não aparecem no
  inspector corrente.
- Shared usa corrente conectada e o tooltip exato `Applied to all devices`.
  Nenhuma tag redundante `All devices` foi adicionada.
- Clicar na corrente conectada abre um dialog modal centralizado no application
  layer. A cópia é exatamente `This will set this value to desktop-only.`,
  `Cancel` e `Set Desktop-Only`, substituindo somente o nome em tablet/mobile.
- O dialog prende foco, trata Escape como Cancel e devolve o foco ao botão que o
  abriu. Cancel não cria patch nem altera escopo.
- Confirmar cria somente o override do dispositivo ativo com o valor visível e
  força o flush imediato do autosave.
- A corrente desconectada reconecta sem modal, promove o valor visível a shared
  e remove todas as variações daquela propriedade.
- Computed comunica que o valor é calculado pelo website e não oferece uma ação
  de escopo inválida.
- Mudanças de escopo são transações normais `source: responsive`; undo, redo,
  save, reload e restore recompõem tanto o manifest quanto o valor efetivo.
- Patches duráveis recebem metadata responsiva. Ao trocar viewport, apenas os
  patches aplicáveis ao dispositivo corrente são reexecutados e o valor efetivo
  final é reconciliado a partir do manifest.
- A troca de dispositivo não altera escopo nem cria versão. Ela reinicia a
  medição de settlement, reinspeciona o viewport e reassenta a seleção de forma
  independente.
- O parser v2 do patch manifest aceita o patch host-only `responsive` e metadata
  responsiva estrita sem afrouxar a rejeição dos demais kinds desconhecidos.

### Evidência tests-first e exit gate

As seis suítes novas falharam primeiro pela ausência do manifest, dos dois
componentes e das integrações no controller/API. Depois da implementação:

```text
Suíte focal inicial: 8 files, 57 tests passed
Suíte focal expandida: 15 files, 188 tests passed
Suíte completa: 160 files passed, 1 skipped; 1153 tests passed, 4 skipped
Build com NEXT_PUBLIC_NATIVE_MOTION_CANVAS_EDIT=true:
Next.js 15.5.15; compiled; 41/41 static pages; exit 0
git diff --check: clean
```

O aviso não bloqueante já conhecido de `--localstorage-file` permaneceu na
suíte completa.

### Verificação visual e limite operacional

- `/motion-editor` abriu o `Clone/dist` real, conectou o runtime e permitiu
  selecionar `We found a better way` sem regressão visual no inspector.
- A troca para tablet ativou corretamente o viewport canônico `768 × 920`; o
  runtime permaneceu conectado e a seleção foi reassentada.
- O único warning observado foi o `force3D` já conhecido do bundle, fora do
  controller.
- O lab isolado intencionalmente não injeta descriptors responsivos; os ícones e
  o dialog vivem no shell nativo integrado ao canvas e estão cobertos pelos
  testes de componente/controller.
- O smoke visual desse shell dentro de `/canvas` continua bloqueado pelo ambiente
  local: o banco configurado não possui a coluna `native_bundle_id`. Nenhuma
  migration, credencial ou dado externo foi alterado nesta Task.

### Rollback da Task 11

Preservar manifests já persistidos antes de retirar o reader responsivo. Depois,
remover os dois componentes de escopo, o responsive manifest, a metadata dos
patches e a reconciliação por device do controller. Não há migration nova; os
bundles, snapshots e edit sessions das Tasks anteriores permanecem válidos.

## Estado e rollback da fatia

- Tasks 1–11 estão concluídas; Task 12 não foi iniciada.
- A primeira fatia recomendada do PR (`Bundle contract and persistence schema`,
  Tasks 1–2) permanece íntegra. Tasks 3–4 completam a segunda fatia sem iniciar
  integração com o canvas.
- Task 5 fecha a terceira fatia recomendada (`Shared controller extraction`).
- Tasks 6–7 completam a quarta fatia (`Canvas M1 vertical slice`): o lab e o
  canvas consomem o mesmo controller, o shell nativo vive no application layer
  e `CanvasEditorCore` permanece exclusivo do branch legado.
- Task 8 fecha a quarta fatia (`Canvas M1 vertical slice`) no código e nos
  boundaries automatizados: autosave, histórico, commit, discard e restore
  estão integrados. O smoke visual real ainda depende do ambiente nativo
  dedicado descrito acima.
- Task 9 fecha a estabilidade híbrida de edição: a seleção assenta de forma
  scoped, loops preservam o frame corrente e Preview é reversível sem congelar
  motion alheio ou criar histórico persistente.
- Task 10 fecha o núcleo de correção semântica de Properties: o alvo final
  existente é retargetado, ambiguity não é adivinhada e transforms 2D continuam
  editáveis sem destruir os componentes vizinhos.
- Task 11 fecha o alcance responsivo de Properties: cada campo revela seu scope,
  overrides são esparsos e por dispositivo, reconectar promove o valor visível a
  shared e settlement é refeito para o viewport ativo.
- Nenhum arquivo do worktree Demarcelizer ou material não relacionado foi
  alterado.
- Rollback da Task 2 é manual e não destrutivo: parar tráfego nativo, preservar
  bundles/manifests referenciados, remover o índice de sessão ativa, a tabela de
  sessões e somente então constraints/colunas. `native_bundles` nunca deve ser
  removida enquanto um snapshot a referenciar.
- Rollback da Task 3: interromper emissão de URLs runtime, remover as duas rotas
  novas e o módulo de token, restaurar o gateway do lab e os headers globais, e
  então remover as duas variáveis runtime. Bundles, snapshots e edit sessions
  persistidos não precisam ser removidos.
- Rollback da Task 4: manter o gateway assinado e voltar o motion lab ao envelope
  v1, remover os comandos/ledger transacionais e o bootstrap extra de contexto.
  Bundles, snapshots e edit sessions persistidos permanecem válidos porque a
  Task 4 não alterou schema nem manifests duráveis.
- Rollback da Task 5: restaurar o controller embutido no lab, remover o hook e os
  módulos de session history/devices e devolver as dimensões antigas. Não há
  migration, bundle ou snapshot persistido para reverter.
- Rollback da Task 6: deixar `NEXT_PUBLIC_NATIVE_MOTION_CANVAS_EDIT=false`,
  remover o resolver/viewport e as aliases nativas das queries, e restaurar o
  framing único anterior. Bundles, snapshots, manifests e sessões existentes
  permanecem intactos.
- Rollback da Task 7: remover provider/chrome nativo, devolver ao viewport seu
  controller standalone e zerar as reservas de framing. Não há estado durável
  novo para reverter.
- Rollback da Task 8: manter bundles e snapshots já commitados, expirar drafts
  ativos, remover o adapter/rotas e restaurar o lifecycle anterior do canvas.
- Rollback da Task 9: remover a máquina híbrida e seus comandos transitórios;
  nenhum estado durável precisa ser migrado ou apagado.
- Rollback da Task 10: preservar manifests v2 existentes, remover ownership e
  retarget somente depois de existir uma política explícita de compatibilidade.
- Rollback da Task 11: preservar ou migrar responsive manifests persistidos antes
  de remover o reader e os controles de alcance por dispositivo.

## Próxima fatia

Parar no checkpoint antes da implementação central da Task 12. A decisão de
modelo, billing, privacidade, timeout, geração automática e acesso pago já foi
resolvida. O pacote completo e autoritativo para iniciar a próxima sessão está em
`docs/superpowers/handoffs/2026-07-26-task-12-full-custom-controls-handoff.md`.
