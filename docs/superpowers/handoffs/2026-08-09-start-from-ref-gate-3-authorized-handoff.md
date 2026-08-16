# Handoff — Start from a Ref: Gate 2 concluído, Gate 3A autorizado (2026-08-09)

## Comece aqui

- Worktree: `/Users/adilsonporto/Desktop/IA/Uncraft-start-from-ref`
- Branch: `codex/start-from-ref`
- HEAD observado: `60dd8ffb docs(refs): hand off private curation next steps`
- Estado: intencionalmente sujo, local e ainda não commitado.
- Handoff predecessor:
  `docs/superpowers/handoffs/2026-08-09-start-from-ref-non-curation-sequence-handoff.md`
- Evidência autoritativa do Gate 2:
  `docs/superpowers/evidence/2026-08-09-start-from-ref-gate-2-isolated.md`
- Página local: `http://localhost:3035/canvas/library/references`
- Na criação deste handoff, a porta 3035 continuava servida por `node` PID
  67653 a partir de
  `/Users/adilsonporto/Desktop/IA/Uncraft-start-from-ref/packages/web-shell`;
  a rota respondeu HTTP 307 para autenticação e manteve `<title>Uncraft</title>`.
  Confirme novamente o owner antes de iniciar, reiniciar ou encerrar processos.

Leia este arquivo por completo antes de consultar o banco compartilhado. Este
handoff autoriza somente o Gate 3A read-only descrito abaixo; não autoriza o
Gate 3B, writes compartilhados ou gates posteriores.

## Autorização recebida e interpretação vinculante

Mensagem de Adilson nesta sessão:

> gere um handoff para a próxima sessão com o gate 3 autorizado.

O contrato já aprovado divide o Gate 3 em duas autorizações sequenciais:

- **Gate 3A:** preflight read-only do banco compartilhado;
- **Gate 3B:** aplicação da migration, com autorização distinta, explícita e
  posterior à apresentação e aceitação do relatório do Gate 3A.

Portanto:

- o **Gate 3A está autorizado** para a próxima sessão;
- o **Gate 3B ainda não está autorizado**;
- a próxima sessão deve parar depois do relatório do Gate 3A e solicitar a
  decisão de Adilson;
- a formulação “Gate 3 autorizado” não antecipa a aprovação do 3B, porque o
  checkpoint read-only ainda não foi produzido nem aceito.

## Limites permanentes

- O único e-mail autorizado para curadoria é `variant73@gmail.com`.
- A conta GitHub correta é sempre `variant73-git`.
- O projeto Vercel é `uncraft`, no time `variant73-gits-projects`, com produção
  em `https://uncraft.vercel.app`.
- Antes de qualquer deploy, confirmar Root Directory `packages/web-shell`.
- Não usar `git add -A`.
- Preservar todo o worktree sujo, arquivos não relacionados e evidências.
- Não imprimir URLs de conexão, usuários, senhas, tokens, hosts completos ou
  outros segredos.
- Não criar plano compartilhado, nem mesmo para testar constraint.
- Não capturar URL pública, chamar modelo, gerar, gastar créditos ou criar
  board/node.
- Não commitar, fazer push/merge, alterar Vercel ou publicar.

## Gate 2 — concluído

Foi implementado um runner fail-closed que:

1. carrega os alvos compartilhado e isolado apenas para comparação local;
2. normaliza host pooled/unpooled, porta, database e user;
3. falha antes da primeira conexão se os destinos coincidirem;
4. conecta somente ao alvo E2E;
5. cria um database `uncraft_gate2_*` único;
6. executa rotas, auth, Planner, analyzer, store e SQL reais com fixtures de
   captura desktop/mobile;
7. remove o database descartável em `finally`;
8. confirma sua ausência depois da limpeza.

Arquivos adicionados pelo Gate 2:

- `packages/web-shell/scripts/start-from-ref/prove-gate-2-isolated.mjs`
- `packages/web-shell/tests/start-from-ref/gate-2-isolated.integration.test.js`
- `docs/superpowers/evidence/2026-08-09-start-from-ref-gate-2-isolated.md`

Arquivo modificado pelo Gate 2:

- `packages/web-shell/package.json` — script
  `refs:gate2:prove:isolated`.

Aceitação final:

- integração isolada: 1 arquivo, 8 testes aprovados;
- suíte focada: 9 arquivos, 30 testes aprovados;
- suíte completa: 154 arquivos aprovados, 2 ignorados; 1.028 testes
  aprovados, 12 ignorados;
- build de produção: aprovado, 44 páginas;
- `git diff --check`: aprovado;
- databases `uncraft_gate2_%` restantes: 0;
- schemas `uncraft_gate2_%` restantes: 0;
- preview local: preservada na porta 3035;
- banco compartilhado, captura pública, geração, billing, créditos,
  board/node, Git e Vercel: não tocados.

Dois ensaios iniciais de isolamento por `search_path` falharam antes de inserir
fixtures porque Neon HTTP manteve `current_schema() = public`. Ambos os schemas
temporários foram removidos. O runner final usa um database descartável real e
passou repetidamente.

## Contrato de produto que continua autoritativo

- `Maybe` é indeciso/default e não entra no Planner.
- Apenas `Keep` entra como candidato curado; `Pass` e `Maybe` ficam fora.
- O ranking usa apenas `typeFit`/site type.
- `curationWeight`, taste, style, motion, strength e papéis fixos não escolhem
  nem desempatem opções.
- `Worth borrowing` e `Avoid` são guidance pós-seleção.
- Até três opções empatadas podem ser apresentadas por página, em ordem
  alfabética neutra; isso não é recomendação.
- A escolha humana persiste exatamente um chassis.
- Direct URL independe de curadoria.
- O alvo é autoridade de marca, copy, tipografia, cor, mídia e verdade factual.
- O chassis é autoridade da espinha estrutural, papéis de mídia, composição
  responsiva e motion portátil.
- Nunca inventar depoimentos, preços, métricas, clientes ou prova comercial.
- `transplantChassis()` continua desconectado de rota, billing e UI.

## Gate 3A — autorizado para a próxima sessão

Objetivo: produzir um preflight estritamente read-only do estado compartilhado
antes da migration de cardinalidade 1–3.

### Preflight local obrigatório antes da conexão

1. Confirmar branch, HEAD, `git status`, `git diff --check` e owner da porta
   3035.
2. Ler este handoff e a evidência do Gate 2 por completo.
3. Confirmar que
   `packages/web-shell/migrations/2026-08-07-single-chassis-plan.sql` contém
   apenas:
   - drop da constraint
     `generation_reference_uses_selected_reference_ids_check`;
   - recriação da mesma constraint com
     `cardinality(selected_reference_ids) BETWEEN 1 AND 3`.
4. Calcular e registrar o SHA-256 do arquivo da migration.
5. Carregar o ambiente de
   `/Users/adilsonporto/Desktop/IA/Uncraft/packages/web-shell` por
   `REFERENCE_ENV_DIR`, sem exibir valores.
6. Comparar novamente, offline, os fingerprints normalizados de
   `DATABASE_URL` e `E2E_ISOLATED_DATABASE_URL` e confirmar que são distintos.

### Conexão compartilhada autorizada

Conectar somente a `DATABASE_URL` e executar toda a inspeção dentro de uma
transação explicitamente read-only, com timeout curto. A primeira consulta deve
comprovar `transaction_read_only = on`. Falhar fechado se isso não for verdade.

Não usar nenhum script cujo modo default possa aplicar migration ou escrever.
Preferir uma consulta dedicada, pequena e auditável, sem persistir credenciais
ou o hostname completo em arquivos/logs.

### Consultas permitidas

Registrar somente metadados, definições e contagens agregadas:

1. fingerprint sanitizado do destino, `current_database()` e `current_user`
   somente de forma redigida/hasheada;
2. existência da tabela `generation_reference_uses`;
3. definição atual de:
   - `generation_reference_uses_schema_version_check`;
   - `generation_reference_uses_selected_reference_ids_check`;
4. total de linhas em `generation_reference_uses`;
5. distribuição agregada por `schema_version`;
6. distribuição agregada por `status` e `mode`;
7. distribuição por `cardinality(selected_reference_ids)`;
8. contagens de `NULL`, cardinalidade fora de 1–3 e qualquer linha que violaria
   a constraint proposta;
9. confirmação read-only de que a migration local altera somente a constraint
   de cardinalidade e não contém DML, criação de plano ou mudança de schema
   version.

Não selecionar brief, plan JSON, URL, e-mail, IDs de usuário ou conteúdo de
referência. Não registrar connection string.

### Condição de saída do Gate 3A

Entregar um relatório com:

- fingerprint sanitizado e alvo inequívoco;
- confirmação de transação read-only;
- definições exatas das duas constraints;
- contagens e distribuições agregadas;
- número de linhas incompatíveis com 1–3;
- SHA-256 e delta semântico exato da migration;
- recomendação `prosseguir` ou `não prosseguir` para o Gate 3B;
- confirmação explícita de zero writes e zero planos criados.

Depois do relatório, parar e solicitar aprovação específica de Adilson para o
Gate 3B. Não criar outro handoff automaticamente, salvo pedido.

### Hard stops do Gate 3A

- `transaction_read_only` não retorna `on`;
- destino não corresponde ao compartilhado esperado ou o fingerprint mudou de
  forma não explicada;
- constraint de schema version não aceita v3;
- cardinalidade atual difere do esperado de forma material;
- existem linhas que violariam 1–3;
- migration contém qualquer operação além do drop/recreate da constraint;
- erro de permissão, timeout ou conexão ambígua;
- qualquer ferramenta tenta executar DDL/DML.

Diante de qualquer hard stop: encerrar a transação sem writes e perguntar
`Como você prefere prosseguir?`.

## Gate 3B — ainda não autorizado

O Gate 3B só poderá começar após:

1. Gate 3A concluído;
2. relatório apresentado;
3. Adilson aceitar o relatório;
4. autorização textual nova e específica para aplicar exatamente
   `packages/web-shell/migrations/2026-08-07-single-chassis-plan.sql` no alvo
   confirmado.

Se futuramente autorizado, o Gate 3B deve:

- revalidar target e hash da migration;
- aplicar somente essa migration uma vez, em transação;
- não criar plano de teste compartilhado;
- verificar a definição 1–3 após o DDL;
- comprovar contagens e dados preservados;
- parar antes do Gate 4.

Este handoff não autoriza essas ações.

## Gates posteriores — não autorizados

- Gate 4: um Plan + Manifest real compartilhado e captura pública delimitada;
- Gate 5: superfície de aprovação de alvo/conteúdo;
- Gate 6: geração paga e billing;
- Gate 7: QA de output real e benchmark Farm Minerals → Flux;
- Gate 8: calibração após aproximadamente 100 revisões;
- Gate 9: commit/push/integração;
- Gate 10: Vercel/deploy.

## Worktree atual a preservar

Arquivos tracked modificados observados:

- `.gitignore`
- `packages/web-shell/app/api/references/plan/route.js`
- `packages/web-shell/app/globals.css`
- `packages/web-shell/components/BoardsList.jsx`
- `packages/web-shell/components/ReferenceLibrary.jsx`
- `packages/web-shell/components/ReferenceLibrary.test.jsx`
- `packages/web-shell/components/ReferencePlanner.jsx`
- `packages/web-shell/components/ReferencePlanner.test.jsx`
- `packages/web-shell/components/ReferenceReviewPanel.jsx`
- `packages/web-shell/components/ReferenceReviewPanel.test.jsx`
- `packages/web-shell/lib/demarcelize.js`
- `packages/web-shell/lib/reference-bank-store.js`
- `packages/web-shell/lib/reference-bank-store.test.js`
- `packages/web-shell/lib/reference-planner.js`
- `packages/web-shell/lib/reference-planner.test.js`
- `packages/web-shell/lib/reference-preferences.js`
- `packages/web-shell/lib/reference-preferences.test.js`
- `packages/web-shell/lib/snapshot.js`
- `packages/web-shell/package.json`
- `packages/web-shell/schema.sql`

Arquivos/diretórios novos ainda untracked:

- `docs/superpowers/evidence/2026-08-09-start-from-ref-gate-2-isolated.md`
- `docs/superpowers/handoffs/2026-08-07-start-from-ref-chassis-roadmap-local-handoff.md`
- `docs/superpowers/handoffs/2026-08-09-start-from-ref-non-curation-sequence-handoff.md`
- `docs/superpowers/handoffs/2026-08-09-start-from-ref-gate-3-authorized-handoff.md`
- `packages/web-shell/app/api/references/plan/[id]/analyze/`
- `packages/web-shell/app/api/references/plan/preview/`
- `packages/web-shell/app/api/references/plan/route.test.js`
- `packages/web-shell/lib/chassis-analyzer.js`
- `packages/web-shell/lib/chassis-analyzer.test.js`
- `packages/web-shell/lib/chassis-evidence.js`
- `packages/web-shell/lib/chassis-generation-contract.js`
- `packages/web-shell/lib/chassis-generation-contract.test.js`
- `packages/web-shell/lib/chassis-manifest.js`
- `packages/web-shell/lib/chassis-manifest.test.js`
- `packages/web-shell/lib/chassis-transplant.js`
- `packages/web-shell/lib/chassis-transplant.test.js`
- `packages/web-shell/lib/demarcelize.chassis.test.js`
- `packages/web-shell/lib/public-reference-url.js`
- `packages/web-shell/lib/public-reference-url.test.js`
- `packages/web-shell/lib/reference-guidance.js`
- `packages/web-shell/lib/reference-guidance.test.js`
- `packages/web-shell/lib/single-chassis-migration.test.js`
- `packages/web-shell/migrations/2026-08-07-single-chassis-plan.sql`
- `packages/web-shell/scripts/start-from-ref/prove-gate-2-isolated.mjs`
- `packages/web-shell/tests/start-from-ref/gate-2-isolated.integration.test.js`

Não assumir que esta lista continuará atual: conferir `git status` na retomada.
Não limpar, mover, stagear ou commitar esses arquivos sem autorização.

## Prioridades macro fracas

Já fornecidas:

1. mídia grande com texto bem ancorado;
2. assimetria controlada;
3. ritmo alternando densidade e respiro;
4. tipografia protagonista sem depender de efeitos;
5. estabilidade mobile obrigatória.

Ainda pendente: perguntar a Adilson se identificou algum novo padrão macro de
design para adicionar como prioridade fraca. A resposta calibra busca e
composição; não autoriza writes, captura, geração ou mudança de gate.

## Prompt recomendado para a próxima sessão

```text
Leia completamente docs/superpowers/handoffs/2026-08-09-start-from-ref-gate-3-authorized-handoff.md e docs/superpowers/evidence/2026-08-09-start-from-ref-gate-2-isolated.md. Faça o Gate 0 read-only mínimo e então execute somente o Gate 3A já autorizado: conecte ao banco compartilhado exclusivamente em transação read-only, confirme transaction_read_only=on, inspecione as constraints e contagens agregadas de generation_reference_uses, valide o hash e o delta exato de packages/web-shell/migrations/2026-08-07-single-chassis-plan.sql e entregue o relatório com recomendação para o Gate 3B. Não aplique migration, não crie plano, não capture URL, não gere, não use créditos, não crie board/node, não faça commit/push/merge, não altere Vercel e não publique. Pare depois do relatório e peça autorização específica para o Gate 3B. Também pergunte se identifiquei algum novo padrão macro de design para adicionar como prioridade fraca.
```
