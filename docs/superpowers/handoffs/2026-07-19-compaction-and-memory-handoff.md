# Handoff — Compactação de contexto e camadas de memória (para o próximo agente)

**Data:** 2026-07-19 · **Para:** qualquer agente futuro neste projeto · **Pedido do Adilson:** explicar a compactação e como trabalhar bem com ela.

## 1. O que a compactação faz

Quando a conversa se aproxima do limite da janela de contexto, o harness **resume os trechos mais antigos** e segue com: (a) o system prompt re-injetado (CLAUDE.md, MEMORY.md, regras), (b) o **resumo** do que foi compactado, e (c) a **cauda recente não-resumida** da conversa. Sim — na prática ela separa "histórico condensado" de "conteúdo recente literal".

O que se **perde** no resumo: o texto literal dos turnos antigos — outputs de testes, diffs exatos, números, o fraseado preciso de uma decisão. O que **nunca se perde**: tudo que está **em disco** (código, git, docs, checkpoints, vault) — o agente relê quando precisar.

## 2. É seguro?

**Seguro para tudo que foi persistido; arriscado para o que só existia na conversa.** Os modos de falha reais:

1. **Decisão tomada em conversa e nunca escrita** → o resumo pode perdê-la ou deformá-la. Antídoto: o ritual deste projeto — decisões viram handoff doc / checkpoint / CLAUDE.md **antes** da compactação chegar.
2. **O agente "lembra" um detalhe do resumo com confiança indevida** (um número, uma linha de código) → antídoto: pós-compactação, re-verificar em disco antes de afirmar; nunca citar file:line de memória resumida.
3. **Trabalho em andamento atravessando a compactação** → funciona (o harness foi feito pra isso), mas com qualidade menor do que um handoff limpo + sessão nova. Por isso a regra [[feedback_session_budget_warning]]: **avisar o Adilson antes**, oferecer o wrap-up.

Sobre "o que fica de fora até que eu peça": nada fica *inacessível* — o agente pode reler qualquer arquivo a qualquer momento. O que fica de fora do contexto automático é: conteúdo de checkpoints (só o índice MEMORY.md carrega), o vault Brain inteiro, e os trechos antigos da conversa (esses sim, irrecuperáveis em forma literal se não foram persistidos).

## 3. As camadas de memória e seus custos (medido 2026-07-19)

| Camada | Carrega quando | Custo | Papel |
|---|---|---|---|
| CLAUDE.md do projeto (~149KB) | Toda sessão, inteiro | ~35-40k tokens/sessão, o maior custo fixo | Regras + histórico numerado. **Candidato a compactação editorial** (itens 1–135 → ponteiros pro vault) |
| MEMORY.md (~15KB) | Toda sessão, inteiro | Moderado | Índice de 1 linha por memória |
| Arquivos checkpoint_*.md | Sob demanda (Read) | Quase zero | Conteúdo gordo das sessões |
| Vault Brain (incl. Findings) | Nunca automático | Zero por sessão | Estratégia, sessões, findings — cresce livre |
| mem0 (plugin) | Hooks em TODO prompt | ~100-150 tokens **por mensagem do usuário** + banner de sessão | Busca semântica (148 memórias) — ver §4 |

## 4. mem0: ajuda ou atrapalha? (avaliação honesta desta sessão)

**Neste projeto, hoje, é redundância que custa mais do que entrega.** Evidência: numa sessão longa e densa (3 arcos de trabalho), o sistema nativo (MEMORY.md + CLAUDE.md + vault) respondeu 100% das necessidades de recall; a busca semântica do mem0 não foi necessária nenhuma vez — mas seus hooks injetaram lembretes em **cada** mensagem do usuário, e o banner/instruções a cada sessão. A redundância também cria risco de divergência (dois lugares para a mesma regra).

**Recomendação:** escolher UM sistema como fonte de verdade. O nativo+vault é o esqueleto dos rituais ([SALVAR], handoffs, Findings) — é o keeper. Opções para o mem0: (a) desativar o plugin; (b) manter só como busca semântica de arquivo morto, removendo os hooks de UserPromptSubmit (o custo por mensagem é o problema, não a existência). Decisão é do Adilson; nenhum agente deve desativar sozinho.

## 5. Regras práticas para o próximo agente

1. **Anteveja a compactação**: quando a sessão estiver longa, persista decisões imediatamente (handoff doc §-datado) em vez de deixar "pro final".
2. **Pós-compactação, desconfie de si**: re-leia o arquivo antes de citar detalhe; os handoffs 6b–6e do motion editor existem exatamente porque resumo não substitui fonte.
3. **Dois medidores, três tetos**: janela de contexto ≠ orçamento 5h/semana ≠ **limite mensal de gastos** (descoberto em 2026-07-19: subagentes morrem com "monthly spend limit" — checar antes de fan-outs; o loop principal pode continuar funcionando enquanto subagentes falham).
4. **Findings**: no [SALVAR], garimpar contra-ideias do Adilson que venceram → vault `Findings/`.
5. **Pendência registrada**: garimpo nível 2 dos Findings = minerar 26 transcripts (105MB) em `~/.claude/projects/-Users-adilsonporto-Desktop-IA-Uncraft/*.jsonl` — só em sessão dedicada, com orçamento folgado e limite mensal resolvido; pré-processar com `jq` (extrair mensagens de usuário + contexto adjacente) antes de ler com LLM.
6. **Pendência registrada**: compactação editorial do CLAUDE.md (itens antigos → ponteiros) — corta o maior custo fixo por sessão.
