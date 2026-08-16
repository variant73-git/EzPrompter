# Handoff — Start from a Ref: fronteira do Gate 6, Gate 5 ainda aguarda aprovação do alvo

Data: 2026-08-09
Worktree do Start from a Ref: `/Users/adilsonporto/Desktop/IA/Uncraft-start-from-ref`
Branch: `codex/start-from-ref`
HEAD observado: `60dd8ffb100fac68f8693222a583f0144e7d3f2b`
Estado: local, intencionalmente sujo e não commitado

## Comece aqui

Leia este handoff inteiro antes de alterar código, consultar estado compartilhado
ou iniciar qualquer processo.

Handoff predecessor autoritativo:

`docs/superpowers/handoffs/2026-08-09-start-from-ref-gate-5-started-handoff.md`

Na criação deste documento:

- não havia listener na porta `3035`;
- `http://127.0.0.1:3035/canvas/library/references` não estava servindo;
- não foi iniciado, reiniciado ou encerrado nenhum processo;
- não foi feita nova consulta ao banco compartilhado;
- não houve geração, chamada de modelo, reserva ou gasto de créditos;
- não houve staging, commit, push, PR ou deploy.

Antes de iniciar uma preview local, confirme novamente a porta e o checkout.
Não reutilize o PID `91483` registrado no handoff anterior: ele não está mais
servindo a porta.

## Interpretação vinculante do pedido atual

Mensagem de Adilson:

> faça o handoff para o gate 6.

Este pedido autoriza **somente a criação deste handoff**. Ele não autoriza:

- concluir o Gate 5 em nome do usuário;
- escolher um alvo, conteúdo, design system ou mídia;
- persistir um contrato compartilhado sem aprovação do hash exato;
- implementar ou conectar a rota paga do Gate 6;
- chamar `transplantChassis()`;
- reservar ou gastar créditos;
- criar board, node, snapshot ou output;
- commit, push, merge, deploy ou alteração no Vercel.

O próximo agente não deve interpretar a existência deste arquivo como aprovação
do Gate 6.

## O que significa “novo site” neste fluxo

O Gate 6 não cria uma nova empresa, uma nova marca ou um site inventado. Se for
posteriormente autorizado, ele produzirá **um candidato de output isolado**:

- a verdade de marca, copy, design system e mídia vem do alvo aprovado no Gate 5;
- a estrutura, composição responsiva, papéis de mídia e motion portátil vêm do
  Chassis Manifest aprovado no Gate 4;
- identidade, textos, métricas, clientes, depoimentos e prova comercial da
  referência não podem atravessar para o output;
- o alvo original não pode ser sobrescrito;
- o output não será publicado nem colocado em produção durante o Gate 6.

É um teste real e delimitado de geração paga, não apenas um mock, mas continua
sendo uma prova de aceitação isolada. Deploy e integração são gates posteriores.

## Estado dos gates

### Gate 4 — concluído e preservado

- Plan id: `2c743581-36e5-4e07-81ed-695795111ee0`
- Mode/status: `shadow` / `approved`
- Manifest hash:
  `3fb15637add3b707330f0174762e6a7f722e5a9f55abaad8f2a32d5f4ad29f28`
- O plano e o Manifest não foram alterados pelo Gate 5.
- No último snapshot verificado havia `0` planos de modo generation.

### Gate 5 — implementação concluída, aceitação real pendente

Foi implementada e validada a superfície que:

- seleciona a autoridade de alvo;
- monta o blueprint e o ledger de seções;
- mostra `PRESERVE / ADAPT / REPLACE`;
- registra bindings de mídia, capacidade de texto e portabilidade de motion;
- mostra `Worth borrowing`, `Avoid` e lacunas honestas;
- exige o hash exato do Manifest e do contrato;
- invalida aprovação quando um input hasheado muda;
- mantém generation, crédito e mutação de canvas bloqueados.

Rotas existentes:

- `POST /api/references/plan/[id]/contract/preview` — zero-write;
- `POST /api/references/plan/[id]/contract` — reconstrói e persiste somente o
  contrato exato aprovado.

Estado compartilhado vinculante no último checkpoint:

- `chassisTargetContract`: ausente;
- geração autorizada: não;
- gasto de crédito autorizado: não;
- mutação de canvas autorizada: não.

Portanto, o Gate 5 **não está concluído**. O código está pronto, mas não existe
um contrato real de alvo aprovado que o Gate 6 possa consumir.

## O que ainda é necessário de Adilson para concluir o Gate 5

Para o plano `2c743581-36e5-4e07-81ed-695795111ee0`, obter:

1. tipo de autoridade:
   - projeto existente de propriedade do usuário;
   - URL alvo;
   - ou fontes fornecidas e nomeadas;
2. projeto/nome, URL ou label exato das fontes;
3. nome real da marca ou produto alvo;
4. nota opcional explicando a autoridade;
5. confirmação explícita de prontidão para:
   - copy/conteúdo real;
   - tokens do design system;
   - mídia substituta para os slots ou waivers explícitos.

Depois disso:

1. produzir a preview zero-write;
2. mostrar os bloqueios ou o hash exato do contrato;
3. pedir aprovação explícita daquele hash;
4. persistir somente se o hash continuar atual;
5. confirmar que todos os locks de execução continuam `false`;
6. parar novamente.

Não inferir essas respostas de um site antigo, de Farm Minerals, de Flux, do
Chassis Manifest ou de arquivos locais. Não preencher lacunas com conteúdo
inventado.

## Condições obrigatórias antes do Gate 6

O Gate 6 só pode começar quando todas forem verdadeiras:

1. o Gate 5 tem um `chassisTargetContract` real e aprovado;
2. o Manifest hash continua sendo exatamente o aprovado;
3. o contract hash continua atual;
4. a autoridade de projeto, quando usada, ainda pertence ao usuário;
5. conteúdo, design system e mídia estão completos ou têm waivers explícitos;
6. nenhum lock foi antecipadamente aberto;
7. Adilson fornece uma nova autorização textual para iniciar o Gate 6.

Mudança no Manifest, alvo, ledger, conteúdo, mídia, design system ou orientação
do curador invalida a aprovação e retorna ao Gate 5.

## Divisão operacional segura do Gate 6

Mesmo depois de o Gate 5 ser concluído, não tratar “inicie o Gate 6” como
autorização automática para gastar. Separar operacionalmente:

### Gate 6A — implementação e prova isolada, zero gasto real

Exige autorização explícita para iniciar o Gate 6, mas ainda não autoriza uma
chamada paga.

1. Adicionar uma rota de execução pequena ao redor de `transplantChassis()`.
2. Exigir sessão, ownership, Plan aprovado, Manifest hash atual e contract hash
   atual.
3. Rejeitar contrato bloqueado, adulterado, stale ou não aprovado.
4. Preparar somente um output isolado; nunca alterar o alvo original.
5. Implementar idempotência e uma operação durável antes de qualquer hold.
6. Provar em banco descartável que sucesso, falha, retry e concorrência não
   duplicam output nem movimentam crédito incorretamente.
7. Não chamar o modelo real nesta subetapa.

### Gate 6B — quote/preflight do contrato exato, zero reserva

1. Produzir uma estimativa explícita em créditos e valor para o contrato exato.
2. Mostrar modelo/provedor previsto e as limitações da estimativa.
3. Não reservar crédito no preflight.
4. Não criar output, node ou snapshot no preflight.
5. Apresentar o quote a Adilson e parar.

A estimativa provisória histórica de `75` créditos não é aceitação de preço.
Ela deve ser medida e recalibrada com uso real.

### Gate 6C — uma execução real e paga

Exige duas aprovações explícitas e separadas, posteriores ao quote:

1. autorização para gerar usando os hashes exatos apresentados;
2. autorização para reservar/gastar o número de créditos apresentado.

Somente então:

1. criar/claimar uma operação idempotente;
2. fazer hold atômico dos créditos;
3. chamar `transplantChassis()` uma vez;
4. medir tokens e custo real do provedor;
5. criar um único output isolado com proveniência de Plan, Manifest, contrato,
   alvo, modelo e operação;
6. settle do custo real e devolução automática do excedente;
7. em qualquer falha, refund integral e terminalização inequívoca;
8. confirmar que não existe output parcial ou débito órfão;
9. parar antes do Gate 7.

Contrato aprovado e crédito aprovado são decisões diferentes. Uma não implica a
outra.

## Hard stops do Gate 6

Parar sem chamada paga e perguntar `Como você prefere prosseguir?` se ocorrer:

- contrato de alvo ausente, bloqueado, adulterado ou stale;
- Manifest hash diferente de
  `3fb15637add3b707330f0174762e6a7f722e5a9f55abaad8f2a32d5f4ad29f28`;
- ownership de projeto ambíguo;
- quote não apresentado ou alterado depois da aprovação;
- aprovação de geração ou crédito ausente;
- alvo compartilhado/isolado ambíguo;
- operação idempotente não pode ser claimada com segurança;
- não é possível garantir hold/settle/refund e reconciliação;
- o fluxo pretende sobrescrever o alvo original;
- seriam enviados sites completos adicionais quando evidência localizada basta;
- qualquer tentativa de gerar copy comercial, números ou prova não sustentada;
- listener pertence a outro checkout;
- drift compartilhado ou de source control não explicado.

## Pontos de código já existentes

- `packages/web-shell/lib/chassis-target-contract.js`
- `packages/web-shell/lib/chassis-target-contract.test.js`
- `packages/web-shell/components/ChassisTargetReview.jsx`
- `packages/web-shell/components/ChassisTargetReview.test.jsx`
- `packages/web-shell/app/api/references/plan/[id]/contract/preview/route.js`
- `packages/web-shell/app/api/references/plan/[id]/contract/route.js`
- `packages/web-shell/lib/chassis-generation-contract.js`
- `packages/web-shell/lib/chassis-generation-contract.test.js`
- `packages/web-shell/lib/chassis-transplant.js`
- `packages/web-shell/lib/chassis-transplant.test.js`
- `packages/web-shell/lib/demarcelize.js` — contém `transplantChassis()` ainda
  desconectado desta superfície;
- `packages/web-shell/lib/billing/context.js`
- `packages/web-shell/lib/billing/operations.js`
- `packages/web-shell/lib/billing/ledger.js`
- `packages/web-shell/lib/billing/pricing.js`
- `packages/web-shell/scripts/start-from-ref/prove-gate-5-isolated.mjs`

Reusar a infraestrutura de billing existente somente após auditar seu contrato
de idempotência, fencing, settle e reconciliação para esta nova operação. Não
copiar uma rota paga existente sem verificar ownership e persistência do output.

## Evidência já obtida no Gate 5

No checkpoint do handoff predecessor:

- `158` arquivos de teste passaram;
- `1.038` testes passaram;
- `15` testes foram ignorados por guards existentes;
- build de produção passou;
- prova Gate 5 em database descartável passou;
- preview bloqueada foi zero-write;
- contrato sintético exato persistiu com todos os locks falsos;
- input alterado retornou `target_contract_stale`;
- contagens protegidas permaneceram iguais dentro da prova;
- o database descartável foi removido e sua ausência confirmada;
- QA em browser mostrou os 9 itens do ledger e persistência após reload.

Esses resultados validam a implementação do Gate 5. Eles não substituem a
aprovação de um alvo real e não autorizam geração.

## Snapshot compartilhado datado — não tratar como atual sem reverificação

Último snapshot registrado no fim do Gate 5:

- boards: `14`
- nodes: `57`
- snapshots: `67`
- usage events: `25`
- credit ledger rows: `22`
- operations: `2`
- credits cents: `2365`
- generation plans: `0`

Essas contagens já continham drift de trabalho paralelo e foram apenas
observadas. Não foram revertidas. Qualquer retomada deve tratá-las como datadas
e não deve consultar ou alterar estado compartilhado além da autorização vigente.

## Trabalho paralelo no checkout principal

Checkout: `/Users/adilsonporto/Desktop/IA/Uncraft`
Branch local: `main`
HEAD local observado: `419c567b7b648024db7e0779c36c82d9ebfe2958`
`origin/main` observado: `60dd8ffb100fac68f8693222a583f0144e7d3f2b`

O HEAD local é um merge do trabalho paralelo do motion editor com o antigo
`origin/main`. Esse merge ainda não estava no remoto durante este handoff.

Uma fragilidade independente dos testes do banco de referências foi corrigida
localmente nesse checkout principal, ainda sem commit/push:

- `packages/web-shell/lib/reference-bank-promotion.test.js` usa fixtures
  portáteis;
- `packages/web-shell/lib/reference-bank-promotion.artifacts.integration.test.js`
  preserva os sete testes históricos sob ativação explícita;
- `packages/web-shell/package.json` possui
  `test:refs:promotion-artifacts`.

Validações dessa correção no checkout principal:

- suíte completa: `198` arquivos passaram, `3` ignorados;
- `1.718` testes passaram, `17` ignorados;
- validação explícita com os oito artefatos reais: `7/7` testes passaram;
- build de produção passou;
- nenhum arquivo-fonte do motion editor foi alterado por essa correção.

Não presumir que essa correção já existe no worktree Start from a Ref ou no
remoto. Não copiar, commitar, mesclar ou limpar o trabalho paralelo durante o
Gate 6 sem autorização específica de source control.

## Higiene do worktree Start from a Ref

O worktree continua com muitos arquivos tracked modificados e arquivos novos
untracked acumulados desde os Gates 1–5. Entre os arquivos relevantes estão:

- `.gitignore`;
- Planner, store, preferences, UI e schema existentes;
- rotas de preview, persistência, analyze e contract;
- Chassis Manifest, analyzer, transplant e target contract;
- migrations e scripts de provas isoladas;
- handoffs e evidências ainda não versionados.

Regras:

- preservar todos os arquivos não relacionados;
- não usar `git add -A`;
- não fazer limpeza ampla;
- não reverter drift paralelo;
- usar staging por caminhos explícitos somente após autorização;
- confirmar `variant73-git` antes de qualquer push futuramente autorizado;
- confirmar Root Directory `packages/web-shell` antes de qualquer deploy
  futuramente autorizado.

## Sequência exata para a próxima sessão

1. Confirmar worktree, branch, HEAD, status, diff e owner da porta `3035`.
2. Ler este handoff e o predecessor do Gate 5 integralmente.
3. Não iniciar o Gate 6.
4. Explicar que o Gate 5 ainda precisa de alvo, marca e três confirmações de
   prontidão.
5. Se Adilson fornecer esses dados, produzir somente a preview zero-write.
6. Mostrar bloqueios ou o hash exato e pedir aprovação para persistir.
7. Persistir somente após aprovação explícita e revalidação do hash.
8. Confirmar todos os locks falsos e parar.
9. Solicitar autorização separada para o Gate 6A.
10. Mesmo com Gate 6A autorizado, não gastar créditos antes do quote e das duas
    aprovações do Gate 6C.

## Condição de saída futura do Gate 6

Uma única geração explicitamente autorizada deve:

- produzir um output isolado e rastreável; ou
- falhar com refund integral e sem output parcial;
- registrar custo real e proveniência;
- preservar o alvo original;
- manter Gate 7, Git, integração e deploy bloqueados.
