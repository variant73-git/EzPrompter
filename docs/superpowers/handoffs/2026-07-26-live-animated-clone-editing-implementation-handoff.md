# Handoff — Live Animated Clone Editing

**Data:** 2026-07-26
**Status:** Tasks 1–2 concluídas e verificadas; Task 3 não iniciada
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

## Estado e rollback da fatia

- Tasks 1 e 2 estão concluídas; Task 3 não foi iniciada.
- A primeira fatia recomendada do PR (`Bundle contract and persistence schema`,
  Tasks 1–2) está completa e ainda não inclui UI/runtime routing.
- Nenhum arquivo do worktree Demarcelizer ou material não relacionado foi
  alterado.
- Rollback da Task 2 é manual e não destrutivo: parar tráfego nativo, preservar
  bundles/manifests referenciados, remover o índice de sessão ativa, a tabela de
  sessões e somente então constraints/colunas. `native_bundles` nunca deve ser
  removida enquanto um snapshot a referenciar.

## Próxima fatia

Parar no checkpoint antes da Task 3. A próxima fatia substitui o path local de
desenvolvimento por gateway runtime assinado e node-scoped. Revalidar ownership,
token/segredo e isolamento do runtime antes de qualquer edição; não iniciar UI.
