# `link.detach` — 5ª e 6ª tentativas REVERTIDAS; o instrumento tem ponto cego aberto (2026-08-02/03)

> **⚠️ LEIA A §0 PRIMEIRO.** A 6ª tentativa consertou tudo que matou a 5ª — e três auditorias
> seguintes acharam mais quatro defeitos. O padrão, não os bugs individuais, é o achado.

## 0b. FIX SHIPADO (2026-08-03): o dano temporal da INSPEÇÃO — o residual §6 — está consertado

`1ada4a7b` — a causa isolada do §6 virou fix de produção, autorizado pelo Adilson como "fix
rápido da causa isolada". **Selecionar um elemento não danifica mais o estado temporal de tweens
com `repeat`/`yoyo`** (antes: yoyo na volta passava a andar pra frente, looping voltava uma
batida, a cada clique). Bônus: as trilhas publicadas agora carregam o início VERDADEIRO (antes
saíam com início "100" para tweens de repetição selecionados numa volta posterior).

Mecânica: salvar/restaurar por `totalTime`; início amostrado por `totalTime(0)`; fim segue
`progress(1)` de propósito (valor "to" autoral). Classe **UNSAMPLEABLE** fail-closed:
`repeatRefresh`/`yoyoEase`/`easeReverse` não podem ser amostrados sem mutar a animação
(medidos: +200px permanente; 75→87,5 numa seleção) → end-only + lock de retarget. Veredito
recursivo descriptor-based sobre vars **+ filhos vivos** da timeline (entrada removida do array
segue renderizando — fato r8), `parent` como backedge (item 170), accessor = terminal opaco sem
dereferência.

Witness: `_probe-inspect-witness.mjs` (9 casos, página selecionada vs referência nunca
selecionada, dano medido nos 2 ticks seguintes; 27 RED contra o shipado antigo). **Audit Sol,
9 rodadas: 5 achados dele REPRODUZIDOS e corrigidos** — incluindo `easeReverse`, que corrige um
"não reproduzido localmente" desta mesma frente (§ registro da 5ª tentativa: o probe de lá não
tinha a forma certa) — + 3 blindagens simétricas adotadas. A/B de getters sob accessors: fix
estritamente MELHOR que o shipado (ease 8→4). **Dissenso final do Sol registrado**: ele
bloquearia até endurecer todas as leituras pré-existentes de vars sob página adversarial —
classe r46, deferida com gatilhos; fechado como lead.

Residual da mesma classe (caminho de ESCRITA, fora do seam): `sampleGsapValue` e
`invalidatePreservingStart` mantêm o padrão progress-restore. O baseline do witness do detach
foi regravado desta produção (11 RED limpos = só o contrato do defeito do detach).

⭐ Consequência pro detach (§0): o argumento "a produção já rebobina a cada seleção" agora
aponta pra um rebobinador CORRETO — quem retomar o detach deve reusar ESTE seam (verdict +
totalTime + unsampleable), não reconstruir outro.

## 0. Conclusão da 6ª tentativa (2026-08-03)

O Adilson autorizou uma passada focada: provar o instrumento de rebobinagem e, se provasse,
terminar a tentativa. **O instrumento foi provado** e as duas regressões da 5ª foram consertadas —
mas o desenho caiu por outro motivo, e desta vez o motivo é estrutural.

**O instrumento (provado, e o resultado fica):** `_probe-detach-instrumento.mjs`, 11 formas × 5
instrumentos, com verdade INDEPENDENTE (o estado do elemento antes de o tween existir) e controle
de sensibilidade. Só o **vai-e-vem em coordenada TOTAL** (`totalTime(ε)` → `totalTime(alvo)`)
acerta as 11 formas **e** de fato renderiza — dois eixos, porque um instrumento que não faz nada
"acerta" o valor por omissão. `progress` é posição DENTRO da iteração (num `repeat:2` na 2ª
passagem, `progress 0` é a virada e renderiza o valor FINAL); `render(t,_,force)` mente em
timeline interna. Correção lateral: o GSAP representa `repeat:-1` como `totalDuration` **1e10**,
não `Infinity` — meu raciocínio de que isso cairia no fallback estava errado.

Com o instrumento novo, o discriminador estrutural do `innerChild`
(`targets().length === 1 && targets()[0] === rowTargets[0]`, que abarca stagger E duração/delay
funcionais, coisa que testar `vars.stagger != null` não fazia) e a exclusão da linha multi-alvo:
**30 casos, 0 regressões, 17 melhorias.** Salto do `keyframes` array: 24,75 → **0**.

**E aí três auditorias acharam mais quatro defeitos, todos confirmados rodando:**

1. **Sol** — falso positivo em tween misto CSS + `attr`: o `cssText` vê o lado CSS bater nas duas
   pontas e carimba `verified`, enquanto o atributo sai errado. Salto do atributo 29,7 → **54**.
   Corrigido com um gate (`gsapWritesOnlyCss`) que recusa quando há var de plugin.
2. **Sol, rodada 2** — o MESMO falso positivo por outra porta: o CSSPlugin do GSAP, quando a chave
   não existe em `style` mas existe no alvo, anima `target[key]` DIRETO (`scrollTop`, `scrollLeft`,
   `value`). Meu gate presumia que toda chave escalar não-registrada é CSS.
3. **Agente Claude** — `repeatRefresh`: o detach move IRMÃOS que o usuário nunca tocou, de forma
   permanente (`[75,75,75]` → `[100,100,100]`; com `+=100` → `[175,175,175]`), porque as buscas
   até as pontas cruzam TODAS as fronteiras de repetição, coisa que o perímetro shipado nunca
   fazia. O `finally` restaura pixels e tempo, não os valores de início gravados DENTRO do tween.
4. **Agente Claude** — o clone verificado fica estacionado na ÚLTIMA iteração, então a inspeção
   passa a reportar a linha desacorrentada como **morta** (`0=100 → 1=100`). Trocar "início
   errado" por "linha sem movimento" é qualitativamente pior, e pega justo o caso mais comum
   (barras em loop, `repeat:-1`).

⭐ **O achado que importa não é nenhum desses quatro — é o que eles têm em comum.** Os defeitos 1
e 2 são a mesma classe por portas diferentes: **"o `cssText` enxerga tudo que o tween escreve"
não é uma propriedade que dê pra estabelecer por enumeração.** Eu tapei a porta dos plugins e a
das propriedades diretas estava aberta; o CSSPlugin tem fallback documentado pra propriedade do
alvo, plugins se registram em tempo de execução, e não há lista que feche isso. O instrumento tem
**ponto cego de tamanho desconhecido**, e cada rodada acha outra porta.

**Por isso revertí de novo em vez de aplicar as quatro correções.** Os defeitos 3 e 4 têm conserto
claro (recusar `repeatRefresh`; estacionar o clone por `totalTime`). Os 1 e 2 não têm — têm
remendo.

### O desenho que fecharia a classe (não construído)

Parar de adivinhar quais canais existem e **perguntar ao próprio GSAP**: a cadeia viva de
PropTweens (`pt.d._pt`) entrega `{propriedade, início, variação, unidade}` e o objeto-alvo de
cada escrita. Usada como **mapa de cobertura** — só pra saber QUAIS canais observar, não pra
reconstruir valores — ela fecha a classe por construção, porque a lista vem do GSAP e não da
minha enumeração. É diferente do "leitor de internals" que descartei no dia 2 (aquele
reconstruía VALORES e falhava calado em cor/`boxShadow`); aqui os valores continuam vindo da
medição. É trabalho novo, com probes e auditoria próprios.

### A alternativa de produto, que segue na mesa

Recusar o `detach` nas formas que não conseguimos reproduzir, em vez de prometer "tween
equivalente" e entregar salto. Decisão do Adilson.

---

# Registro da 5ª tentativa (2026-08-02)

> Passo 0 do handoff de entrada (`2026-08-02-next-session-handoff.md`).
> **Produção INTOCADA** — `git diff HEAD -- packages/` é vazio. O defeito segue lá.
> O que fica é evidência: um witness de 25 casos que PEGOU as regressões, a causa raiz de cada
> mecanismo, um defeito pré-existente novo, e o motivo medido de por que o caminho tentado falha.

## 1. Desfecho, primeiro

Construí a 5ª tentativa de consertar a continuidade do `link.detach`. O witness ficou verde,
a suíte ficou verde, e as **duas auditorias adversariais acharam duas regressões que o meu
witness não cobria**. Reproduzidas no witness e confirmadas por medição:

| caso | shipado | com a tentativa |
|---|---|---|
| `vars.keyframes` (forma array) @.15 — salto do alvo | 24,75 | **55** |
| idem — início do clone (verdadeiro = 0) | 45 | **100** |
| idem — **irmão** | 45 → 45 | 45 → **100** (teleportado) |
| linha multi-alvo (split-text), fragmento 2 | salto 14,44 | salto **18,24** |

**Regra de parada acordada com o dono**, citada do handoff de entrada: *"mais uma regressão
CONFIRMADA em comportamento shipado → reverter e deixar documentado, em vez de emendar uma
quinta vez."* → **revertido.**

Havia um remendo medido à mão (trocar o render forçado por um vai-e-vem de `progress`, e usar
`vars.stagger != null` como discriminador). **Não apliquei de propósito:** é exatamente o padrão
que a regra existe pra interromper — cada rodada produz um remendo plausível e a rodada seguinte
acha uma forma nova quebrada. Duas formas escaparam do meu witness nesta rodada; isso mede a
confiabilidade da minha cobertura, não só do meu código.

## 2. O defeito (inalterado, agora com número em mais formas)

O contrato está escrito no código — *"mint an EQUIVALENT standalone tween"* — então
descontinuidade é defeito. Medido pelo caminho REAL do bridge, GSAP 3.15 real:

| estado | alvo antes → depois | trajetória do clone |
|---|---|---|
| tween puro @.5 | 75 → **93,75** | 75 → 100 (devia ser 0 → 100) |
| tween puro @1 | 100 → 100 | 100 → 100 (**clone morto**) |
| stagger 1ª barra @.5 | 99,75 → **99,94** | 99,75 → 100 |
| stagger 3ª barra @.5 | 57,75 → **89,44** | 57,75 → 100 |
| `keyframes` array @.15 | 45 → **69,75** | início 45 (verdadeiro = 0) |

**Causa raiz:** uma tween grava os valores de início no **primeiro render**, não na criação. O
clone nasce lendo o DOM já renderizado no meio e recebe `progress()` por cima.

## 3. A evidência que reenquadrou o problema (vale para quem retomar)

Probe com controle de sensibilidade (0 renders sem clique, instrumento estável): **a produção já
rebobina o tween compartilhado a cada SELEÇÃO.** `gsapEditableTracks` (~linha 1929) faz
`progress(0)` → lê → `progress(1)` → lê → restaura, **com snapshot e restauração do
`style.cssText` de todos os alvos**. Um clique = 6 renders, tudo volta ao lugar. As trilhas
publicadas pra UI já carregam início e fim verdadeiros.

Consequência: a premissa das 4 rodadas anteriores — *"rebobinar o compartilhado é perigoso"* —
era minha, não do sistema. E o snapshot de `cssText` é justamente a defesa que faltava nas
minhas tentativas (é o que impede um tween com `clearProps` de apagar o estilo posterior de um
irmão — caso que quebrou a rodada 2 e ficou verde agora).

**Isso segue valendo.** O que falhou não foi a rebobinagem: foi o INSTRUMENTO de forçar o render.

## 4. O desenho tentado, e exatamente onde ele quebra

**VERIFICAR, NÃO PREVER** (mesma arquitetura do classificador, item 160): em vez de um gate que
decide de antemão quais formas são seguras, cunhar o clone e **medir** se ele reproduz as pontas
do compartilhado; quando não reproduzir, cair no construtor shipado.

Isso resolveu de fato o par `gsap.from` / `runBackwards`-em-keyframes sem precisar detectá-los
(caem no fallback por construção: guardam o início nas vars e leem o fim do DOM, então um clone
cunhado no início sai zero-delta).

### ⭐ Onde quebrou — o instrumento mente para timelines internas

Pra derrotar o no-op de `progress` (fato 2 abaixo) usei `render(totalTime, true, force=true)`.
Numa tween com **timeline interna** — que é o que `vars.keyframes` cria — o render **forçado**
obriga TODOS os filhos a renderizar em ordem crescente. O último a escrever `x` é o 3º keyframe
(`{x:0}`, cujo *start* é 100) e ele vence. `progress()` normal usa a passada reversa e escreve
na ordem certa.

Resultado: o "início verdadeiro" sai errado, **e a verificação compara o clone contra um baseline
que ela própria produziu com o instrumento defeituoso** — os dois lados erram igual e casam.
O selo `verified` então autoriza o estacionamento novo, e o erro se agrava em vez de cair no
fallback. **"Verifique, não preveja" só é sólido se o instrumento de medida for independente do
defeito.** Aqui não era. Essa é a lição central desta rodada.

Candidato medido pelo revisor (NÃO aplicado, precisa de rodada própria): trocar o render forçado
por um **vai-e-vem de `progress`** (`progress(p±ε, true)` e depois `progress(p, true)`), que
derrota o no-op sem perder a passada reversa.

### Segundo defeito: `innerChild` nem sempre é "o filho deste alvo"

O estacionamento usava o progresso do filho interno. Isso só é o filho por-alvo quando
`vars.stagger != null`. Sem stagger, os filhos de `keyframes` são **segmentos**, e o `.find`
devolve o primeiro segmento. Numa **linha com vários alvos** (split-text) o clone mantém
`vars.stagger` e vira fachada, enquanto o `parked` vinha do filho — dois relógios diferentes.
Discriminador correto e barato: `vars.stagger != null`, não a existência de `tween.timeline`.

## 5. Fatos estabelecidos por probe (todos com controle de sensibilidade)

1. A inspeção já rebobina o compartilhado a cada seleção, com snapshot/restore de `cssText` (§3).
2. `progress(p, true)` **é no-op** quando a animação já está em `p` e nunca renderizou.
3. Restaurar `cssText` **não restaura o cache de transform do GSAP** — sem reparar o cache, o
   próximo tween cunhado no elemento nasce lendo o valor do clone descartado.
4. ⭐ Restaurar por `progress()` **perde a iteração**: num `yoyo` na perna de volta a animação
   **inverte de direção** (referência 75 → 64; restaurada 75 → **84**); num `repeat:2` volta pra
   iteração 1. `totalTime()` restaura exato nos três casos, inclusive no controle positivo.
5. `gsap.from` grava `runBackwards: 1` (número, não `true`) — meu primeiro probe deu falso
   negativo por testar identidade estrita.
6. `pt.d._pt` entrega `{propriedade, início, variação, unidade}` por alvo (inclusive no filho do
   stagger), mas cor e `boxShadow` usam outra forma (`b`/`e` string). Leitor de internals foi
   **descartado pra produção**: qualquer forma não enumerada produz clone errado EM SILÊNCIO.

## 6. ⚠️ Defeito PRÉ-EXISTENTE descoberto (não é desta tentativa)

**A inspeção danifica o estado temporal de tweens com `repeat`/`yoyo` a cada seleção.**
`gsapEditableTracks` restaura por `progress`, que não identifica a iteração (fato 4). O baseline
gravado do arquivo **shipado** mostra o dano: `totalTime` 1,5 → 0,5, iteração 2 → 1, e o irmão
volta a andar PRA FRENTE numa perna de volta. O `cssText` restaurado **mascara o dano até o
próximo tick**.

Reprodução: `_probe-detach-iteracao.mjs` (tem controle positivo). Conserto aparente: `totalTime`
em vez de `progress`. É ~1 linha, mas no caminho mais exercitado do bridge — pede witness e
auditoria próprios. **Não consertei junto de propósito.**

## 7. O witness fica (é o ativo durável)

`_probe-detach-witness.mjs` + `_probe-detach-baseline.json` (baseline gravado do arquivo
**shipado**). Página nova por caso, alvos próprios, caminho REAL do bridge, 25 casos:

- **Positivos** (alvo não salta, irmão não se move, trajetória preservada): tween puro em 0/.5/1;
  stagger em 0/.5; **stagger barras B, C e D**.
- **Negativos** (contrato **NÃO PIOR** + campos categóricos idênticos): `from`, `runBackwards` em
  keyframes, **`keyframes` array**, **linha multi-alvo**, `clearProps`, duração funcional, delay
  funcional, callbacks, ease com **contagem exata**, `yoyoEase`, **estado temporal de `repeat`**,
  **direção de `yoyo` no próximo tick**, timeline-pai, reverse, reprodução ativa, undo/relink
  (puro e a recusa do stagger), independência pós-detach, e um **controle de seleção sozinha**.

Contra o arquivo shipado: **12 FAIL** (o defeito). Foi ele que pegou as duas regressões.

⚠️ **Buraco conhecido do witness, conserte antes de confiar:** o critério genérico de "defeito
novo" lê os campos `alvoAntes/alvoDepois/irmaoAntes/irmaoDepois/cloneDe/cloneAte`. Os dois casos
novos usam nomes próprios (`frag1Antes`, `cloneXem0`…) e **passaram batido** no critério
genérico — as regressões só apareceram na comparação campo a campo. Ou padronize os nomes, ou dê
asserções explícitas a esses casos.

## 8. Se alguém retomar

**Pré-requisitos, nesta ordem:**
1. Trocar o instrumento: vai-e-vem de `progress` em vez de render forçado — e **provar** que
   rebobina certo em `vars.keyframes` array ANTES de qualquer outra coisa.
2. Discriminar por `vars.stagger != null` pro estacionamento; tratar `rowTargets.length > 1`
   como caso próprio (o clone vira fachada).
3. Fechar o buraco do critério genérico do witness (§7).
4. Só então reabrir a verificação — e lembrar que **o instrumento tem que ser independente do
   defeito que ele mede**.

**Custo/benefício, dito claramente:** o valor é um papercut (o elemento salta ao desacorrentar no
meio da animação). O risco é o idioma `vars.keyframes` array, que os itens 168b/169/171 passaram
126+42 rodadas de auditoria suportando. Cinco tentativas falharam. A opção honesta de recusar o
`detach` nas formas não comprovadas — em vez de prometer equivalência e entregar salto — segue
na mesa e é decisão de produto do Adilson.

## Como reproduzir

```bash
cd ~/Desktop/IA/Uncraft/packages/web-shell
npx vitest run                        # 1536
node _probe-detach-witness.mjs        # 12 FAIL — o defeito documentado
node _probe-detach-iteracao.mjs       # o defeito pré-existente da §6
node _probe-detach-mecanismo.mjs      # por que criar o clone em 0 não basta
node _probe-detach-inspect-rewind.mjs # a inspeção já rebobina a cada seleção
node _probe-detach-cache.mjs          # no-op do progress + cache de transform
```

Probes de revisão deixados pelo revisor: `_probe-review-*.mjs` (o `renderforced` isola a raiz do
achado 1; o `vaivem` mede o candidato de conserto). Untracked por convenção.

⚠️ **Nunca use `git stash` para A/B de código aqui** — use `git show HEAD:<path> > <path>` **com
caminho absoluto**. Nesta sessão um `cd` dentro de um comando composto fez um `cp` relativo
falhar e deixou o arquivo de produção na versão shipada no meio de uma medição; foi pego, mas é
a segunda sessão seguida em que `cwd` herdado morde.

## Lições de método

1. ⭐ **O instrumento de medida tem que ser independente do defeito que ele mede.** "Verifique,
   não preveja" é sólido — mas eu verifiquei com uma régua torta e os dois lados casaram no erro.
2. ⭐ **Antes de construir a defesa, procure a que já existe.** Quatro rodadas construíram um
   perímetro que a produção já tinha, melhor, no caminho ao lado.
3. **Falso negativo e falso positivo não custam igual.** Aqui o falso negativo custa o
   comportamento de hoje; o falso positivo entrega um clone errado com carimbo de aprovado.
4. **Witness precisa de controle de sensibilidade próprio** — rodar contra o arquivo shipado e
   exigir VERMELHO. Sem isso não se sabe se ele mede alguma coisa.
5. **Booleano esconde crescimento** — `easeChamado: true//false` escondia 10 → 20 invocações.
6. **Dano temporal se esconde atrás de posição correta** — no `yoyo` o valor imediato batia; o
   erro só aparecia um tick depois. Restauração de estado precisa ser medida no TICK SEGUINTE.
7. **Duas auditorias de fornecedores diferentes pagaram de novo.** O Sol pegou a iteração perdida
   (que virou o defeito pré-existente da §6); o agente Claude pegou o falso-verificado circular
   que matou a tentativa. Nenhum dos dois achou o do outro.
