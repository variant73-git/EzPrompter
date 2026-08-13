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

---

## 3c. AS REAÇÕES MACHUCAM? — reversibilidade em 54 sites (2026-08-11)

A §3b mediu que 52% dos sites-alvo **reagem** quando a régua rola. Isso não dizia se
importa. Instrumento: `_probe-reversibilidade-rolagem.mjs`, mesma amostra sorteada.

**A pergunta na forma exata:** quando a régua volta para a mesma posição, o designer vê a
mesma coisa?

**Desenho, com braço de controle:** mede-se a mesma posição **três vezes sem sair** — a
maior diferença entre elas é o **ruído próprio do site** (vídeo tocando, loop ocioso).
Depois sai-se e volta-se à mesma posição. Só conta como efeito da régua o que **excede o
ruído**. Sem isso, todo site com um marquee daria "dano enorme". Três amostras e não duas
porque um par único pode pegar o site num momento quieto, subestimar o piso e transformar
respiração normal em dano — falso positivo que condenaria o caminho herdado sem razão.

A impressão digital é do DOM (classe, opacidade, caixa, transform, visibilidade), não de
pixels — o que ignora de graça o conteúdo interno de vídeo e canvas.

### ⭐ Resultado

| | sites | % |
|---|---|---|
| **volta idêntico** (excedente zero) | **44 de 52** | **84%** |
| algum excedente acima do ruído | 8 de 52 | 15% |
| dano claro (≥2× o ruído) | 5 de 52 | ~10% |

Excedente: **mediana 0**, média 3,5, máximo 58. Como fração dos elementos visíveis:
**mediana 0%**, máximo 27,8%.

**Quando machuca, machuca feio:**

| site | elementos diferentes ao voltar |
|---|---|
| neverbeforeseen.co | **27%** |
| makedesign.tech | **22%** |
| dextersulit.com | 12% |
| harkcap.com | 10% |

⭐ **Reação alta ≠ dano.** `byld.dev` fez **1464 trocas de classe** numa passada de
rolagem e volta **perfeitamente idêntico** — as reações dele ligam ao entrar e desligam ao
sair. A contagem de reações do §3b **não prevê** o dano; só a reversibilidade prevê.

### O que isso corrige na minha própria ênfase

Eu tratei a porta aberta do ScrollTrigger como o problema central da régua. A medição diz
que a porta aberta é, na maioria, **inofensiva**: o site reage e desfaz. O problema real
tem forma de **cauda longa** — some em 84% dos casos e é grave em ~10%.

Consequência prática: **o silêncio na rolagem deixa de ser bloqueador e vira limitação de
raio conhecido.** Com um botão de recarregar, o caminho herdado sobrevive a isso
honestamente. **O que não sobrevive é o alcance de 13%** (§3b) — esse continua sendo o
argumento forte, e é outro.

### ⚠️ Limites

Das 69 linhas brutas, **54 eram JSON válido** e 15 ficaram ilegíveis e foram descartadas —
então a contagem de falhas **não está estabelecida**, e sites que quebraram podem ter
sumido em silêncio. Dois sites (`rajeshshankar.com`, `felixlesouef.com`) **não pousaram na
mesma posição** ao voltar (âncora, snap ou rolagem suave) e foram excluídos — o que é, por
si, um achado pequeno: em alguns sites a régua nem consegue voltar para onde pediu.

Uma posição por site (metade da página), um viewport, uma repetição. Assentamento de 1,2s
pode ser curto para animação longa — o que **subestima** o dano, não o contrário.

---

## 3d. PASSO ZERO e TEMPO DE CLONAGEM (2026-08-11)

### Passo zero: não há uso real para validar os 13%

Consulta **somente leitura** à produção (`ep-lingering-shadow-achloaoq`, nenhum write):
**57 nodes, 10 URLs distintas**, das quais a maioria é fixture de teste
(`target.example.com`, `qa.test`, `reference.example.com`, `golden-match.vercel.app`).
Sites externos reais: **três** (farmminerals, curriculum.com.br, gistr.so).

**Conclusão:** o corpus de uso real não existe — o produto é pré-lançamento. Os 13% de
alcance **não podem ser confrontados com a realidade**, e essa ressalva fica de pé até
haver uso. Do lado positivo: sem uso que o contradiga, o banco curado não é um proxy do
alvo — ele **é** a declaração curada de qual é o alvo.

### Tempo: medido, não estimado

`_probe-tempo-clonagem.mjs`, mesma máquina, mesmos sites, partes que existem hoje.

| site | captura de hoje | + traces | + verificação | total |
|---|---|---|---|---|
| farmminerals.com/promo | 35,9s | 12,2s | 14,9s | 63,0s |
| gistr.so | 24,1s | 19,1s | 22,1s | 65,3s |
| ueno.co | 9,5s | 7,1s | 12,8s | 29,4s |
| **média** | **23,2s** | 12,8s | 16,6s | **52,6s** |

**O acréscimo é ~2,3× — cerca de 30s por clone.** Não é 10×, não é segundos.

⚠️ **É PISO, não custo cheio.** Sem as 3 repetições e sem o segundo viewport que o
protocolo do Sol exige (seriam ~6× os traces, algo como 2 minutos por clone), e **sem a
etapa de compilar, que não existe e portanto não está na conta.** Ela entra como incógnita
declarada, nunca como zero.

### ⭐ O que isso faz pela quarta solução do Adilson

A proposta dele: saber de antemão quais sites rejeitariam o caminho rápido e mandar só
esses para o caminho caro, avisando que vai demorar mais.

O precedente do próprio projeto (item 160) diz para **não prever**: preditor por sinais
nunca é perfeito, e o exemplo daquela decisão foi literalmente "GSAP empacotado é
invisível" — medido aqui em **28%**. Mas a ideia sobrevive na forma **verificar**, e os
números fecham:

- **verificação custa 16,6s** (e é teto — a régua atual gasta 3,6s só em esperas de
  assentamento e pode ser bem mais enxuta);
- **84% dos sites passam** na verificação de reversibilidade (§3c).

Logo a escada fica:

| | quem paga | custo |
|---|---|---|
| sinal direto e barato (nada alcançável?) | todos | ~3s |
| captura + **verificação** | todos | 23s + 17s ≈ **40s** (1,7× hoje) |
| traces completos + compilar | **~15%** | o custo cheio, só no resíduo |

E o aviso ao usuário fica **honesto**, porque vem depois de uma checagem real: "verificamos
e este site precisou de uma passada mais funda". Não é adivinhação.

---

## 4. SPIKE de re-expressão — o ingênuo FALHOU, e o gargalo é outro (2026-08-11)

`_spike-reexpressao.mjs`, um site por grupo. Quatro etapas: **observar** o site vivo em 21
posições de rolagem, **compilar** trilhas só do que muda, **reproduzir** sobre o DOM
capturado com um runtime nosso de ~40 linhas, e **medir** em **10 posições retidas** — no
meio das amostradas, nunca coincidentes (medir onde se amostrou seria ajustar ao gabarito).

### ⚠️ O erro de método que eu cometi e o instrumento pegou

A primeira versão tinha **dois** braços e devolveu `1.902` para ueno.co. Eu ia atribuir isso
à re-expressão. Era da **captura**: o clone de ueno.co sai com **124580px contra 2821px
reais**, 44×. Foi exatamente o que o Sol exigiu separar com os três braços, e eu tinha
construído dois. Refeito com O (original), H (clone de hoje) e R (clone + nosso runtime).

### Resultado

| site | altura O→H | erro da captura O→H | nosso runtime H→R | total O→R | aproximou? |
|---|---|---|---|---|---|
| farmminerals.com/promo | **1×** | 0,549 | 0,61 | **0,701** | **não — piorou** |
| byld.dev | 1,04× | 1,43 | 0,282 | 1,448 | não |
| ueno.co | **44×** | 1,902 | 0,028 | 1,902 | não |

**Em nenhum dos três o nosso runtime aproximou o clone do original.** No único site onde a
captura é dimensionalmente fiel (farmminerals, altura 1×), a re-expressão **piorou**
medidamente: 0,549 → 0,701.

### O que MORREU, e o que não morreu

Morreu a versão ingênua: **amostrar por posição de rolagem e reproduzir**. A causa
provável é de desenho, não de princípio — o compilador trata **toda** animação como se
fosse dirigida pela rolagem. Uma animação de tempo (loop, Lottie, vídeo) amostrada em 21
posições de rolagem vira trilha sem sentido, e escrever isso de volta com `!important` em
426 elementos corrompe o que estava certo. Some-se a interpolação de `transform` por
vizinho mais próximo, que já estava declarada como limitação.

**Não morreu** a compilação por observação em geral. Morreu esta implementação, e ela
estabelece um requisito mínimo: **separar movimento dirigido por rolagem de movimento
dirigido por tempo ANTES de amostrar.**

### ⭐ O achado maior: o gargalo pode não ser o movimento

**O→H foi medido pela primeira vez: 0,549 a 1,902.** Ou seja, o clone estático de hoje já
difere do site vivo em 55% a 190% dos elementos visíveis, nas posições de rolagem. E em
todos os três sites **O→H domina O→R** — o erro da captura é maior que qualquer coisa que
o movimento acrescente.

Descoberta colateral que reformula a discussão: **`captureSnapshot` já remove TODOS os
scripts** (`lib/snapshot.js:236-238`). O clone estático de hoje **já não tem motor nenhum
do site** — o motor herdado vive só no caminho do native bundle, que é o que o motion
editor usa. Logo "re-expressar" não é construir um pipeline novo: é **colocar movimento
nosso num artefato sem scripts que já existe**.

### ⚠️ Limites do número

A régua é **estrita**: conta como diferente qualquer elemento cuja classe, opacidade,
caixa (ao pixel), transform ou visibilidade mude. `0,549` **não** quer dizer "o clone
parece 55% errado para um humano" — quer dizer "55% dos elementos diferem em pelo menos um
desses campos com precisão de pixel". O número é válido para **comparar os braços entre
si**, que é para o que ele existe; não é medida perceptual. Um viewport, uma repetição,
três sites.

### Próximo passo que estes números indicam

Antes de escolher arquitetura de movimento, **medir e atacar a fidelidade da captura** —
porque ela domina o erro total nos três sites. O Sol pediu o braço O→H justamente para não
atribuir defeito velho ao compilador; medido, o defeito velho **é** o termo maior.

---

## 5. FIDELIDADE ANCORADA — o que o clone estático perde (2026-08-11)

O Adilson observou que **visualmente o clone do FarmMinerals já parece bom**, contra o meu
número de 55%. Ele estava certo, e a observação derrubou minha conclusão de §4.

### ⚠️ Quatro réguas seguidas mediram ALINHAMENTO, não qualidade

1. impressão digital de elementos (§4) — 55%;
2. pixels da viewport inteira — 50,9%;
3. altura de página — 44× no ueno.co;
4. recorte ancorado, primeira versão — comparou fundo com fundo.

Todas comparavam "posição de rolagem N no original" com "posição N no clone". **Posição de
rolagem não é coordenada comparável** entre um site dirigido por JS e um clone sem JS: o
original está sempre em algum estado de animação e o clone está congelado. **Retiro a
conclusão de §4 de que "o gargalo é a captura"** — ela vinha de um número que não media
aparência.

### A régua que funciona: âncora por ELEMENTO + dois controles

`_probe-fidelidade-ancorada.mjs`: acha o mesmo elemento nos dois lados **pelo texto**, leva
cada arm até ele e compara **um recorte da caixa dele** — o deslocamento vertical some por
construção. Dois controles: (a) o mesmo recorte do original contra ele mesmo (o site pode
estar em movimento, e isso não é defeito do clone); (b) **contraste mínimo no recorte** —
um recorte liso é fundo, e comparar fundo com fundo não mede nada. O controle (b) foi
acrescentado depois de ele ter deixado passar uma âncora invisível.

### Resultado no FarmMinerals

| âncora | excedente sobre o ruído |
|---|---|
| Effortlessly integrative | **3,6%** |
| Zero manufacturing emissions | **4,7%** |
| Smaller than a plant cell | **5,9%** |
| "reaches your crops. It evaporates…" | **84,5%** |
| "washes away, or gets locked in" | **99,7%** |
| "the soil — leaving you with lower" | **99,8%** |
| "yields, more spraying, and higher" | **100%** |

**Onde o conteúdo é estático, o clone é fiel** (3,6–5,9% — antialiasing e compressão).
**Onde o conteúdo é revelado na rolagem, o texto simplesmente NÃO EXISTE no clone.** As
telas mostram o parágrafo legível no original e um retângulo verde vazio no clone.

### Mecanismo, confirmado e não inferido

No clone, o texto tem `opacity: 1` mas **`visibility: hidden`** herdado, em elementos de
classe `gsap_split_line` / `gsap_split_line-mask` / `texts-animation-description`.

`lib/snapshot.js` **já tem** mitigação para isso — `ANIM_FORCE_SHOW_CSS` força
`opacity/visibility` em seletores conhecidos de Webflow IX3, AOS, Framer e convenções GSAP.
Mas ela é **por LISTA**: cobre `.gsap-fade` e `.gsap-reveal`, e não `gsap_split_line`
(sublinhado, outra convenção). Passa batido.

Isto é a lição já registrada no item 174, aplicada a outro lugar: **lista fecha instâncias,
verificação fecha classes.** O remédio geral não é uma lista maior — é conferir, depois da
captura, se o texto visível no original está visível no clone, e resolver o resíduo. O
probe acima **é** esse verificador.

### ⚠️ Distinção que muda quem é afetado

Isto vale para o **caminho estático** (`captureSnapshot`), que remove todos os scripts. O
motion editor **não** usa esse caminho — usa o **native bundle**, que preserva o JS do site
e portanto revela o texto normalmente. A impressão de "o clone parece bom" provavelmente é
do native bundle. Qual dos dois o usuário vê em cada tela **não foi verificado aqui** e é
pergunta em aberto.

---

## 6. QUAL É O CAMINHO REAL DO CLONE — e não houve regressão (2026-08-11)

O Adilson corrigiu duas premissas minhas: (a) ele **não tem acesso visual ao projeto há
semanas**, então "o clone parecia bom" é memória, não observação atual — é hipótese de
**regressão**, o mesmo padrão do item 163; (b) o processo de clone que ele conhece é
"captura de vídeo + visita ao site + prompt", que **não é** o `captureSnapshot` que eu vinha
medindo.

### Eu media o caminho errado

Traçado no código: `Edit` → `editorKindForNode` → `needsDeferredReconstruction` →
`api.reconstructNode` → **`reconstructPage`** (`lib/reconstruct.js`): paradas de rolagem,
rasterização de canvas/vídeo/SVG em PNG, **prompt de visão**, e pós-processo inlinando os
assets. É exatamente o processo que ele descreveu.

`captureSnapshot` é a **captura de referência gratuita**, não o clone. Toda a §5 (e o número
de tempo de 23,2s da §3d) media esse caminho secundário.

### ✅ O motion editor NÃO desviou o clone

`editorKindForNode` só devolve `NATIVE` se `NEXT_PUBLIC_NATIVE_MOTION_CANVAS_EDIT` for
verdadeira. Essa variável **não está no `.env.local`** — só no `.env.example`, como `false`.
`resolveNodeEditorKind` devolve `LEGACY` sempre que a flag é falsa, então a ramificação
NATIVE **nunca dispara** e o Edit segue para a reconstrução normalmente. (Não verificado no
ambiente de produção da Vercel — fica em aberto.)

### Tempo real do clone: ~3 minutos, não 23 segundos

Rodado de verdade no farmminerals: **177s**, 73301 bytes. Etapas: navegar → **capturar 19s**
→ rasterizar → **pensar 132s** (a chamada de visão) → finalizar. ⚠️ Isto **corrige a tabela
de tempo da §3d**, que media a captura de referência e não o clone.

### O que o clone perde — e desde quando

Três âncoras de texto do original (**"Effortlessly integrative"**, **"Zero manufacturing
emissions"**, **"Smaller than a plant cell"**) **não existem** no clone reconstruído. Altura
9284px contra 17792px do original — cerca de metade. Visualmente: cabeçalho repetido várias
vezes ao longo da página e regiões inteiras em branco.

⭐ **Teste direto de regressão, pelo banco:** existem snapshots `reconstruct` guardados de
**2026-07-22**, três semanas antes. Renderizado e comparado:

| | 22/jul | hoje |
|---|---|---|
| bytes | 72392 | 73301 |
| altura | 8960px | 9284px |
| "Effortlessly integrative" | **ausente** | ausente |
| "Zero manufacturing emissions" | **ausente** | ausente |
| "Smaller than a plant cell" | **ausente** | ausente |

**Não houve regressão.** A perda de conteúdo é característica do caminho de reconstrução por
visão — ele **reconstrói**, não fotocopia — e estava igual antes do trabalho de motion
editor. O que mudou foi só o meu entendimento de qual caminho medir.

### O que fica em aberto

Se ~metade da altura e três blocos de texto perdidos é aceitável **é decisão de produto**,
não achado técnico. O CLAUDE.md registra fidelidade esperada de 85–93% "com DESIGN.md rico";
o que medi hoje parece abaixo disso, mas **não estabeleci** se o DESIGN.md rico está sendo
usado nesta rota. Essa é a próxima medição desta linha.

---

## 7. ⭐ O CLONE BOM EXISTE, E O PRODUTO NUNCA FEZ AQUELE PROCESSO (2026-08-11)

O Adilson insistiu: o clone **já funcionou perfeitamente**, começou com "um prompt que eu
enviei + visita ao site + gravação de vídeo". Estava certo, e o registro existe no repo:
a pasta **`Clone/`**.

### O que está guardado lá

`Clone/VISUAL_COMPARISON_REPORT.json`, de **2026-07-17**:

| | |
|---|---|
| altura da fonte | 20942px |
| altura do clone | **20942px — exata** |
| SSIM por posição | 0,956 / **1,0** / 0,842 / 0,999 / **1,0** |
| SSIM médio | **0,96** |
| assets baixados | **369** (33MB), 100% offline |

Mais `OFFLINE_QA_REPORT.json` (bloqueia toda requisição externa e percorre a página) e
`INDEPENDENCE_REPORT.md`.

### Comparação direta, medida hoje com a mesma régua

| | Clone/ (17/jul) | produto 22/jul | produto hoje |
|---|---|---|---|
| altura | **20942** (= original) | 8960 | 9284 |
| "Effortlessly integrative" | **presente** | ausente | ausente |
| "Zero manufacturing emissions" | **presente** | ausente | ausente |
| "reaches your crops" | presente | presente | presente |
| bytes | 135207 + 33MB de assets | 72392 | 73301 |

(“Smaller than a plant cell” está ausente nos três — pode ser texto dinâmico ou falha do meu
casamento exato; não estabelecido.)

### ⭐ Por que a diferença: são processos diferentes, não uma regressão

`Clone/CLONE_PROMPT.md` tem **144 linhas** e exige, ANTES de escrever qualquer código:

1. **Gravar um vídeo NOVO** da navegação — 1440×1200, DPR 1, começando antes do
   carregamento para pegar o preloader, **um único scroll contínuo** do topo ao fim, sem
   reverter, mais um arquivo de metadados (FPS, duração, altura total, distância de scroll);
2. **Inventário documentado**: estrutura do hero e camadas, sequência do preloader,
   ordem/altura/composição de todas as seções, distâncias de scroll, estados inicial/
   intermediário/final de cada animação, valores de duração/delay/easing/scrub/pin/stagger,
   transições, z-index, regras de sticky/pinned/reveal/parallax/scale/fade/clip/mask/wipe,
   lógica de hover/clique/menu/slider/vídeo/formulário;
3. **Baixar os arquivos** para independência total do domínio, CDNs e fontes remotas;
4. **Verificar**: QA offline + comparação visual por SSIM.

O caminho do produto (`reconstructPage`) é **uma chamada de visão** sobre telas de paradas
de rolagem, rasterizando canvas/vídeo, **sem** vídeo de referência, **sem** etapa de
inventário, **sem** baixar assets e **sem** verificação.

**Conclusão: nada quebrou.** O produto **nunca implementou** o processo que produziu o clone
bom. Aquele clone foi um agente seguindo uma especificação de 144 linhas — não um pipeline.
A comparação 22/jul × hoje (§6) mostrou estabilidade porque comparou o pipeline com ele
mesmo; o padrão de qualidade está em outro lugar.

### Sobre o "DESIGN.md rico"

Serve de **verdade de referência** para o modelo não inventar: tema, valores exatos de cor,
papéis tipográficos, vocabulário de movimento, grade de layout e regras de componente. É a
camada anti-slop — o CLAUDE.md registra fidelidade de ~65-75% sem ela e ~85-93% com ela.

⚠️ Mas o `Clone/DESIGN.md` guardado descreve um sistema **cobalto/clorofila** ("FLUX Visual
System"), e o farmminerals é oliva e bege. Ou seja, **esse DESIGN.md não é o do farmminerals**
— é resíduo de outro projeto na mesma pasta, e o clone bom **não dependeu dele**. O que
produziu a fidelidade foi o vídeo + inventário + assets + verificação, não o DESIGN.md.

### O que isto implica

A meta "tão fiel quanto as primeiras versões" é **alcançável e já foi alcançada** — com
SSIM 0,96 e altura exata. O caminho para lá não é ajustar o prompt de visão: é o produto
executar as quatro etapas acima. As duas primeiras (vídeo de referência e inventário) são
exatamente o que o Sol chamou de **"compilar por OBSERVAÇÃO"** na §2 — a mesma ideia,
chegando por outro lado.

---

## 8. ⭐ NÃO É CATÁSTROFE — o editor foi construído sobre o clone BOM (2026-08-11)

O Adilson concluiu: "tudo o que fizemos no editor foi sobre o clone errado, isso parece uma
catástrofe". **Medido, é o contrário.** Também corrigiu, com razão, que FLUX é a frente de
**transferência de estilo**, não de clone — o `Clone/DESIGN.md` era resíduo dela.

### O artefato do editor É o clone bom

| | fixture do motion editor | `Clone/dist` (o clone bom) |
|---|---|---|
| caminho | `~/Desktop/IA/Unspirit-Clone-1to1/site` | `Uncraft/Clone/dist` |
| arquivos | **369** | **369** |
| tamanho | **33MB** | **33MB** |
| "Effortlessly integrative" | presente | presente |
| "Zero manufacturing emissions" | presente | presente |

A pasta da fixture ainda traz `recordings/` (o vídeo de referência),
`INDEPENDENCE-REPORT.md` e `validation/`. É o **mesmo processo**: vídeo → inventário →
assets baixados → verificação.

**O motion editor nunca foi desenvolvido contra o clone degradado.** Foi desenvolvido contra
o artefato de maior fidelidade que este projeto já produziu.

### O que de fato falta: o PRODUTOR

Medido no código:

1. `reconstructSiteNode` tem `producer = reconstructPage` como padrão, e **nenhum chamador
   passa outro** (`app/api/nodes/[id]/reconstruct/route.js`, `app/api/nodes/[id]/run/route.js`);
2. `reconstructPage` sempre devolve `{ html }` → `kind: 'iter9'`. **O produto nunca produz um
   native bundle**, embora o código para registrá-lo exista (`lib/native-clone/`);
3. `NEXT_PUBLIC_NATIVE_MOTION_CANVAS_EDIT` é falsa, então o canvas nem rotearia para o
   editor nativo se houvesse bundle.

Ou seja: existe o **consumidor** (o editor), existe o **contrato** (`native-clone/`), existe
a **receita** (`Clone/CLONE_PROMPT.md`, 144 linhas) e existe a **prova** (SSIM 0,96, altura
exata). Falta a peça que liga a URL ao artefato dentro do produto.

Isso não invalida o trabalho do editor — ele está esperando um produtor que ainda não foi
escrito.

### O que continua sendo problema de verdade

Independente de tudo acima, e medido na §3b: **o bridge descobre GSAP só por `window.gsap`**,
o que alcança **13%** da população-alvo. Essa limitação vale para qualquer clone que o
alimente, inclusive o bom. É o problema a se preocupar, não o clone.

### Origem, confirmada

O Adilson estava certo de que começou aqui. O vault tem
`Brain/Uncraft/Prompts/Clone de site.md` (screenshot → HTML) e
`Reconstrução de site animado (VISION_SYSTEM).md` (URL → visão) — os prompts **do produto**.
A especificação de 144 linhas que produziu o clone bom é outra coisa, mais forte, e **nunca
entrou no produto**.

### ⚠️ Addendum — o iter9 é DISPARADO por site animado e ENTREGA um site sem movimento

Pergunta do Adilson: "o iter9 só funciona pra sites estáticos?" — é o inverso, e a distinção
é o nó da frente inteira.

O prompt no vault (`Reconstrução de site animado (VISION_SYSTEM).md`) diz por que ele
existe: *"quando a captura detecta um site construído em Webflow/Framer com animações
pesadas, a fotocópia do DOM não funciona — o site precisa ser reconstruído"*. Ou seja, o
iter9 é exatamente a rota **para site animado**.

Só que ele recebe *"scroll-stop screenshots … captured AFTER scroll-triggered animations
settled"* e devolve um HTML da aparência **assentada**. Medido na saída de hoje:

| | GSAP / `@keyframes` / `animation:` |
|---|---|
| saída do iter9 | **0** |
| clone bom / fixture | **16** |

**O produto detecta que o site é animado e, por causa disso, o encaminha para o caminho que
descarta o movimento.** Aí o motion editor — que só sabe editar movimento vivo — não tem o
que editar. Esse é o nó, e ele é de roteamento, não do editor.

### Addendum 2 — o iter9 nunca foi instrução desta frente, e o plano já apontava o buraco

O Adilson: *"o editor nunca deveria ter trabalhado sobre o iter9. Nunca dei essa instrução e
nunca sequer tocamos no assunto do iter9 no spec."* Verificado, e procede.

**Cronologia:** o roteamento para iter9 entrou em **2026-05-24** (`1f2bce49`), **dois meses
antes** da frente de motion editor (2026-07-18/19). É herança, não decisão desta frente. O
primeiro spec (`2026-07-18-motion-editor-redesign-and-handoff.md`) menciona iter9 **zero**
vezes.

**No plano de 2026-07-26 o iter9 aparece só para ser deixado em paz:**

- l.62 — *"Deferred reconstruction currently produces Iter9 HTML. Animation detection alone
  is therefore not proof that a node has a native editable bundle."* → **o plano já nomeava
  exatamente o buraco medido hoje**;
- l.332 — *"Extend deferred reconstruction with an explicit native result kind. **Keep the
  current Iter9 result path unchanged.**"*;
- l.344 (portão de saída) — *"A real clone can produce a validated immutable descriptor
  through a non-UI API"*;
- l.1441 (fora de escopo) — *"Converting all native clones to Iter9 HTML."*

**Onde parou, medido no código:** o lado **receptor** foi construído —
`normalizeReconstructionOutput` aceita `kind: 'native'` e `lib/native-clone/` registra,
versiona e serve o bundle. O lado **produtor** não: nada no repositório emite
`kind: 'native'`, então `producer = reconstructPage` segue sendo o único caminho real.

A tarefa da l.332 ficou **pela metade**, e é ela que liga tudo o que já existe.

---

## 9. ⚠️ CORREÇÃO — os 13% não são fidelidade de clone, e nem são o alcance do editor

Pergunta do Adilson: *"os 13% de alcance do bridge significam a porcentagem de sites que
conseguimos entregar o clone fiel?"* **Não** — e a pergunta expôs duas imprecisões minhas.

### Erro 1: eu misturei dois eixos independentes

| eixo | o que é | o que está medido |
|---|---|---|
| **fidelidade do clone** | o clone se parece com o site | **UM site** (farmminerals, SSIM 0,96, altura exata). **Sem número de população.** |
| **alcance do editor** | o editor enxerga o movimento | ver abaixo |

São independentes: o processo do clone bom **não depende de `window.gsap`** — ele baixa
assets e preserva scripts. Um site sem GSAP nenhum pode ter clone perfeito.

⚠️ **A fidelidade de clone na população-alvo NUNCA foi medida.** Uma amostra do banco com a
régua ancorada fecharia isso, e não foi feita.

### Erro 2: "a máquina é em formato GSAP" é FALSO

O bridge tem um caminho de **animação do navegador** (WAAPI/CSS) além do de GSAP:

- registra com `type: 'browser'` (l.473);
- inventaria **por elemento**, com `element.getAnimations({ subtree: true })` (l.2959-2960,
  6381-6382) — não precisa de nenhum global;
- tem escritor próprio, `applyBrowserRetarget` (l.5918);
- `timelineSnapshot` e o seek têm ramo `browser` dedicado (l.3003, 7396+).

Então os **13%** medem só **onde o inventário de GSAP funciona** (`window.gsap` alcançável).
**Não** medem o alcance do editor, que inclui o caminho do navegador — presente em 39% dos
sites da amostra por WAAPI, mais os de `@keyframes` CSS.

**O alcance real do editor está NÃO MEDIDO, e é maior que 13%.** Medir exige cuidado:
`getAnimations()` devolve o que está **ativo naquele instante**, então uma varredura ingênua
subestima.

### O que isto muda na ordem do próximo passo

A medição que eu havia proposto (rodar o processo do clone bom num site de GSAP empacotado)
continua válida, mas **deixa de ser a que decide o escopo** — porque o teto de 13% não era o
teto do editor. Antes dela vem uma medição mais barata e mais decisiva: **rodar o inventário
REAL do bridge** (GSAP + navegador) sobre a amostra do banco, e ver quanto do movimento ele
enxerga de fato. É a mesma amostra e o mesmo harness; muda só o que se conta.

---

## 10. ALCANCE DO EDITOR — o que sobrevive, e por que o número NÃO vale (2026-08-12)

Pedido do Adilson: *"pro usuário não importa se é GSAP ou WAAPI, ele vê animação e quer
editar — preciso saber quanto o editor alcança."*

Instrumento: `_probe-alcance-editor.mjs`. Denominador = elementos cuja aparência própria
muda em 7 posições de rolagem × 2 instantes. Numerador = clicar no elemento (como o usuário
faria) e ver se `selection-changed` traz `element.motion`. Controle = clicar em elementos
parados.

### Medido em 8 sites

| site | se mexem | alcance na amostra | motores |
|---|---|---|---|
| gsap.com | 318/1507 | 50% | GSAP |
| byld.dev | 41/373 | 30% | **CSS + WAAPI** |
| microdot.vision | 91/850 | 23% | **CSS + WAAPI** |
| clone bom (farmminerals) | 967/2570 | 17% | GSAP |
| linear.app | 56/3978 | 3% | CSS |
| alfacharlie.co | 37/888 | 3% ⚠️ controle 6/15 | CSS |
| stripe.com | 44/2641 | **0%** | — |
| ueno.co | 9/326 | 0% | — |

### ⭐ O que SOBREVIVE à auditoria (não depende do denominador)

**O editor alcança CSS e WAAPI, não só GSAP.** byld.dev devolveu 8 clipes WAAPI + 1 CSS;
microdot, 6 CSS; linear, 1 CSS. Isso é observação direta do que o bridge publicou, e
**refuta definitivamente** a afirmação que eu vinha repetindo de que "a máquina é em formato
GSAP" e de que o alcance seria os 13% de `window.gsap`.

### ❌ O que NÃO vale: o percentual

**Auditoria do Sol, e ele está certo em todos os pontos.**

1. **O denominador não é métrica de produto.** Mede "nós cujo valor CSS mudou", não
   "movimentos que o usuário percebe". E é **internamente inconsistente**: `visibility` é
   herdada — um pai escondendo multiplica descendentes — enquanto `transform` e `opacity`
   computados **não** são herdados. Também ficam de fora `clip-path`, filtro, geometria, SVG,
   canvas e vídeo, e entram mudanças invisíveis e microscópicas sem limiar perceptual.
   A unidade certa é o **episódio visual editável**, agrupado por sincronismo, trajetória e
   gatilho — independentemente de como o editor agrupa — com validação humana cega.
2. ❌ **Minha suspeita do SplitText estava mal fundamentada.** Eu li
   `resolveuNoMesmoElemento = 1/5` como prova de que o agrupamento deprimia o número. Não
   prova: como cada fragmento clicado pode resolver para o mesmo host e contar como sucesso,
   a duplicação pode **inflar** tanto quanto deprimir.
3. **O numerador é injusto E generoso ao mesmo tempo.** Injusto: observo primeiro e clico
   segundos depois, quando one-shots já terminaram ou se destacaram; o bridge só é ligado
   depois da observação. Generoso: `dispatchEvent` **não é clique real** (sem hit-test,
   overlay, `pointer-events`); qualquer clipe do ancestral conta mesmo sem ser a causa do
   movimento observado; e "existe clipe" ≠ "existe propriedade editável e persistível".
4. **O controle é fraco.** 0 de 15 ainda admite ~18% de falso positivo no limite superior de
   95%, e 5/30 contra 0/15 dá **Fisher unilateral ≈ 0,117** — não é significativo.
5. **A amostra de 30 não é aleatória** — é sistemática pela ordem de inserção no `Set`,
   vulnerável a agrupamentos do DOM.
6. **O que 16,7% sustentaria, no melhor caso:** só "neste clone, neste viewport, nesta
   execução e nesta unidade, ~1 em 6 episódios amostrados". Wilson ≈ **7,3%–33,6%**. Não
   sustenta cobertura de produto, nem que os outros 83% sejam ineditáveis. E mede
   **descoberta**, não **edição concluída**.

### O que seria preciso para ter o número

Unidade = episódio visual, definida antes e validada às cegas; observação e clique **no mesmo
estado** (página nova por alvo); **clique real**, não evento sintético; verificar que o clipe
publicado é de fato o **escritor** da mudança observada; controles **pareados** por seção,
tag, profundidade e visibilidade, incluindo negativos cujo ancestral tenha movimento não
relacionado; amostra **aleatória**; e um numerador que meça **edição concluída**, não
publicação de clipe.

É trabalho de dias, não de uma tarde. **Não iniciado** — decisão do Adilson.

---

## 11. ⭐ O EDITOR FUNCIONA — verificado visualmente sobre o clone bom (2026-08-12)

O Adilson: *"não tenho visibilidade real (visual) do estado que está e isso é agonizante…
preciso entender se ainda existe chance desse editor funcionar."* Parei de medir e liguei.

**Comando:** `UNCRAFT_NATIVE_CLONE_ROOT=~/Desktop/IA/Unspirit-Clone-1to1/site npm run dev:motion`
→ `http://localhost:3032/motion-editor`.

**Resultado, capturado em imagem:**

- o editor abre sobre o clone bom e mostra **"Runtime connected"**, com **zero erros de
  console**;
- detecta 15 cores do documento; o clone renderiza correto (tipografia, cores, hero, imagem);
- selecionando o `h2` *"How much could you grow — if nothing was wasted?"*, a aba **Motion**
  lê a animação **real do site**: engine **GSAP**, adaptador **Known**, driver **Time**,
  **delay 500ms**, **duração 1060ms**, iterações 1, curva **power2.out** com a curva
  desenhada, e **`autoAlpha` com 2 keyframes**;
- a **timeline** embaixo lista as trilhas do site (`Fertilizer, Rei…`, `100 kg of fer…`,
  `How much could yo…`, `We found a bette…`, `Smaller than …`) com marcas de keyframe e
  cabeçote;
- e mostra um aviso honesto: *"Text is split by the animation runtime. A production save
  must rebuild its split instance."*

**Isto encerra a dúvida sobre viabilidade.** O editor lê e apresenta movimento real de um
site real, sobre o clone de maior fidelidade do projeto. Não é protótipo nem fixture
sintética — é o clone com 369 assets e GSAP 3.15 de verdade.

### O que separa isso do produto

Duas coisas, ambas nomeadas e pequenas perto do que já existe:

1. **o produtor** — nada emite `kind: 'native'`, então o Edit do canvas cai no iter9, que
   descarta o movimento (§6, §7). O lado receptor, o contrato e o armazenamento já existem, e
   `registerNativeBundle` aceita **`sourceRoot`**: apontar para um diretório já é suficiente;
2. **a flag** — `NEXT_PUBLIC_NATIVE_MOTION_CANVAS_EDIT` é falsa, então o canvas não roteia
   para o editor nativo mesmo havendo bundle.

### Nota de método para as próximas sessões

As quatro réguas erradas desta sessão (§4, §5, §9, §10) custaram horas de leitura do Adilson
e **não mediram o produto** — mediram alinhamento entre coordenadas incomparáveis. O que
respondeu a pergunta dele em vinte minutos foi **abrir o programa e tirar uma foto**.
Regra: quando a pergunta é "isto funciona?", a primeira tentativa é executar e mostrar, não
instrumentar.

---

## 12. ⭐ FECHADO — o produtor existe, está ligado e endurecido (2026-08-12)

O que estava desconectado desde sempre agora está conectado.

### O que foi construído

**`lib/native-clone/capture-bundle.js`** — o produtor que a l.332 do plano pedia e que nunca
foi escrito. Faz o oposto do iter9: em vez de reconstruir a aparência por visão, **preserva o
site** — intercepta cada resposta de rede, percorre a página para disparar recurso preguiçoso,
reescreve referências para caminhos do bundle e mantém os scripts vivos.

**`chooseReconstructionProducer(reason)`** em `deferred-reconstruction.js` — `reason: 'edit'`
usa o produtor nativo; as demais razões continuam no iter9, intacto. Interruptor
`UNCRAFT_NATIVE_CLONE_PRODUCER=off`.

**`NEXT_PUBLIC_NATIVE_MOTION_CANVAS_EDIT=true`** no `.env.local`.

### Medido, não afirmado

| | iter9 (antes) | produtor nativo (agora) |
|---|---|---|
| tempo | 177s | **22s** |
| saída | 73KB de HTML de visão | 323 arquivos preservados |
| movimento na saída | **zero** | **184 tweens + 51 ScrollTriggers vivos** |
| altura vs original | ~metade | o site inteiro |

Editor sobre o bundle endurecido: **"Runtime connected"**, zero erros de página, 11 scripts
carregando, 0 com `integrity` (a remoção funcionou e os scripts seguem carregando), elemento
selecionado mostra `Animation: Editable`.

### Auditoria do Sol — BLOQUEOU o merge, 6 achados corrigidos

3 P0: **SSRF com exfiltração** (o produtor grava corpos num bundle que o usuário vê — bloqueio
por DNS exigindo que TODOS os endereços resolvidos sejam públicos, contra rebind; verificado
que o metadata da AWS devolve `blocked_host`); **timeout não cancelava** (agora `AbortSignal`
+ teto de altura); **limites não limitavam memória** (`res.body()` bufferizava antes da
checagem; agora reserva a vaga antes do `await` e confere `content-length`).

3 P1: corrida na coleta (handlers assíncronos não aguardados); entrada após redirect
(comparação sem fragmento dos dois lados); colisão de caminho (`/a%20b.js` × `/a_20b.js`, e
`A.js` × `a.js` no macOS) com desempate por hash; e **SRI** — reescrever o conteúdo invalidava
`integrity=` e o browser bloquearia o script que acabamos de preservar.

**MERGE OK dele no que já estava certo:** base64 real não contém o literal `https://`, então
data-URI está protegida; `url()` do CSS preserva aspas; ordenar por comprimento evita corrupção
de prefixo; traversal barrado; host externo isolado por path.

### Um achado dele aceito na observação e refutado na prescrição

O #10: `/run` passa `transform-target` e `runtime-source` — razões de "runtime editável" — e
cai no iter9. **Observação procede.** Mas ampliar as razões quebraria: verificado no código que
`/run` alimenta `runCompose` com `reconstructed.html`, e bundle nativo é diretório, sem `html`.
O limite de `'edit'` fica **deliberado e nomeado no código**, com teste usando as razões REAIS
da política — não as inventadas que eu tinha usado e que o Sol pegou.

**Buraco que fica aberto, com causa:** uma aresta que pede "preserve o movimento" ainda recebe
fonte iter9 sem movimento, porque a composição é textual. Fechar exige compor sobre bundle —
outra feature, não fiação.

### Estado

Suíte **1748 passando**. O único arquivo vermelho é `lib/design/rubric.test.js`, que importa um
`slop-checks.js` inexistente — trabalho não commitado de **outra** sessão, verificado por
`git status`, não tocado aqui.

---

## 13. A escrita do painel NÃO chega ao site quando a animação já acabou (2026-08-13)

Pendência do item anterior: o valor digitado no painel chega ao site? Fechada, com uma
resposta que é um bug.

**O erro das tentativas anteriores** foi comparar coisas diferentes: eu digitava no campo e
perguntava a duração de um elemento que **eu** tinha marcado, e de um motor que **eu**
supunha. Corrigido em duas frentes: perguntar pelo elemento que o **próprio bridge** marca
com `data-uncraft-selected`, e pelo motor que o **editor diz** estar editando.

**Medido, na seleção que o editor fez sozinho** (`div.splide__slide`, motor **WAAPI**,
duração exibida **400ms**):

| | antes | depois de escrever 777 |
|---|---|---|
| animações WAAPI no elemento selecionado | **[]** | **[]** |
| animações GSAP no mesmo host | [1500ms] | [1500ms] |
| campo do painel | 400 | **1500** |
| contador do editor | — | **1 change** |

**O elemento não tem animação WAAPI nenhuma** — nem antes nem depois. O editor exibe e
oferece para editar uma animação de 400ms que **não existe mais na página**:
`getAnimations()` descarta animação já terminada que não preenche (`fill`), e o inventário
guardou a que existia quando ele olhou.

Consequência: a transação é registrada localmente (o contador vai a 1), mas não há o que
receber a escrita; em seguida o painel re-inspeciona e passa a mostrar **outra** animação
(a de GSAP, 1500ms), o que explica o número trocar sozinho depois de confirmar.

⚠️ **Escopo do que ficou provado:** isto vale para **animação já terminada**. **Não** testei
uma animação GSAP viva de ponta a ponta — nesta página todo clique resolve para o mesmo host
de slider, e não consegui selecionar outra por este caminho. Então: *"a escrita não chega
quando o alvo já acabou"* está estabelecido; *"a escrita nunca chega"* **não** está.

**O que isto sugere consertar** (não feito): o inventário não deveria oferecer como editável
uma animação que sumiu do elemento; e o painel não deveria trocar de animação em silêncio
depois de um commit.
