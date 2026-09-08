# Sites com verificação de bot (Cloudflare & cia.) — navegador remoto com visualizador ao vivo

**Data:** 2026-09-08 · **Ramo de origem:** `feat/runtime-lease-b` · **Status:** design aprovado pelo Adilson (2026-09-08), aguardando revisão da spec escrita.

## 1. Problema

Sites atrás de uma verificação de bot (Cloudflare "Just a moment…", Turnstile, hCaptcha, Akamai, PerimeterX) entregam ao nosso navegador de servidor uma **interstitial** em vez do site. Hoje:

- A captura de referência detecta a interstitial e abre o popup "Human verification needed", cujo único caminho de volta é a **extensão** (que serializa o DOM SEM scripts — inútil para o clone animado). Sem extensão, "Open site" abre uma aba e nada acontece: **beco sem saída** (deal-breaker relatado em 2026-09-05).
- O Edit (clone nativo pago) recusa com `challenge_required` tipado (shipped em `90f80d16`), mas não oferece caminho nenhum.

Medido em 2026-09-06 no `amigosecreto.curriculum.com.br`: a interstitial persiste 45s+ no navegador de servidor; no navegador de uma pessoa ela **se limpa sozinha em 1–3s**, sem captcha visível.

## 2. Decisões de produto (Adilson, 2026-09-06/08)

1. **Sem extensão.** Ninguém instala nada; funciona em qualquer navegador.
2. **Sem sair do canvas.** A pessoa não abre aba nem popup; tudo acontece no node.
3. **Um mecanismo** para a captura de referência (grátis) e para o Edit (pago).
4. **Cobrança igual ao clone normal** (Edit ≈ 275 créditos), **cobrada só quando o pacote chega**; falha, cancelamento ou tempo esgotado = zero cobrado.
5. Quando a pessoa precisar agir: **aviso em inglês com botão OK**, e o captcha é resolvido **dentro do node**.
6. Texto de produto em inglês.

## 3. Solução em uma frase

Inverter quem verifica: em vez de a pessoa abrir o site no navegador dela, **o nosso navegador na nuvem (Browserbase)** abre o site; o serviço passa sozinho pelas checagens comuns; se sobrar um captcha de clicar, a pessoa vê **esse navegador ao vivo dentro do node** e clica ali. A liberação da Cloudflare fica no navegador que vai clonar — o mesmo produtor de hoje captura em seguida.

Por que não os outros caminhos (registrado para não reabrir): iframe do **site** é impossível (a Cloudflare recusa rodar em iframe de outra origem; cookie particionado entraria em loop); extensão com depurador funciona, mas exige instalação, permissão `debugger`, popup, upload direto ao Blob e um segundo coletor — ~70% mais superfície (fica documentada como alternativa); mandar o cookie de liberação para o servidor não vale (a Cloudflare o amarra ao IP).

## 4. Arquitetura

### 4.1 Escada de escalada (por tentativa)

1. **Caminho barato de sempre** (Chromium local em dev / o navegador padrão em prod) — como hoje. Detecta interstitial → passo 2.
2. **Uma sessão Browserbase nova**, solver automático ligado, **sem proxy** por padrão. Espera até `SOLVER_TOLERANCIA_MS = 40_000` por um documento limpo e carregado (o detector estrito de `capture-bundle.js`, com a tolerância elevada: hoje são 5s, curto para o solver documentado em 5–30s).
3. **Humano** (atrás de flag — ver 4.6): interstitial ainda presente com um captcha **acionável** → job em `needs_human`; o canvas embute o visualizador; o servidor **confere** que a página ficou limpa (nunca acredita no cliente).
4. **Bloqueio duro** (sem captcha resolvível, `Access denied`, 403 sem interstitial) → job `unsupported` com mensagem honesta: *"This site blocks automated capture."*

Política de proxy é **configuração** (`UNCRAFT_BROWSERBASE_PROXY=off|on`), não escalada automática no lançamento; a taxa de passagem sem proxy será medida num conjunto de sites protegidos antes de decidir o padrão. Se um dia houver escalada com proxy, ela acontece **antes** de pedir o humano e **nunca** troca o IP depois que ele resolveu (a Cloudflare invalida a liberação se o IP muda).

### 4.2 O job (`challenge_jobs`) — nenhum request espera uma pessoa

Tabela nova (migração + reconciliação no `schema.sql`, padrão do repo):

| coluna | tipo | nota |
|---|---|---|
| `id` | uuid pk | |
| `user_id`, `board_id`, `node_id` | | dono; toda rota autoriza contra a linha, nunca por id vindo do cliente |
| `purpose` | `'reference' \| 'edit'` | |
| `target_url` | text | **imutável** desde a criação |
| `generation` | int | cerca: cada retomada incrementa; commit só com a geração corrente |
| `status` | enum | `verifying → ready → capturing → committing → succeeded`; `needs_human` entre `verifying` e `ready`; terminais `failed`, `expired`, `cancelled`, `unsupported` |
| `bb_session_id`, `bb_page_id` | text | ids do vendor; **credenciais/URLs de conexão nunca gravadas** |
| `idem_key` | text | etiqueta de idempotência da operação de Edit (mesma da rota `/reconstruct`) |
| `human_deadline_at`, `session_expires_at`, `lease_until`, `lease_owner` | timestamptz/text | prazos e trava curta de controlador |
| `error_code` | text | vocabulário fechado |
| `created_at`, `updated_at` | | |

Regras:
- **Uma sessão por job, nunca partilhada** entre usuários ou jobs. Sessão criada com `keepAlive:true`, `timeout` explícito (orçamento: até 5 min de humano + partida/fila + ~3 min de captura ⇒ `api_timeout = 600s`), `browserSettings.solveCaptchas:true`, `recordSession:false`, `logSession:false`, `viewport {1440,900}`, `allowedDomains` = eTLD+1 do alvo (+ hosts de redirect legítimos observados no passo 1), `userMetadata {jobId}`.
- **Trava de controlador** (`lease_until`): só um processo conecta ao navegador por vez (verificação, checagem humana, captura). Sem isso dois controladores disputam a mesma página.
- **Expiração e limpeza**: `session_expires_at` é o teto do vendor; varredura no cron existente (`/api/cron/reconcile-holds` ganha um passo) libera sessões de jobs não-terminais vencidos (`REQUEST_RELEASE`) e os marca `expired`. Liberação explícita em todo estado terminal.

### 4.3 Rotas

| rota | auth | função |
|---|---|---|
| `POST /api/nodes/[id]/challenge` `{purpose}` | cookie | cria o job **só depois** de (a) cota grátis/concorrência (4.5), (b) no Edit: pré-checagem de saldo (402 na hora) e etiqueta de idempotência obrigatória; cria a sessão; dispara **uma** verificação limitada (≤ 45s) no mesmo request; responde o estado |
| `GET /api/challenge-jobs/[id]` | cookie + dono | estado + (em `needs_human`, se a flag permitir) a **URL do visualizador da página** (`pages[].debuggerFullscreenUrl`), `Cache-Control: no-store` |
| `POST /api/challenge-jobs/[id]/check` | cookie + dono | em `needs_human`: reconecta (com trava), confere documento limpo + URL esperada, desconecta; `ready` ou continua |
| `POST /api/challenge-jobs/[id]/capture` | cookie + dono | `ready → capturing` atômico (cerca por geração); roda a captura **no mesmo request** com prazo interno < `maxDuration` (300s) deixando margem para persistir; `purpose=edit` → `reconstructSiteNode({producer: sessão emprestada})`; `purpose=reference` → `captureSnapshot` com a sessão emprestada; `succeeded` + libera |
| `POST /api/challenge-jobs/[id]/cancel` | cookie + dono | terminal `cancelled` + libera |

O canvas consulta `GET` a cada 3s e **dispara** `check`/`capture` conforme o estado (o cliente observa e aciona; não é dono da execução — reentrada é recusada pela cerca). Resíduo nomeado: sem fila durável, um `capture` que morrer no meio deixa o job em `capturing` até a varredura marcá-lo `expired`; a pessoa vê "Capture failed — try again" e nada é cobrado.

### 4.4 O produtor com **sessão emprestada**

`captureNativeBundle(url, { session })` e `captureSnapshot(url, { session })` ganham uma entrada opcional `session = { browser, context, page, owned:false }`:

- usam o **contexto/página da sessão** (a liberação vive ali; contexto novo a descartaria) em vez de `newContext()`;
- **não fecham** o que não é deles: em `finally`/cancelamento, sessão emprestada → apenas desconecta (`browser.close()` no cliente CDP desconecta sem matar a sessão remota; a liberação do vendor é responsabilidade do job); sessão própria → fecha como hoje;
- **partida limpa**: registram o interceptador e então navegam para a `target_url` na página verificada (recarga com o cookie de liberação) — os eventos anteriores à conexão não existem;
- **repescagem pelo navegador**: hoje `buscarUmaVez` usa `fetch` do Node (sem cookie nem IP da sessão — achado do Astra). Com sessão emprestada, a repescagem passa por `context.request.fetch` (mesmo jar e egress), mantendo os tetos de bytes/saltos/tempo; o que não vier fica **nomeado** no relatório como hoje.

Sem `session`, comportamento idêntico ao atual (o produtor lança o próprio navegador). Isto é o único toque no núcleo provado.

### 4.5 Cobrança, cotas e disjuntores

- **Edit**: nenhuma reserva ao criar o job; a **captura** roda dentro do `runBilledOperation` existente com a `idem_key` do job → cobra só no sucesso; falha = `charge 0`; re-execução com a mesma etiqueta = replay. Pré-checagem de saldo ao criar o job evita a dança para terminar em 402.
- **Referência**: grátis, mas **cota**: `N` verificações por usuário por dia (env, padrão 10) e `M` jobs não-terminais por usuário (padrão 2).
- **Concorrência da conta**: teto de sessões simultâneas total (env, padrão 10 no plano Developer de 25) **reservando** parte para Edit pago; acima do teto → `429 verification_busy` honesto.
- **Disjuntor de gasto**: contador de sessões e minutos por dia (tabela de uso simples); estourado → o caminho fica `unsupported` até o dia virar, com alerta em log. Banda de proxy (se ligado) é medida no relatório do vendor, não no pacote (o pacote não limita o tráfego).

### 4.6 Visualizador ao vivo — segurança e portão de lançamento

O iframe embute o **visualizador** do vendor (`debuggerFullscreenUrl` da página do job), não o site; é um **controle remoto** do navegador, não uma imagem.

- A URL é **segredo portador**: entregue só ao dono, só em `needs_human`, `no-store`, nunca em logs/analytics/referrer (`Referrer-Policy: no-referrer` no canvas ao abrir); nunca a resposta de debug inteira nem `connectUrl`.
- Iframe com `sandbox="allow-scripts allow-same-origin allow-pointer-lock"` (sem popups, downloads, top-navigation), `allow` mínimo; mensagens do iframe validadas por `origin` **e** `source`; `browserbase-disconnected` encerra o modo humano.
- Nada nosso dentro do navegador remoto: sem cookies do app, sem páginas internas. `allowedDomains` restringe a navegação principal (não subframes/XHR — não é firewall).
- **PORTÃO (spike obrigatório antes de expor o humano):** provar se um visualizador **já aberto** perde o controle quando queremos (revogação real). Sem revogação comprovada, o lançamento é **só automático** (passos 1, 2 e 4 da escada); o modo humano fica atrás de `UNCRAFT_CHALLENGE_HUMAN=1`. Uma pessoa digitando credenciais num navegador que ela não controla depois é exposição de dado de usuário — dentro do modelo de ameaça.

### 4.7 Canvas

- Estados no node (rótulos em inglês): *Verifying site…* → *Preparing editable site…* → editor; ou *This site needs a quick check* + **OK** → visualizador embutido no lugar do preview (mesma moldura do node) + *Waiting for you to pass the check…* → segue sozinho quando `ready`.
- Terminais: *Verification cancelled*, *Verification timed out — try again*, *This site blocks automated capture*, *Capture failed — nothing was charged* (código tipado do servidor, nunca leitura de mensagem).
- `ChallengeModal` atual é substituído pelo aviso novo; o registro na extensão e o "Complete capture" do widget **saem**; o polling antigo de handoff sai. Cancel = `cancel` do job (o node fica como estava; sem placeholder para apagar no Edit).

### 4.8 Sequência (caso comum, Edit)

```
canvas → POST /reconstruct ──409 challenge_required──▶ canvas
canvas → POST /nodes/:id/challenge {purpose:'edit'}
   servidor: saldo ok? cota ok? → job(verifying) → sessão BB → conecta → goto → espera limpo ≤45s
   ├─ limpo → job(ready) → resposta {status:'ready'}
   ├─ captcha acionável → job(needs_human) → resposta {status:'needs_human'}
   └─ bloqueio duro → job(unsupported) + libera
canvas (ready) → POST /challenge-jobs/:id/capture
   servidor: ready→capturing (cerca) → reconstructSiteNode({producer: captureNativeBundle(url,{session})})
             → registra pacote → snapshot native-bundle → controles → cobra → succeeded → libera
canvas → node native-ready → enterEditMode
```

## 5. Testes e prova

1. **Produtor com sessão emprestada** (Chromium real, sem vendor): a captura usa a página dada, não fecha o navegador emprestado, repescagem passa pelo contexto (cookie da sessão chega ao servidor de teste), saída byte-idêntica à do caminho próprio para a mesma fixture.
2. **Detector**: tolerância parametrizada; interstitial que se limpa aos 20s passa; que persiste 45s recusa (fixtures do `capture-hazards.integration.test.js`).
3. **Máquina de estados** (unidade, SQL mockado): transições válidas/inválidas, cerca por geração, trava de controlador, prazos, terminais liberam sessão, `unsupported` sem cobrança.
4. **Rotas**: auth por dono, cotas/429, pré-checagem 402, `capture` idempotente (replay), falha = `charge 0`, `no-store` na URL do visualizador, visualizador ausente sem a flag.
5. **Vendor (gated por `BROWSERBASE_API_KEY`)**: criação/liberação de sessão; `allowedDomains`; **spike de revogação do visualizador** (portão 4.6) com resultado escrito em finding.
6. **Prova viva**: o programa aberto no `amigosecreto.curriculum.com.br` pelo caminho automático (foto do editor aberto) e num site sem verificação (caminho barato inalterado: farmminerals, 365 arquivos, 0 descartes).
7. Auditoria Astra a cada tarefa substantiva; achados reproduzidos antes do fix.

## 6. Fora de escopo (nomeado)

- Fila durável para o passo de captura (resíduo em 4.3).
- Escalada automática com proxy (política manual no lançamento).
- Suporte a captchas fora do padrão do vendor (`captchaImageSelector`), páginas autenticadas do usuário, teclado virtual em celular.
- Caminho da extensão (documentado como alternativa; não construído).
- Cap de 8 MB da rota de upload do editor vs limite de 4,5 MB da Vercel — risco pré-existente, registrado, fora desta frente.

## 7. Pré-requisitos externos

- Conta Browserbase com plano pago (Developer, $20/mês, 100h, solver automático; proxies $12/GB) e `BROWSERBASE_API_KEY` + `BROWSERBASE_PROJECT_ID` no `.env.local` — sem eles, tudo é construído e testado; só a prova viva e o spike de revogação ficam bloqueados.

## 8. Referências

- Medições e fixes dos hazards: `docs/superpowers/findings/…` e checkpoint `2026-09-06_amigosecreto-dois-hazards`.
- Advise Astra (gpt-6-astra) 2026-09-08: escolha de B; job persistido; visualizador = controle remoto; repescagem pelo navegador; tolerância do solver; custos de banda/concorrência.
- Browserbase: Sessions API (`keepAlive`, `api_timeout` 60–21600s, `browserSettings.{solveCaptchas,allowedDomains,recordSession,logSession,viewport}`, `REQUEST_RELEASE`), Live View (`debuggerFullscreenUrl`, `pages[]`, iframe interativo), captcha solving (5–30s; eventos `browserbase-solving-started/finished`).
