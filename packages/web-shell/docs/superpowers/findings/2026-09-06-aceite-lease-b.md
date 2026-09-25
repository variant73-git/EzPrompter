# Aceite do lease B — medido ao vivo (2026-09-06)

A concessão renovável (lease B) foi provada ponta a ponta em **Chrome de marca**,
dirigindo o produto real: login assinado para o usuário 1, node de clone nativo
do farmminerals produzido pelo `/reconstruct` real (34s, 275 créditos debitados),
e o editor aberto sob a flag `UNCRAFT_RUNTIME_LEASE=1` com HTTPS local
(`*.rt.localtest.me` via mkcert + caddy).

## A cadeia funciona
`runtime-session` (mode:lease) → `runtime-bootstrap` (303 + `__Host-rt`) →
`/api/rt` (200, bridge injetado, 709 KB). No iframe real: **bridge conectado,
título "CropTab™…", 70 imagens, 44 scripts, 294 requisições / 17,7 MB** servidos
do host HTTPS por sessão com o cookie. A ferramenta abre o clone animado sob a
concessão.

## A régua de aceite: reload re-paga o pacote?
Mesmo clone, mesmo Chrome, medindo os **bytes de rede** (`encodedDataLength` via
CDP no frame do runtime — o iframe é OOPIF, o CDP do topo não o vê) num **reload
do iframe no lugar**:

| modo | reload (bytes no fio) | requisições |
|---|---|---|
| **Legado (iframe opaco)** | **~20.451 KB (20 MB)** | 674 do servidor |
| **Concessão (origem própria)** | **~700–990 KB** (variância) | 695 do cache |

**Redução de ~25–30× no reload.** Os ~20 MB de assets vêm todos do cache de
disco na origem própria; só o **HTML de sessão** (~700 KB, `no-store` porque
carrega o bridge + o manifesto) re-paga a cada reload. Isso confirma a tese
econômica: a concessão transforma o custo de "por reload de pacote inteiro" em
"por sessão + um HTML por reload".

## Ressalvas honestas
- **Métrica = BYTES, não contagem.** As ~696 requisições que "batem no servidor"
  no reload da concessão são majoritariamente **revalidações 304** (Edge Request
  barata, ~0 bytes de corpo). O que a conta de custo mede é Data Transfer, e é
  aí que os 20 MB → ~0,7 MB.
- **Alcance: Chrome.** Safari e Firefox seguem abertos (mesma ressalva do finding
  de 25/08 — os instrumentos do Playwright falham nos próprios controles).
- **Ambiente:** dev com HTTPS local; a topologia de produção (eTLD+1 do runtime
  separado do app, wildcard DNS/cert no Vercel) ainda não foi exercida.

## Resíduos a investigar (não bloqueiam)
- **304 apesar de `immutable`.** Os assets vão com `Cache-Control: private,
  max-age=<restante>, immutable`, mas o reload ainda os revalida (304) em vez de
  usar direto do cache. `immutable` deveria evitar a revalidação. Fechar isto
  levaria o reload de ~0,99 MB para ~0,7 MB (só o HTML). Otimização, não bloqueio.
- **Editor completo em modo lease.** `editor.js` pede `/editor-core/*.css/.js`
  na ORIGEM DO RUNTIME (onde o host-guard bloqueia; os arquivos moram na origem
  do app) → `net::ERR_ABORTED`. A ponte de MOTION funciona; o editor completo
  não carrega os assets dele sob a concessão. A investigar.
- **Refs com `%2F`** (barra codificada) caem no CSP: reescrita de referência
  incompleta (resíduo já conhecido do produtor).
- **amigosecreto**: a captura pendura na fase de coleta sem timeout (defeito de
  classe, deal-breaker separado — ver `reminder_challenge_modal_style`).

## Harness
`scripts/medir-entrega-runtime.mjs` — exige Chrome de marca (`channel:'chrome'`;
Chromium do Playwright tem particionamento desligado e dá falso). Página-pai em
`public/_aceite-lease-parent.html`, servida pela origem do app (frame-ancestors).
Auto-attach de CDP no frame do runtime; prova positiva de render (`naturalWidth`).
Inputs: `BASE_URL`, `E2E_COOKIE`, `NODE_ID`.
