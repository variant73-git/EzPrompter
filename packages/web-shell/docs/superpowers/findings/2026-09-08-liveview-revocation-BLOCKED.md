# Portão de revogação do visualizador ao vivo — BLOQUEADO (falta a chave do fornecedor)

**Spec:** `docs/superpowers/specs/2026-09-08-challenge-remote-browser-design.md` §4.6 (raiz do repo)
**Plano:** Task 13.
**Data:** 2026-09-08.

## Estado
BLOQUEADO. O probe (`packages/web-shell/scripts/probe-liveview-revocation.mjs`) e
todo o fluxo de challenge estão construídos e testados (Tasks 1–12, suíte verde,
`next build` OK), mas a prova ao vivo e o veredito de revogação exigem
a chave do fornecedor (Steel `STEEL_API_KEY` ou Browserbase), ainda não fornecida.

## O que o probe decide (quando a chave existir)
Se um visualizador JÁ ABERTO continua controlando a sessão depois de (A) uma
checagem nossa e (B) `REQUEST_RELEASE`. Se sim em qualquer um → **não há
revogação real** → `UNCRAFT_CHALLENGE_HUMAN` fica **0** em produção (só o
caminho automático do solver é liberado; o modo humano espera revogação real,
via gateway de controle autenticado ou equivalente). O default do código já é
`0`, então o sistema é seguro-por-omissão até este portão passar.

## Prova viva pendente (Task 13 Steps 2–3, também gated pela chave)
1. `amigosecreto.curriculum.com.br` pelo caminho AUTOMÁTICO → node vira
   referência sem clique; Edit → editor abre. Screenshot do editor aberto.
2. Controle: `www.farmminerals.com/promo` clona pelo caminho barato SEM criar
   job (`SELECT COUNT(*) FROM challenge_jobs` inalterado).

## Como desbloquear
Pôr a chave no `.env.local` do web-shell e rodar o probe + a prova viva.
- **Steel** (recomendado): `UNCRAFT_CHALLENGE_VENDOR=steel` + `STEEL_API_KEY=` —
  100 horas grátis/mês, solver de captcha incluído, viewer interativo. ⭐ Nota:
  o viewer do Steel aceita `?interactive=false` (só leitura) — pode ser a
  meia-revogação (tirar o controle sem matar a sessão) que o portão procura;
  testar isso É parte do probe.
- **Browserbase**: `UNCRAFT_CHALLENGE_VENDOR=browserbase` + `BROWSERBASE_API_KEY`
  + `BROWSERBASE_PROJECT_ID` (Developer, US$20/mês).
