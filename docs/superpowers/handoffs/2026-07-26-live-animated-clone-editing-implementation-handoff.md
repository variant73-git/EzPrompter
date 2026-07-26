# Handoff — Live Animated Clone Editing

**Data:** 2026-07-26
**Status:** Task 1 concluída e verificada; Task 2 não iniciada
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

## Estado e rollback da fatia

- Task 1 está concluída; Task 2 não foi iniciada.
- Esta é a primeira fatia do PR 1 do plano (`Bundle contract and persistence
  schema`, Tasks 1–2); o PR ainda não está completo.
- Nenhum arquivo do worktree Demarcelizer ou material não relacionado foi
  alterado.
- Rollback da fatia: remover os três módulos/testes de `lib/native-clone`, a
  nova route test e reverter somente as integrações/dependência/configuração
  listadas acima. O caminho Iter9 não requer migração reversa.

## Próxima fatia

Executar somente a Task 2, tests-first: schema de persistência/admissão,
migration e round-trip DB/API do descriptor. Revalidar ownership dos arquivos
antes de qualquer edição e não avançar ao próximo checkpoint do plano.
