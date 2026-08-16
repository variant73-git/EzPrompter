# Seek silencioso — o fix óbvio está ERRADO; é fork de produto (2026-08-07)

> Status: **nada shipado, árvore limpa** (o fix foi aplicado, auditado, REFUTADO
> por medição e revertido). Evidência preservada em dois probes.
> Decisão pendente do Adilson.

## O defeito (real, confirmado)

`seekTimeline` (`lib/motion-editor/runtime-bridge-source.js:7475`) é a **única
das 23 escritas de relógio do bridge** que não suprime eventos — as outras 22
passam `true`. Chega ali por `seek-motion`, enviado de dois lugares, ambos
INSTRUMENTAIS: o usuário arrastando o playhead
(`useNativeMotionController.js:1744`) e o replay de estado no recovery do
runtime (`:736`).

Medido no GSAP 3.15 real (`_probe-seek-callbacks.mjs`): um scrub de 10 posições
dispara `onUpdate` 10× **e o `onComplete` do site clonado** — o site "termina" a
animação porque alguém arrastou uma barra no editor. Em site real isso encadeia
animação, troca classe, dispara analytics. Contraria a regra de **editor
silencioso** aprovada em 2026-08-06.

⚠️ Nota de método: o primeiro grep que usei era **cego à forma `?.()`** e não
enxergava a própria linha do defeito — teria concluído "não há problema".

## Por que o fix óbvio está errado

Trocar `false` por `true` silencia, sim (0 disparos, e o valor renderizado do
alvo fica idêntico). **Mas quebra render DERIVADO** — animação cujo único output
visível é escrito DENTRO do `onUpdate`.

Padrão REAL no repo: `Clone/index.html:1159` anima `frameObj.frame` (objeto
simples, não DOM) e desenha o quadro no canvas dentro do `onUpdate` — sequência
de imagens. Medido (`_probe-seek-derived-render.mjs`):

| | propriedade animada | render derivado |
|---|---|---|
| com eventos (hoje) | 60 | 60 |
| suprimido (o "fix") | 60 | **nunca desenhou** |

Ou seja: arrastar o playhead mostraria imagem congelada. Troca um bug por outro,
e o novo é mais visível.

## A raiz: `onUpdate` tem dois papéis, e o GSAP não os separa

- **Motor de render** — desenhar o quadro. PRECISA rodar no scrub.
- **Efeito colateral de ciclo de vida** — encadear, trocar estado, medir.
  NÃO pode rodar no scrub.

`suppressEvents` é tudo-ou-nada. Já `onStart`/`onComplete`/`onRepeat` são
inequivocamente ciclo de vida — são esses que machucam.

## Caminhos possíveis (nenhum escolhido)

1. **Supressão seletiva**: antes do seek, guardar e anular só
   `onComplete`/`onStart`/`onRepeat` em `vars`, seekar COM eventos (o `onUpdate`
   segue desenhando), restaurar depois. Dá a semântica exata desejada.
   **Custo/risco**: mexe em `vars` do site, e esta frente tem uma malha inteira
   (proveniência congelada, tokens, binding) que existe justamente para detectar
   mudança de forma em `vars`; reentrância e restauração sob exceção também
   precisam de desenho. É trabalho de sessão, não patch.
2. **Deixar como está** e aceitar o disparo espúrio no scrub.
3. **Classificar** motions que dependem de callback como não-editáveis por scrub
   (fail-closed), preservando a regra onde ela vale.

## Achados do Sol que seguem ABERTOS

- **O ramo `browser` (CSS/WAAPI) também escapa**: `seek-motion` roteia animações
  CSS para `pause(); currentTime = time`, e a spec prevê `animationstart`/
  `animationiteration`/`animationend` durante seek. WAAPI **não tem**
  `suppressEvents` — então a regra de editor silencioso pode não ser alcançável
  ali sem outra estratégia. Não investigado.
- **O teste que escrevi era fraco**: verificava que um mock recebeu `true`, sem
  observar evento ou render reais. E eu afirmei ao Sol que o probe estava
  "incluso no diff" — **errado**, era untracked e `git diff` não o inclui.

## Recomendação

Levar o fork ao Adilson (com advise do Sol, pelo padrão do Finding de 2026-08-06)
antes de qualquer implementação. A pergunta de produto é: **"editor silencioso"
significa silenciar tudo, ou apenas os efeitos de ciclo de vida, deixando o
`onUpdate` desenhar?** A segunda leitura é a que preserva o clone fiel — e é
alcançável, mas custa a supressão seletiva do caminho 1.
