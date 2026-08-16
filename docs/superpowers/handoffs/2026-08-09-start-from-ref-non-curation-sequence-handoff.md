# Handoff — Start from a Ref: sequência independente de nova curadoria (2026-08-09)

## Comece aqui

- Worktree: `/Users/adilsonporto/Desktop/IA/Uncraft-start-from-ref`
- Branch: `codex/start-from-ref`
- HEAD observado: `60dd8ffb docs(refs): hand off private curation next steps`
- Estado: intencionalmente sujo, local e ainda não commitado.
- Handoff anterior: `docs/superpowers/handoffs/2026-08-07-start-from-ref-chassis-roadmap-local-handoff.md`
- Página local: `http://localhost:3035/canvas/library/references`
- Em 2026-08-09, a porta 3035 estava servida por `node` PID 67653; a rota respondeu `307` para autenticação e o HTML continha `<title>Uncraft</title>`. Esse PID é apenas uma observação datada: confirme novamente a posse da porta antes de iniciar, reiniciar ou encerrar qualquer processo.

Leia este arquivo por completo antes de editar, abrir banco, capturar referência externa, gerar, gastar créditos, criar board/node, commitar, enviar, integrar, alterar Vercel ou publicar.

Este handoff substitui o anterior como ponto principal de retomada. O anterior continua sendo a fonte detalhada do trabalho anterior ao Gate 1, mas suas afirmações de que a prévia efêmera e a escolha humana ainda não existiam estão superadas pelo estado descrito aqui.

## Limite de autorização

Este arquivo registra estado, dependências, sequência e condições de saída. Ele **não autoriza a execução de nenhum gate seguinte**.

Em especial, ele não autoriza:

- acesso ou escrita no banco compartilhado;
- aplicação de migration;
- criação de plano real compartilhado;
- captura de URL pública real;
- geração com modelo ou gasto de créditos;
- criação de board, node ou artefato de produção;
- commit, push, merge ou alteração de branch;
- mudança de ambiente Vercel ou deploy.

Regras permanentes relevantes:

- O único e-mail autorizado para curadoria é `variant73@gmail.com`.
- A conta GitHub correta é sempre `variant73-git`.
- O projeto Vercel é `uncraft`, no time `variant73-gits-projects`, com produção em `https://uncraft.vercel.app`.
- Antes de qualquer deploy, confirmar que o Root Directory do projeto é `packages/web-shell`.
- Não usar `git add -A`; revisar e adicionar caminhos explícitos somente após autorização.
- Preservar arquivos sujos, não relacionados e ignorados. Não limpar evidências em massa.

## Resposta curta: o que ainda depende de nova curadoria

Somente o **Gate 8 — calibração da recuperação após aproximadamente 100 referências revisadas** depende de Adilson continuar a curadoria.

Os Gates 2, 3, 4, 5, 6, 7, 9 e 10 não dependem de novas avaliações `Keep / Maybe / Pass`. Eles continuam dependendo de suas próprias autorizações, pré-condições técnicas e gates anteriores.

Implicações:

- O próximo passo recomendado é o **Gate 2 isolado**, usando fixtures, uma referência direta controlada ou Keeps já existentes.
- O fluxo vertical pode ser provado sem aguardar 100 revisões.
- A qualidade da recuperação automática por Keeps não pode ser declarada calibrada até o Gate 8.
- Antes de um deploy que apresente a recuperação automática como comportamento final, Adilson deve decidir explicitamente se o Gate 8 é ou não um bloqueador de lançamento.

## Estado dos gates concluídos

### Gate 0 — recuperação e verificação: concluído

Foi confirmado:

- branch `codex/start-from-ref`;
- HEAD `60dd8ffb`;
- lista exata do worktree sujo;
- ausência de erro em `git diff --check`;
- página local servida na porta 3035, com redirecionamento esperado para autenticação e título correto.

Uma nova sessão deve repetir apenas o preflight read-only necessário para detectar drift. Não recomeçar implementação concluída nem rerodar importações.

### Gate 1 — prévia efêmera e escolha humana: concluído

O Planner agora usa `plannerContractVersion: 5` e o contrato abaixo é autoritativo:

1. `Build chassis preview` cria apenas uma prévia efêmera.
2. Construir, trocar de página ou selecionar uma opção não persiste plano.
3. A interface mostra `Not saved` enquanto a receita é apenas uma prévia.
4. Somente `Approve recipe` envia a seleção e persiste o plano aprovado.
5. O servidor recalcula as opções e verifica o `previewHash` antes de persistir; uma prévia divergente retorna `preview_stale`.
6. O hash cobre contrato, brief, modo, base de score, página, opções completas, guidance, warnings, total de opções e melhor score.
7. O score continua sendo apenas `typeFit`/site type.
8. `Worth borrowing` e `Avoid` são guidance pós-seleção e nunca afetam ranking.
9. `curationWeight` pode continuar presente no objeto legado, mas não escolhe nem desempata opções.
10. Todos os candidatos empatados no melhor `typeFit` permanecem elegíveis; a UI os apresenta alfabeticamente, em páginas de até três.
11. A ordem alfabética é apenas apresentação neutra, não um sinal de preferência.
12. Se houver exatamente uma opção no conjunto inteiro, ela pode ser selecionada automaticamente. Uma página final com uma opção entre várias não pode ser auto-selecionada.
13. Se houver mais de uma opção, o usuário precisa selecionar explicitamente uma delas para liberar `Approve recipe`.
14. A construção continua `single-chassis`: apenas uma referência escolhida ocupa `selectedReferences`.
15. O modo Direct URL continua sem exigir curadoria e produz uma única opção determinística.
16. Aprovação persiste por `saveApprovedReferencePlan()`; a rota de prévia não chama persistência.

Arquivos centrais do Gate 1:

- `packages/web-shell/app/api/references/plan/preview/route.js`
- `packages/web-shell/app/api/references/plan/preview/route.test.js`
- `packages/web-shell/app/api/references/plan/route.js`
- `packages/web-shell/app/api/references/plan/route.test.js`
- `packages/web-shell/components/ReferencePlanner.jsx`
- `packages/web-shell/components/ReferencePlanner.test.jsx`
- `packages/web-shell/lib/reference-planner.js`
- `packages/web-shell/lib/reference-planner.test.js`
- `packages/web-shell/lib/reference-bank-store.js`
- `packages/web-shell/lib/reference-bank-store.test.js`

## Evidência de validação do Gate 1

Último checkpoint completo registrado:

- suíte total: 154 arquivos aprovados, 1 ignorado;
- testes: 1.028 aprovados, 4 ignorados;
- build de produção: aprovado, com 44 páginas e inclusão de `/api/references/plan/preview`;
- `git diff --check`: aprovado;
- QA visual do componente real em harness temporário, depois removido:
  - desktop `1440×1000`;
  - mobile `390×844`;
  - sem overflow horizontal;
  - sem warnings ou erros no console;
  - seleção, botão de aprovação desabilitado e paginação verificados;
  - corrigido o caso em que uma última página com uma opção entre quatro era auto-selecionada indevidamente.

Não confundir essa aceitação local com aceitação autenticada em produção. Nenhum plano compartilhado, captura externa, geração ou crédito foi usado para validar o Gate 1.

## Contratos de produto que permanecem autoritativos

### Curadoria e elegibilidade

- `Maybe` é default/indeciso; não conta como revisado e não entra no Planner.
- Apenas `Keep` entra como candidato curado.
- `Pass` e `Maybe` permanecem excluídos.
- Não reintroduzir taste score, style tags, motion tags, dimensões de força ou papéis fixos `chassis / donor / either` como ranking.
- `Worth borrowing / Avoid` só orientam a transferência após escolha.

### Chassis e autoridade do alvo

- Um chassis é o default e controla a espinha estrutural global: ordem, hierarquia, grid, proporções, alinhamento, densidade, ritmo, âncoras de texto, papéis de mídia, lógica de movimento e estrutura responsiva.
- O alvo controla identidade, marca, copy, tipografia, cor, imagens e verdade factual/comercial.
- Nunca inventar depoimentos, preços, métricas, clientes, capacidades ou prova comercial para preencher um slot do chassis.
- Mostrar até três opções por página não significa construir com três referências.
- Uma segunda ou terceira referência de construção só pode existir como exceção explicitamente especificada, com contribuição localizada e sem competir pela espinha global.

### Manifest, segurança e geração

- `analyzeChassisReference()` captura desktop `1440×1000` e mobile `390×844` e produz um Manifest hasheado.
- A análise exige plano aprovado e retorna Manifest existente de forma idempotente.
- URLs privadas, localhost, `.local`, loopback, link-local e redes privadas devem falhar fechadas.
- A proteção de URL foi provada por testes, mas ainda requer aceitação pública delimitada antes de uso de produção.
- `createTransplantBlueprint()` e `auditChassisTransfer()` já definem ledger e QA determinísticos.
- `transplantChassis()` existe como seam, mas não está conectado a rota, cobrança, board/node ou ação de UI.
- Aprovação de contrato e aprovação de crédito são decisões separadas.

## Sequência restante que não exige nova curadoria

### Gate 2 — E2E completo em ambiente descartável — próximo recomendado

Dependências:

- Gate 1 concluído;
- autorização explícita para criar e remover somente o banco/ambiente descartável;
- `E2E_ISOLATED_DATABASE_URL` comprovadamente distinto de `DATABASE_URL`.

Não usar banco compartilhado neste gate. Preferir fixtures locais determinísticas. Uma referência pública só pode ser usada se for delimitada e explicitamente aprovada para esse teste.

Provar ponta a ponta, por rotas e store reais:

1. uma prévia baseada em `Keep` não grava antes da aprovação;
2. a escolha explícita de um candidato empatado persiste exatamente um chassis aprovado;
3. Direct URL funciona sem carregar candidatos curados;
4. `Maybe` e `Pass` nunca entram no conjunto elegível;
5. paginação preserva o conjunto completo, o offset e a exigência de escolha humana;
6. `preview_stale` impede persistência se opções, guidance, warnings ou hash mudarem;
7. aprovação libera análise; rejeição ou ausência de aprovação não libera;
8. o analyzer captura fixtures desktop/mobile, ou uma fixture pública previamente autorizada;
9. o Manifest persiste e a segunda análise retorna o mesmo artefato sem recaptura;
10. autenticação inválida e alvos de rede privada falham fechados;
11. não há alteração em board, node, geração, billing ou créditos;
12. todos os writes desaparecem junto com o banco descartável.

Condição de saída:

- comportamento real das rotas e do store aprovado em ambiente isolado;
- evidência de que prévia é zero-write e aprovação é o único write de plano;
- nenhuma conexão ou mutação compartilhada.

Hard stop: qualquer indicação de que a URL isolada aponta para o banco compartilhado interrompe o gate antes do primeiro write.

### Gate 3A — preflight read-only da migration compartilhada

Não exige curadoria, mas exige autorização explícita para acessar o banco compartilhado em modo read-only.

1. Confirmar alvo/ambiente do banco sem exibir segredos.
2. Inspecionar a constraint de `schemaVersion` existente.
3. Inspecionar a constraint de cardinalidade de `selected_reference_ids` existente.
4. Registrar definição das constraints e contagens antes da mudança.
5. Confirmar que `packages/web-shell/migrations/2026-08-07-single-chassis-plan.sql` altera apenas a cardinalidade para `1–3`.
6. Não aplicar migration e não inserir plano neste subgate.

Condição de saída: relatório read-only com alvo inequívoco, constraints atuais, contagens e delta exato proposto.

### Gate 3B — aplicar uma vez a migration compartilhada

Exige autorização distinta, explícita e posterior à aceitação do Gate 3A.

1. Aplicar somente `2026-08-07-single-chassis-plan.sql` no alvo confirmado.
2. Verificar que a nova constraint aceita cardinalidade `1–3`.
3. Verificar que nenhuma linha foi criada, removida ou alterada.
4. Registrar definição e contagens depois da mudança.
5. Não criar plano durante este gate.

Condição de saída: armazenamento compartilhado aceita `1–3`, com dados e contagens preservados.

### Gate 4 — uma aceitação real e delimitada de Plan + Manifest

Não exige nova curadoria: usar uma URL direta explicitamente escolhida ou um `Keep` já existente. O snapshot anterior registrava 13 Keeps, mas esse número é datado e deve ser conferido read-only antes de depender dele.

Exige autorização explícita para:

- criar exatamente um plano compartilhado;
- capturar exatamente uma referência pública aprovada em desktop/mobile;
- decidir depois se o registro será mantido ou rejeitado/removido por um caminho seguro.

Sequência:

1. Registrar previamente a referência, o brief e o resultado esperado.
2. Construir a prévia e confirmar zero writes.
3. Selecionar uma opção e aprovar uma vez.
4. Verificar o único plano persistido e seu status.
5. Analisar uma vez e inspecionar evidence, hash, section roles, media roles, motion signals, responsive persistence, confidence e gaps.
6. Repetir a análise e confirmar cache/idempotência sem recaptura.
7. Confirmar que geração continua bloqueada e créditos permanecem inalterados.
8. Tomar uma decisão explícita sobre retenção do plano delimitado.

Condição de saída: um Plan + Manifest real aceito, sem geração.

### Gate 5 — superfície de aprovação de alvo e conteúdo

Não exige curadoria nem modelo pago. Deve partir de um Manifest aceito ou de fixture equivalente explicitamente autorizada para desenvolvimento local.

1. Permitir selecionar a autoridade de alvo: projeto/site existente, URL ou copy/design system fornecido.
2. Renderizar o blueprint/section ledger produzido por `createTransplantBlueprint()`.
3. Expor `PRESERVE / ADAPT / REPLACE`, bindings de mídia, capacidades de texto, portabilidade de motion, `Worth borrowing` e `Avoid`.
4. Mostrar lacunas de conteúdo/asset como bloqueios honestos.
5. Exigir aprovação do contrato exato, ligada aos hashes do Manifest e do contrato.
6. Invalidar a aprovação se qualquer input hasheado mudar.
7. Não chamar modelo, não reservar crédito e não criar output neste gate.

Condição de saída: entradas e ledger de geração revisáveis e aprováveis sem execução paga.

### Gate 6 — conectar geração paga com segurança

Não exige curadoria, mas exige autorização explícita para geração e uma autorização separada para gasto de créditos.

1. Adicionar uma rota de execução ao redor de `transplantChassis()`.
2. Exigir Manifest e contrato exatos já aprovados.
3. Apresentar quote/preflight em créditos e valor antes da reserva.
4. Implementar hold, settle e refund sem deixar débito ou output ambíguo em falhas.
5. Medir tokens e custo real; recalibrar a estimativa provisória de 75 créditos.
6. Criar output isolado, com proveniência, sem alterar o alvo original.
7. Não enviar referências completas adicionais quando evidência localizada for suficiente.
8. Manter aprovação de contrato distinta de aprovação de crédito.

Condição de saída: uma geração explicitamente autorizada produz output rastreável ou falha com refund limpo.

### Gate 7 — QA do output real e benchmark Farm Minerals → Flux

Não exige nova curadoria, mas depende de um output autorizado do Gate 6.

1. Capturar alvo, chassis e output em desktop/mobile comparáveis.
2. Rodar `auditChassisTransfer()` e QA visual em navegador real.
3. Confirmar:
   - identidade e copy verdadeiras do alvo;
   - ausência de vazamento de identidade da referência;
   - fidelidade estrutural ao chassis;
   - substituição correta de mídia;
   - persistência responsiva;
   - semântica de motion;
   - acessibilidade, console e estabilidade;
   - distância de originalidade suficiente.
4. Formalizar Farm Minerals → Flux como benchmark dourado para “wireframe transplantado, design system substituído”.
5. Registrar o `Reference Influence Ledger` e todas as decisões `PRESERVE / ADAPT / REPLACE`.

Condição de saída: um output real passa QA determinístico e aceitação humana.

### Gate 9 — fechamento de source control

Não exige curadoria. Executar somente após aprovação explícita do conjunto final de arquivos.

1. Reavaliar ownership e drift do worktree.
2. Revisar `.gitignore` e o vínculo Vercel separadamente.
3. Adicionar somente caminhos explícitos.
4. Fazer commit em `codex/start-from-ref` apenas se autorizado.
5. Confirmar GitHub auth `variant73-git` antes de qualquer push.
6. Push e integração em `main` exigem autorizações próprias.

Condição de saída: histórico revisável e escopo preservado. Este handoff não autoriza commit, push ou merge.

### Gate 10 — deploy Vercel opcional

Não exige curadoria tecnicamente, mas exige decisão explícita sobre o Gate 8 como possível bloqueador de lançamento e autorização separada de deploy.

Antes de publicar:

1. confirmar conta, time, projeto e Root Directory `packages/web-shell`;
2. configurar `REFERENCE_CURATOR_EMAILS` somente com `variant73@gmail.com`, sem revelar segredos em logs;
3. confirmar migrations, separação de ambientes e compatibilidade de cron;
4. revisar custo e comportamento de captura em produção;
5. publicar exatamente o commit revisado;
6. rodar aceitação autenticada e não autenticada;
7. confirmar fronteiras de referências privadas e ausência de vazamento de proveniência.

Condição de saída: commit exato publicado e smoke de produção aprovado. Este handoff não autoriza Vercel nem deploy.

## Gate dependente de nova curadoria — deliberadamente adiado

### Gate 8 — calibrar recuperação após aproximadamente 100 revisões

Somente este gate precisa de nova curadoria:

1. medir concordância entre candidatos sugeridos e escolha de Adilson;
2. separar falhas de inferência de site type, metadados ausentes, empate e incompatibilidade estrutural;
3. decidir se metadados baratos bastam ou se vale pré-análise estrutural de um top-N pequeno;
4. manter taste, style, motion e `Worth/Avoid` fora do ranking, salvo nova decisão explícita;
5. não transformar padrões macro em papéis rígidos ou seletores determinísticos.

Até esse gate, a formulação correta é: “a recuperação determinística funciona segundo o contrato atual”, não “a escolha automática foi calibrada ao gosto de Adilson”.

## Prioridades macro fracas já fornecidas

Usar apenas como prioridades fracas de busca e composição, nunca como papéis fixos, filtros absolutos ou score oculto:

1. mídia grande com texto bem ancorado;
2. assimetria controlada;
3. ritmo alternando densidade e respiro;
4. tipografia protagonista sem depender de efeitos;
5. estabilidade mobile obrigatória.

Pergunta obrigatória em uma retomada relevante:

> Você identificou algum novo padrão macro de design que devemos adicionar como prioridade fraca de busca e composição?

Registrar separadamente padrões já fornecidos e padrões ainda pendentes. Uma resposta a essa pergunta calibra prioridades; não autoriza writes, captura, geração ou mudança de gate.

## Worktree pertencente a esta sequência

Arquivos tracked modificados:

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
- `packages/web-shell/schema.sql`

Arquivos novos e ainda untracked:

- `docs/superpowers/handoffs/2026-08-07-start-from-ref-chassis-roadmap-local-handoff.md`
- `docs/superpowers/handoffs/2026-08-09-start-from-ref-non-curation-sequence-handoff.md`
- `packages/web-shell/app/api/references/plan/[id]/analyze/route.js`
- `packages/web-shell/app/api/references/plan/[id]/analyze/route.test.js`
- `packages/web-shell/app/api/references/plan/preview/route.js`
- `packages/web-shell/app/api/references/plan/preview/route.test.js`
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

Não assumir que esta lista continuará atual. Toda nova sessão deve compará-la com `git status` e documentar drift antes de editar.

## Hard stops globais

- Não usar `DATABASE_URL` compartilhada no Gate 2.
- Não aplicar a migration 1–3 sem Gate 3A aceito e autorização exata para Gate 3B.
- Não criar plano compartilhado para “só testar o botão”.
- Não capturar uma referência pública sem URL, escopo e gate explicitamente aprovados.
- Não disparar `transplantChassis()`, modelo, cobrança, créditos, board/node ou Demarcelizer sem autorização específica.
- Não tornar referências privadas públicas nem expor sua proveniência a usuários comuns.
- Não reintroduzir ranking de taste/style/motion, `curationWeight` como desempate ou papéis donor rígidos.
- Não interpretar ordenação alfabética como recomendação.
- Não inventar conteúdo comercial ou factual para caber no chassis.
- Não usar `git add -A`, descartar arquivos sujos de terceiros ou limpar evidências amplamente.
- Não commitar, enviar, integrar, alterar Vercel ou publicar a partir deste handoff sozinho.
- Diante de divergência material entre estado, alvo ou autorização, parar e perguntar: `Como você prefere prosseguir?`

## Prompt recomendado para a próxima sessão

Este prompt pede somente recuperação e proposta operacional; não autoriza os writes descartáveis do Gate 2:

```text
Leia completamente docs/superpowers/handoffs/2026-08-09-start-from-ref-non-curation-sequence-handoff.md e o handoff anterior que ele referencia. Faça apenas o Gate 0 read-only: confirme branch, HEAD, worktree, ownership da porta 3035 e ausência de drift material. Depois apresente o plano operacional exato do Gate 2 isolado, incluindo como provar que E2E_ISOLATED_DATABASE_URL não aponta para DATABASE_URL, quais fixtures serão usadas, quais writes descartáveis serão criados e como serão removidos. Aguarde minha autorização antes de criar banco, executar E2E, acessar banco compartilhado, capturar URL pública, gerar, gastar créditos, criar board/node, commitar, fazer push/merge, alterar Vercel ou publicar. Também me pergunte se identifiquei algum novo padrão macro de design para adicionar como prioridade fraca.
```

## Próxima autorização sugerida, se Adilson decidir avançar

Depois de aceitar o plano operacional, a autorização deve delimitar apenas o Gate 2, por exemplo:

```text
Autorizo somente o Gate 2 descrito no handoff, usando banco e fixtures descartáveis comprovadamente isolados. Não autorizo acesso ou writes no banco compartilhado, migration compartilhada, captura pública real não listada, plano real, geração, créditos, board/node, commit, push, merge, Vercel ou deploy. Pare ao concluir o relatório e preservar as evidências locais do Gate 2.
```
