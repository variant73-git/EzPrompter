# Finding — a porta do ScrollTrigger está aberta (2026-08-10)

**Origem:** handoff `2026-08-10-tudo-que-ficou-aberto-handoff.md` §2.1 — "portas nunca
medidas". Este documento fecha o **primeiro passo honesto** que aquele handoff pediu:
medir, antes de qualquer desenho de solução.

**Instrumento:** `packages/web-shell/_probe-scrolltrigger-scrub.mjs` — Chromium real,
GSAP 3.15 e ScrollTrigger 3.15 reais (os da fixture do clone), bridge de produção
carregado pelo protocolo v2 (negotiate + `scroll-to`), 6 casos.

**Zero código de produção.** Nada foi desenhado, nada foi consertado.

---

## 0. A pergunta

O seek silencioso (item 178) cerca a **escrita de relógio** (`seekTimeline`): anula
temporariamente os slots dos quatro callbacks de ciclo de vida em `vars` do GSAP e
mantém o `onUpdate` vivo, porque é ele que desenha.

Mas a régua do editor **também rola a página** — é o modelo de "régua única" da frente.
Esse caminho é outro: o comando `scroll-to` do bridge faz
`window.scrollTo(0, target)` **cru** ([runtime-bridge-source.js:8035-8038](../../../packages/web-shell/lib/motion-editor/runtime-bridge-source.js#L8035-L8038)).
Nada ali é cercado. E o ScrollTrigger tem callbacks próprios, que o seek silencioso não toca.

Se a regra de produto é "o editor é silencioso", esta porta pode furá-la inteira.

---

## 1. O que foi medido

### C1 — o scrubber DISPARA ciclo de vida de ScrollTrigger

Comandos `scroll-to` válidos do bridge, num scroller nativo, disparam **seis classes**.
Contagens do braço, percorrendo topo → dentro → além do fim → dentro de novo → topo:

| classe | disparos **pela rolagem do bridge** |
|---|---|
| `onEnter` | 2 |
| `onLeave` | 1 |
| `onEnterBack` | 1 |
| `onLeaveBack` | 1 |
| `onToggle` | 5 |
| `onUpdate` | 5 |
| `onRefresh` | **0** |

⚠️ **Atribuição:** `onRefresh` **não vem da rolagem** — vem do `refresh()` explícito, que
o probe chama separadamente e contabiliza à parte (`1`). Somar os dois daria ao scrubber
um crédito que não é dele. Este é um achado do Sol contra a primeira redação deste
documento.

O braço de controle (a **mesma** trajetória, por rolagem direta, em elemento próprio) viu
> 0 em cada uma das sete classes — é isso que torna os números legíveis.

> ⚠️ Este é o achado que importa: **a garantia "o editor é silencioso" não vale no
> caminho da rolagem.** Ela nunca valeu; ninguém tinha medido.

**Escopo exato:** mensagens válidas do bridge, scroller nativo (`window`), um destino por
comando. Não é um E2E do arrasto real da régua — é **prova de existência neste harness**.

### C2 — o dano sobrevive ao arrasto

Um `onEnter` do site que dispara `gsap.to` numa terceira vítima continuou avançando
**depois** do último comando: x `0 → 15,6` durante o arrasto `→ 250` meio segundo depois.
**Sem movimento observado nas 22 amostras periódicas** de `scrollY` ao longo dessa espera
(mín. = máx. = 3950) — amostrar só as pontas não excluiria uma ida-e-volta no meio.

**Escopo exato:** o dano medido é **visual** (um `transform`). Rede, áudio,
armazenamento, foco e mutação de DOM **não foram medidos** — dizer "não é cosmético"
seria exceder a medição.

### C3 — a técnica do seek silencioso NÃO transfere

Anular `st.vars.onEnter` **não suprime** o disparo (controle 1, com o slot anulado 1).
Trocar por uma função **distinta** ainda dispara a **original** (original 1, trocada 0).
`ScrollTrigger.refresh()` **não relê** `vars`. E `st.onEnter` é `undefined` — não há
cópia pública no objeto.

A forma do slot engana: `st.vars.onEnter` é próprio, enumerável e gravável — parece
exatamente o alvo do seek silencioso. **Só que ele deixou de ser a verdade**: o
ScrollTrigger captura o callback antes do despacho.

**Escopo exato:** medido para `onEnter`, nesta forma autoral. Nada afirmado sobre os
demais callbacks nem sobre o resto de `vars`. Esta rota também **não separa** "capturado
na criação" de "capturado no primeiro refresh" — `create()` já inicializa e refresca
antes de devolver a instância.

### C4 — `disable`/`enable` não serve como está

Com todos os triggers em `disable(false, true)`, as **seis classes de arrasto** — as
mesmas que o controle exercitou na mesma trajetória — ficaram em **zero**. Mas o
`scrub:true` testado **não desenhou**: x `0 → 0`, quando o controle na mesma construção
fazia `0 → 150`.

Depois do `enable(false, true)`, o desenho **não havia recuperado após quatro quadros**
(x `0`, esperado ≈ `150`); recuperou (`150,39`) depois de uma intervenção **combinada** —
`+1px`, `ScrollTrigger.update()` e mais tempo, os três confundidos. Qual dos três resolve
**não está separado**.

⚠️ **Uma acusação minha caiu na medição.** Eu havia escrito que o `enable` "dispara o que
estava represado". O discriminador — um `disable`/`enable` **sem rolagem no meio**, onde
não há nada represado por construção — dispara **exatamente o mesmo, classe por classe**:
`{onRefresh: 1, onRefreshInit: 1}` nos dois braços, e zero em todas as outras. Logo o
disparo é do próprio `enable` (ele refresca), **não** é rolagem engolida sendo devolvida.

(Este predicado começou frouxo — eu testava só `> 0`, o que seria compatível com haver
represamento **por cima** do disparo do `enable`. A igualdade por classe é exigência da
terceira rodada do Sol.)

Ou seja, o que sustenta rejeitar o mecanismo é só isto: cala o ciclo de vida **matando
junto exatamente o que a régua precisa manter vivo**, e o desenho não volta sozinho.

**Escopo exato:** `scrub: true`. Nada afirmado sobre `allowAnimation` com scrub
**numérico** (onde o parâmetro tem efeito real), nem sobre `kill`, nem sobre
`ScrollTrigger.config({limitCallbacks:true})`. `onRefresh`/`onRefreshInit` ficam fora da
conta do arrasto — nenhuma trajetória lhes dá oportunidade; eles pertencem à pergunta do
`enable`, que tem o controle próprio acima.

### C5 — NÃO afirmada

**Não sei se existe mecanismo que cale o ciclo sem matar o desenho.** Duas tentativas
óbvias foram refutadas por medição (C3, C4); isso não é o mesmo que "não existe". É a
próxima coisa a medir, não uma conclusão.

---

## 2. O que o instrumento NÃO cobriu

Superfície declarada aberta — **não** são residuais aceitos, são coisas não exploradas.
Levantada em grande parte pela auditoria do Sol.

- **Arrasto real** com cadência, coalescing, ida-e-volta e coexistência com `seek-motion`;
  E2E pela régua de verdade. Aqui foi **um destino por comando**.
- **Callbacks dentro de `scrollTrigger:{...}`** de um tween/timeline — a forma autoral
  mais comum, e a que combina reações do ScrollTrigger com callbacks GSAP da animação
  associada (que caem **fora** da janela do seek silencioso).
- `toggleActions`, `fastScrollEnd`, `preventOverlaps` — atravessar fronteira pode
  iniciar/reiniciar/completar/inverter outra animação.
- `toggleClass`, `pin`, `snap`, `once` — reações que **não passam por callback nenhum**:
  classe pendurada, spacer e geometria alterados, rolagem que continua depois da régua
  parar, e um `once` que o editor pode **consumir** de forma definitiva.
- `batch` e scrub **numérico**: têm janela temporal própria; três ou quatro quadros não
  são quiescência.
- **Scroller customizado, Lenis/ScrollSmoother, `containerAnimation`, `scrollerProxy`** —
  ali `window.scrollTo` pode nem mover o scroller de verdade, e um zero significaria "a
  régua não alcançou o relógio", não silêncio.
- `matchMedia` e criação dinâmica — o snapshot de `getAll()` pode envelhecer no meio.
- Isomorfia geométrica entre controle e arma; ordem AB/BA; construção fria × aquecida.

---

## 3. Auditoria

**Sol (Codex), rodada 1, xhigh: 19 achados.** Quatro eram defeitos que tornavam meus
zeros **vácuos**, e foram corrigidos com medição:

1. os zeros de `onLeave`/`onEnterBack`/`onLeaveBack`/`onRefresh` no caso 1 estavam
   avalizados por um controle **coletivo** ("algum callback disparou") — cada classe
   ganhou trajetória e controle próprios, e o instrumento agora **falha** se alguma
   classe ficar sem oportunidade;
2. o zero de "`refresh()` não relê `vars`" não exigia que alguém tivesse disparado
   naquela segunda travessia — agora exige **exatamente um** positivo;
3. o caso 6 julgava "calou o ciclo" contando **só** `onEnter` — passou a contar oito
   classes, incluindo as de refresh, que é justamente o que o `enable()` provoca;
4. "não recuperou" foi medido **cedo demais** e com critério fraco (`> 0`) — ganhou
   oportunidade posterior e critério forte (**chegar ao valor do controle**), o que
   mudou a leitura: não recupera ao reabilitar, recupera ao cutucar.

Mais dois **overclaims meus**, corrigidos no texto: "capturado na criação" (a rota não
separa criação de primeiro refresh) e "dano não é cosmético" (o dano medido é
literalmente um `transform`).

**Rodada 2, high: mais quatro**, todos de **atribuição**, todos corrigidos no
instrumento (não só na redação):

5. `onRefresh` estava entrando na conta do scrubber, mas vinha do `refresh()` explícito —
   o probe agora congela os contadores **antes** de refrescar e reporta os dois separados;
6. o controle do caso 6 só ia `0 → meio`, então `onLeave`/`*Back` não tinham oportunidade
   — as duas fases passaram a percorrer a **mesma trajetória completa**, e as classes de
   refresh saíram da conta do arrasto por não pertencerem a ele;
7. "disparou o represado" nunca fora discriminado de "o `enable` só refresca" — o
   discriminador foi construído e **derrubou a minha acusação** (ver C4);
8. "página comprovadamente parada" vinha de duas amostras nas pontas — virou amostragem
   periódica (22 amostras).

**Rodada 3, medium: quatro fecham, uma sobrevive** — o predicado do discriminador do
`enable` testava `> 0` quando a conclusão exigia **igualdade**. Corrigido para comparação
por classe; a conclusão sobreviveu à exigência mais forte. Sol pediu também que "página
parada" seja dita como **"sem movimento observado nas 22 amostras"**, e assim está.

O Sol declarou C3 e C5 boas nas três rodadas.

**Placar: 3 rodadas, 24 achados, todos procedentes.** Três correções vieram do próprio
instrumento antes do Sol (o furo de oportunidade do caso 6, e as duas asserções de
legibilidade que passaram a falhar sozinhas). Nenhuma conclusão sobreviveu na forma em que
foi escrita na primeira vez.

O próprio instrumento também pegou um furo meu antes do Sol: a primeira versão do caso 6
rolava até o gatilho de ciclo de vida, que **não alcança** o gatilho do desenho — zero
sem oportunidade, o modo de falha nº 1 desta frente.

---

## 4. Leitura para quem decide

A régua tem uma porta aberta, e ela é **estrutural**, não um bug: o seek silencioso
protege o caminho do relógio, e a régua usa **dois** caminhos. O segundo nunca foi
cercado.

Antes de desenhar qualquer coisa, três medições valem mais que qualquer arquitetura:

1. **A forma autoral que falta** — callbacks dentro de `scrollTrigger:{...}` de um
   tween/timeline. É a mais comum em site real e mistura as duas famílias de reação.
2. **As reações sem callback** — `toggleClass`, `pin`, `snap`, `once`. Se elas doem,
   então **suprimir callbacks não fecha a classe**, e o desenho tem que ser outro.
3. **O scroller real do clone** — se o site usa Lenis/ScrollSmoother, `window.scrollTo`
   pode não ser sequer o caminho verdadeiro, e tudo acima muda de endereço.

E a pergunta de produto que o Adilson decide, não eu: **"o editor é silencioso" vale para
a rolagem, ou a régua é assumidamente uma visita à página?** Hoje o produto promete a
primeira e entrega a segunda.
