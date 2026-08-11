# Herdar o motor × re-expressar o movimento — advise do Sol + censo (2026-08-10)

**Nada foi decidido.** Este documento junta a segunda opinião do Sol e as primeiras
medições em sites reais, pra que o Adilson decida com fatos e não com argumento.

Origem: pergunta do Adilson — "os controles deveriam mexer nas animações do site clonado
apenas, e nós cobramos pelo clone; então podemos fazer o clone em função do nosso editor
e vice-versa".

---

## 1. A decisão

Hoje a captura preserva o **código de animação do site** (GSAP, ScrollTrigger, SplitText,
Lottie, Lenis, rAF próprio) e ele roda vivo dentro do clone. Nosso editor inspeciona as
instâncias vivas e **negocia** com elas.

A alternativa: **interpretar e re-expressar** o movimento num formato nosso, com runtime
nosso, na hora da captura.

---

## 2. O que o Sol respondeu

**Direção: re-expressar está certo.** Determinismo, desfazer de verdade, exportação
coerente, silêncio por construção, e o custo de manutenção concentrado num compilador
nosso em vez de espalhado por toda runtime alheia que aparecer.

⚠️ **A minha inclinação de híbrido foi corrigida, com mecanismo.** Híbrido **por track ou
por elemento, no mesmo DOM**, é provavelmente o pior dos dois mundos: pra re-expressar uma
track é preciso impedir a original de continuar escrevendo, e isso é exatamente o
ownership, o transplante, a atestação e o rollback que já consumiram meses. Sem isso,
escrita dupla. Aceito a correção — o argumento não é geral, é a conta que este repositório
já pagou.

**A recomendação dele: dois artefatos, UM runtime ativo.** A captura produz (a) o clone
nativo preservado, como **oráculo, evidência e fallback**; (b) o clone compilado no nosso
formato; (c) um relatório verificável de fidelidade. O produto executa **um ou outro**,
nunca os dois sobre o mesmo estado visual. Promoção pelo **clone inteiro** primeiro.

**A fronteira não é a animação — é a ilha de execução:** o menor conjunto que compartilha
relógio, rolagem, layout, estado ou efeito. Um ScrollTrigger mexe em `body`, na altura do
documento, em spacer de pin, em classes que outras animações leem, e pode criar animação
nova depois da captura. Com rolagem e timeline globais, **a ilha real pode ser a página
inteira**.

**A terceira opção que eu não tinha formulado — compilar por OBSERVAÇÃO, não só por
interpretação:** rodar o original sob traces controlados, registrar as trajetórias visuais
e as mudanças de estado, reconstruir semanticamente o que for editável e **preservar o
opaco como superfície visual**. Isso muda o cálculo: o que não entendemos não precisa ser
perdido, e também não precisa obrigar a página inteira a continuar hostil.

### Riscos tardios que ele levantou

- animação frequentemente é **programa**, não lista de keyframes (funções em valores,
  modifiers, criação dinâmica, condicional);
- **rolagem é topologia de layout** — reproduzir transform/opacity não reproduz pin,
  spacer, altura do documento, refresh, snap nem velocidade suavizada;
- **inspecionar sem observar não basta**;
- uma captura pode **overfitar um viewport** (fontes, resize, breakpoint, velocidade e
  direção de rolagem, conteúdo assíncrono);
- canvas/WebGL não têm semântica de DOM pra traduzir — degradam pra superfície visual,
  fidelidade sem editabilidade interna;
- o formato vira **artefato persistido de produto** (versionamento, migração,
  compatibilidade);
- o custo pode migrar pra **tamanho e performance** (amostragem ingênua = milhares de
  keyframes);
- a execução hostil **muda de lugar**: sai do produto entregue, mas continua no ambiente
  de captura, que passa a precisar de mais isolamento, não menos;
- **falso positivo é o pior erro**: "não compilei, preservei o original" é aceitável;
  "declarei fiel e entreguei diferente" ameaça cobrança e confiança.

### Verificado por mim, não aceito de palavra

O Sol disse que nosso IR atual é semente e não formato canônico. Confere:
`lib/motion-editor/motion-ir.js` tem 151 linhas, e `framer-export.js` **pula pin e snap**
e **descarta keyframes intermediários** no mapeamento de rolagem, declarando-se ferramenta
interna com acabamento humano.

---

## 3. Censo em sites reais — primeiras medições

Instrumento: `packages/web-shell/_probe-censo-movimento.mjs`. Lê o motor **direto**, sem
passar pelo nosso inventário (que é enviesado pelo que sabemos *escrever de volta*, e
re-expressar precisa só de *ler*). Rola a página inteira antes de contar, porque muita
animação só nasce na rolagem.

| site | GSAP | tweens | ScrollTriggers | props distintas | WAAPI | regras CSS `@keyframes` | opaco |
|---|---|---|---|---|---|---|---|
| Farm Minerals (clone 1:1) | 3.15 | 74 | 51 | **12** | 2 | 1 | 2 canvas, 3 vídeo, 7 lottie, Lenis |
| gsap.com | 3.15 | 166 | 35 | 24 | 0 | 0 | 6 vídeo |
| linear.app | **nenhum** | 0 | 0 | — | **103** | **567** | — |
| stripe.com | **nenhum** | 0 | 0 | — | **100** | 0 | 6 canvas |
| apple.com/airpods-pro | **nenhum** | 0 | 0 | — | **24** | 35 | 16 vídeo |

### O que salta

1. **A superfície de propriedades é pequena.** No Farm Minerals, 74 animações usam **12
   propriedades distintas**, dominadas por `autoAlpha`, `y`, `opacity`, `width`, `height`.
2. **As formas exóticas que consumiram meses não aparecem lá.** Zero funções em `vars`,
   zero `keyframes`, zero wrapper `css:{}`. Elas aparecem no gsap.com (39 com keyframes,
   4 com função) — que é o site de demonstração do próprio GSAP, não um site de cliente.
3. ⭐ **Três dos cinco não usam GSAP.** O movimento deles vive em **CSS e WAAPI** —
   declarativos e muito mais fáceis de ler e reproduzir do que JavaScript arbitrário. Isso
   não é ausência por cegueira do instrumento: nenhum elemento dessas páginas carrega
   estado `_gsap`, que um GSAP empacotado deixaria mesmo sem expor `window.gsap`.
4. **O opaco é real e não é raro**: canvas no Stripe, 16 vídeos na Apple, 7 Lotties no
   Farm Minerals, Lenis. É exatamente onde a "compilação por observação" do Sol entra.
5. **A porta do ScrollTrigger é a maioria, não a exceção**: 31 dos 51 gatilhos do Farm
   Minerals têm callback. (Medida separada, no finding do mesmo dia.)

### ⚠️ O que este censo NÃO é

**Não é prevalência.** São cinco sites, escolhidos por mim por serem conhecidamente
animados. É prova de existência, não amostra. O Sol pede 20 capturas recentes **não
selecionadas** justamente pra isso, e ele está certo.

→ **Isso foi resolvido na §3b.**

---

## 3b. PREVALÊNCIA — 60 sorteados do banco de referências (2026-08-11)

O Adilson lembrou que o banco de referências curado já existe: **1636 sites**
(`packages/web-shell/lib/reference-bank.seed.json` — codrops 863, pafolios 816,
siteinspire 41). É a **população-alvo de verdade**, melhor que os "20 aleatórios" do Sol
no abstrato. Sorteio com **semente fixa** (`20260811`), 60 URLs, sem escolha a dedo.
Dados crus em `_censo-banco-60.jsonl`, amostra em `_censo-banco-60.urls.txt`.

**Tentados 59** (o 60º não foi lido — o arquivo da amostra não tinha quebra de linha
final); **54 mediram**, 5 não carregaram.

### ⭐ Alcance — quanto do que construímos alcança o alvo

| | sites | % |
|---|---|---|
| GSAP **alcançável** por `window.gsap` | 7 | **13%** |
| GSAP presente mas **empacotado** (só `_gsap` nos elementos) | 15 | 28% |
| nenhum vestígio de GSAP | 32 | 59% |

⚠️ **Os 28% empacotados são invisíveis para o nosso editor.** Verifiquei: **todos** os
caminhos de descoberta do bridge passam por `window.gsap`/`globalTimeline`
(`runtime-bridge-source.js` linhas 1125, 2163, 2688, 4992) — não existe rota por `_gsap`.
Então a máquina que construímos alcança **13% da população-alvo**, não 41%.

### Profundidade — nos 7 que alcançamos, os sites são pequenos

- tweens: **mediana 7** (máx. 204)
- propriedades distintas: **mediana 4** (máx. 16)
- ScrollTriggers: mediana 7 (máx. 47)

E as formas exóticas, em **54 sites**:

| forma | sites | onde ela consumiu tempo |
|---|---|---|
| `vars.keyframes` | **0** | furo #1, caminho-seguro (126 rodadas), fase-2 timeline (42 rodadas) |
| wrapper `css:{}` | **0** | furo #2 (12 rodadas) |
| função em `vars` | 2 | hazard de proveniência dinâmica |
| `pin` | 2 | — |
| `toggleClass` / `snap` / `once` | **0** | — |

### ⭐ A porta da rolagem, agnóstica de mecanismo

| | sites | mediana | máx. |
|---|---|---|---|
| disparos de IntersectionObserver na rolagem | **28 de 54 (52%)** | 1,5 | 99 |
| trocas de classe na rolagem | **28 de 54 (52%)** | 1 | **1464** |
| nenhuma reação detectada | 17 de 54 (31%) | — | — |

Os extremos não são sites GSAP: `byld.dev` fez **1464 trocas de classe** e 39 disparos de
observer numa passada de rolagem, **sem GSAP algum**. Ou seja, **a porta principal da
rolagem, na população-alvo, não é o ScrollTrigger** — é IntersectionObserver ligando
classes, que o nosso editor não vê.

### Superfície opaca — comum, não exceção

vídeo em 22 sites (41%), canvas em 15 (28%), Lenis em 16 (30%), WAAPI em 21 (39%),
Lottie em 3.

### ⚠️ Limites desta amostra

Um viewport (1440×900), desktop, **uma** passada de rolagem em passos de 700px, ~25s por
site, sem interação e sem resize. "Nenhuma reação detectada" pode ser sub-detecção. Os 5
que não carregaram podem ser justamente os mais pesados. E o banco é de vitrines
(codrops/pafolios/siteinspire) — é a população certa, mas puxa para portfólio e agência,
o que combina com a mediana de 7 tweens.

---

## 4. O menor experimento que decide (desenho do Sol)

Um **compilador em shadow mode** sobre bundles já capturados — sem construir editor novo,
sem integrar nada.

- **Coorte de 12** sites de desenvolvimento, dois por classe: GSAP temporal simples;
  timeline com stagger/SplitText/multi-alvo; ScrollTrigger com scrub sem pin; pin/snap com
  Lenis; CSS/WAAPI com Lottie/vídeo; canvas/WebGL/rAF. Depois **20 capturas não
  selecionadas** como holdout, sem ajustar o compilador.
- ⭐ **Três braços obrigatórios:** `O` original, `H` clone herdado atual, `R` clone
  re-expresso. Medir `O→H` (erro que a captura já tem hoje), `H→R` (erro que o compilador
  introduz), `O→R` (o que o cliente percebe), e `H1→H2`/`R1→R2` (ruído de replay). **Sem
  isso, defeito velho da captura é atribuído à re-expressão.**
- **Traces** em desktop e mobile, três repetições: load estabilizado, rolagem completa ida
  e volta em posições fixas, seek em posições determinadas, interação principal, resize.
  Vídeo sincronizado, bounding boxes, altura de rolagem, estilos computados.
  **Screenshot final não prova movimento.**
- **Métricas:** fidelidade temporal e visual em frames sincronizados; **falha crítica
  binária** (pin quebrado, layout saltando, hero errado, interação perdida) que vinte
  fade-ins corretos não compensam; **cobertura atômica** = % de clones que rodam com
  **zero** código original (não "animações reconhecidas"); acoplamento global;
  determinismo; custo (P95 de captura, CPU de playback, tamanho); e **quatro edits de
  prova** — duração, valor final, separar um alvo do grupo, mudar range de rolagem — que
  verificam que o resultado é um *programa editável*, não uma gravação.
- **Regras definidas ANTES de ver os dados:** clone só é promovido com **zero falha
  crítica**; ir pra runtime próprio como direção principal se **≥70% do holdout** passar
  por clone inteiro; híbrido por ilha só se **≥85%** do movimento visualmente relevante for
  promovível e **≤10%** dos sites mostrarem acoplamento atravessando ilhas; abaixo disso,
  manter a herança como produto principal. O limiar visual calibrado contra o ruído
  `H1→H2`, não contra número arbitrário.

## 5. O que tornaria o plano um erro (lista do Sol)

Herdar o resto **vivo no mesmo DOM** do conteúdo re-expresso; fallback por track ou
elemento sem prova de isolamento; tratar o IR atual como formato canônico; o experimento
contar inventário ou "animações editáveis hoje"; validar só estado final ou um viewport;
o compilador só ler `vars` sem executar e observar; abrir mais frentes de supressão
callback por callback **sem critério de parada**; e deixar o clone pago ser substituído
pelo compilado antes do gate de fidelidade.

**A formulação dele, que eu adoto:** native como oráculo e fallback; Motion Program como
destino; verificação como gate; **nunca dois motores com autoridade simultânea**.
