# Verificação de bot via Steel.dev — PROVADO VIVO (2026-09-20)

**Spec:** `docs/superpowers/specs/2026-09-08-challenge-remote-browser-design.md` (raiz).
Substitui o finding "BLOQUEADO" de 08/09 — a chave chegou (Steel, camada grátis).

## Resultado: o deal-breaker do amigosecreto está resolvido pelo caminho AUTOMÁTICO
Fluxo inteiro provado ao vivo contra o site Cloudflare real, na **camada grátis do
Steel (100h/mês), SEM o solver pago**:
- Sessão Steel criada; nosso `connectUrl` (`wss://connect.steel.dev?apiKey=&sessionId=`)
  autenticou o Playwright via CDP.
- `verifyTarget` → **`clean` em 5,4s**: o managed challenge da Cloudflare se limpa
  sozinho no navegador do Steel (como no de uma pessoa). Título real "Amigo
  Secreto — o site oficial do sorteio", 5633 chars (não a interstitial).
- `captureNativeBundle` na MESMA sessão emprestada → **104 arquivos, 3,6 MB, 0
  descartes, 23,7s**, engines detectados. Controle: farmminerals também `clean`.

⭐ **Os US$10 do solver NÃO foram necessários** para este site — o managed
challenge passa com o stealth padrão do Steel. O solver pago é fallback para
captcha mais duro (Turnstile interativo, hCaptcha), não para managed challenge.

## Camada grátis: o que 403 (medido)
`solveCaptcha:true` e `useProxy:true` → **403 "requires at least $10 in paid
balance"**. As 100h grátis navegam sem solver/proxy. Por isso o solver é opt-in
(`UNCRAFT_CHALLENGE_SOLVER=on`, só ligar COM saldo); por padrão não pedimos, e o
site clona mesmo assim.

## Portão de revogação do visualizador (Task 13): PASSA
- Viewer interativo: `${debugUrl}?interactive=true` (o `debugUrl` é
  `.../v1/sessions/<id>/player`). Modo só-leitura: `interactive=false`.
- ⚠️ O viewer é **não-autenticado por design** (segredo portador) → tratado com
  `no-store` + `Referrer-Policy: no-referrer`, entregue só ao dono em needs_human.
- **`REQUEST_RELEASE` revoga a sessão INTEIRA** (medido): reconexão CDP recusada
  (404), status `released`. Como o job service libera a sessão em todo estado
  terminal, o controle do humano É revogável. Não há revogação por-viewer sem
  matar a sessão, mas matar a sessão está disponível e é efetivo; `interactive=
  false` cobre o caso "mostrar sem deixar controlar".
- Veredito: o **modo humano pode ser ligado** (`UNCRAFT_CHALLENGE_HUMAN=1`) com
  segurança aceitável no modelo de ameaça atual (site adversarial fora de escopo;
  é o próprio viewer do dono). Fica **0 por padrão** — decisão de produto do
  Adilson liga quando quiser; não é necessário para managed-challenge como o
  amigosecreto (que passa no automático).

## Fatos da API que o cliente fixou (medidos, não da doc)
- Header `steel-api-key`; `POST /v1/sessions` com **`timeout` (ms)** + `dimensions`
  (NÃO `sessionTimeout`). Resposta: `id`, `websocketUrl` (com `token`), `debugUrl`.
- Release: `POST /v1/sessions/<id>/release`.

## Resíduos nomeados
- Taxa de passagem só medida no amigosecreto + farmminerals; outros sites/
  Turnstile podem exigir o solver pago (então `UNCRAFT_CHALLENGE_SOLVER=on` + saldo).
- e2e via a ROTA HTTP autenticada (POST /nodes/:id/challenge → job → capture) não
  rodou (exige servidor + user + node, como o aceite do lease); o e2e provado
  aqui é no nível do produtor (verify+capture na sessão emprestada), que é o
  trecho novo. A rota é fina e coberta por teste de unidade.
