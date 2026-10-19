# Cópia editável em todas as telas (desktop, tablet, celular) — desenho

> Data: 2026-10-19 · Status: para revisão do Adilson · Origem: defeito relatado (cópia mais larga que o node,
> rolagem horizontal e faixa branca) · Decisões de produto: Adilson (2026-10-19) · Segunda opinião: Codex (advise)
> · Base: [cópia editável no Edit](2026-10-09-copia-editavel-no-edit-design.md), M1 entregue no `main`.

## 0. Resumo (o que o usuário vai ver)

1. Clica em Edit num site: a espera continua a mesma de hoje.
2. No editor, **Desktop, Tablet e Celular mostram a cópia gravada naquele tamanho**: sem rolagem horizontal, sem
   faixa branca, e no tablet o layout que o próprio site tem no tablet.
3. Uma edição **vale em todas as telas onde o mesmo elemento existe**. Onde ele não existe (sites que montam outra
   página no celular), vale só na tela em que foi feita, com um aviso. A opção "mudar só nesta tela" continua.
4. Cópias preparadas antes desta mudança abrem no desktop **reduzidas para caber**, com o aviso "Prepared for desktop
   only", e Tablet/Celular ficam desligados até preparar de novo.

## 1. Decisões de produto (Adilson, 2026-10-19)

| tema | decisão |
|---|---|
| Telas na primeira entrega | desktop, tablet e celular |
| Custo × espera | 4 gravações ao mesmo tempo, em 4 máquinas (espera igual à de hoje; 4× tempo de máquina) |
| Edição entre telas | vale em todas onde o elemento existe; senão só na tela feita, com aviso |

## 2. O que foi medido

**A cópia de hoje é uma foto do layout a 1440 px.** `scripts/normalizar-clone.mjs:595` grava numa tela 1440×1200 e
escreve o estilo CALCULADO de cada elemento (`width:1440px`, `grid-template-columns:470.016px 459px 459.016px`,
espaçamentos em px), sem regras por tamanho. O editor mostra o node a 1280×800, 768×920 e 390×844
(`lib/motion-editor/devices.js`). Medido na cópia do farmminerals a 1280: a página tem 1440 px de largura real e 189
elementos passam da borda (o bloco do topo, `#u-s0-div-bloco-2`, tem 1440 px fixos e começa em −80 px).

**O clone ORIGINAL se adapta a todas as telas** (sonda `_sondar-telas.mjs`, fotos em
`docs/superpowers/findings/2026-10-19-telas-clone-original/`):

| | 1440 | 1280 | 768 | 390 |
|---|---|---|---|---|
| farmminerals — cabe na tela | sim | sim | sim | sim |
| farmminerals — estrutura igual à do 1440 | — | 100% | 93% | 93% |
| farmminerals — altura da página (px) | 11.174 | 9.399 | 13.147 | 13.101 |
| landonorris — cabe na tela | sim | sim | sim | sim |
| landonorris — estrutura igual à do 1440 | — | 100% | **7%** | **7%** |

Leitura: o desktop 1280 tem a mesma página do 1440; abaixo do desktop há dois tipos de site — os que reorganizam a
mesma página (farmminerals) e os que montam **outra** página (landonorris). A altura muda por tela, então as
animações de rolagem (`motor.inicio/fim` em px absolutos) também são por tela.

**Outros fatos que o desenho usa:**
- Trocar Desktop/Tablet no editor hoje **só muda a largura do mesmo documento** (`NativeEditViewport.jsx:97-151` abre
  a sessão uma vez por node; `changeDevice` só troca o aparelho; as edições "só nesta tela" são reaplicadas pelo
  `responsiveRuntimePatches`).
- O servidor de páginas do editor já serve **qualquer HTML do índice do pacote** pela mesma sessão
  (`runtime-gateway-core.js:290-303`); só falta o editor pedir a página certa.
- Os nomes dos elementos da cópia **não são estáveis entre telas**: o contador `-N` segue a ordem dos elementos que
  entram (os de `display:none` não entram), embrulhos são desfeitos pela geometria, e texto dividido depende do
  `display` (`normalizar-clone.mjs:125-185, :268`). Os ids das fichas de leitura (`m-leit-NNN`) são contadores da
  gravação.
- As interações do Webflow já escolhem o ponto de quebra pela largura (`ler-ix3.mjs:53`), hoje sempre com 1440.
- A régua de trajetória, a gravação de referência e a análise da cena 3D também fixam 1440×1200
  (`regua-trajetoria.mjs:160`, `gravar-trajetoria.mjs:234,242,298`, `plano-nativo.mjs:22,52,55`).

## 3. Perfis de tela

Quatro perfis, sempre como **par exato largura × altura** (a altura decide `vh`, fixos e onde termina a rolagem):

| perfil | tela | para que serve |
|---|---|---|
| `desktop` | 1280×800 | o que o editor mostra no Desktop; é a página principal do pacote |
| `tablet` | 768×920 | Tablet no editor |
| `celular` | 390×844 | Celular no editor |
| `ref` | 1440×1200 | régua de fidelidade (continua comparável com o histórico) e telas largas no futuro |

`overflow:hidden` não é conserto (esconderia os 189 elementos em vez de colocá-los no lugar) e não é usado.

## 4. Produção da cópia

### 4.1 Normalização por perfil
- `normalizarCaptura` ganha `perfil` (`{ nome, largura, altura }`) e a linha de comando ganha `--perfil` e
  `--sem-plano` como opção de verdade (hoje é lido de `process.argv`). Tudo que hoje usa 1440×1200 passa a usar o
  perfil: a página, o ponto de quebra do Webflow (`largura`), a lista de paradas e o fim da rolagem.
- **Chave de origem:** antes de qualquer decisão que dependa da geometria, cada elemento do clone original recebe
  `data-u-orig`, e a cópia carrega essa chave em cada elemento que mantém. A chave é feita para **nunca casar errado**,
  mesmo que case menos, em três níveis, nesta ordem:
  1. **Âncora estável:** o `id` do autor ou o `data-w-id` do Webflow.
  2. **Impressão do conteúdo, dentro de um pai já casado:** tag + texto próprio normalizado + `src`/`alt` da mídia +
     `href`. O casamento anda **de cima para baixo** pela árvore do clone ORIGINAL (a chave guarda também a do pai): um
     elemento só é elegível se o **pai dele já casou com o pai do candidato**; a impressão precisa ser **única entre os
     irmãos** daquele pai; contexto conflitante (o pai casou com X, o candidato está sob Y) rejeita o par. Uma
     impressão repetida **nunca** vira par — o caminho no documento não é desempate.
  3. **Contêiner sem conteúdo próprio** (o `div` que só embrulha): casa só se tiver âncora estável, OU se todos os seus
     descendentes já casados (níveis 1–2) caem dentro de **um único** candidato no outro perfil e ao menos um casou.
     Caso contrário, é exclusivo do perfil.
  Posição nunca vale: se no celular um cartão some, o seguinte não pode herdar o nome dele. Testes obrigatórios:
  (a) dois cartões irmãos sem conteúdo próprio distinto; o celular remove o primeiro; o segundo não herda a
  identidade; (b) `<a href="/produto-a"><span>Ver produto</span></a>` no desktop e o mesmo com `/produto-b` no
  celular: os links não casam, logo os `span` também não (sem pai casado).
  O casamento é feito sobre a árvore do clone ORIGINAL (onde o farmminerals é 93% igual entre telas), não sobre a
  estrutura da cópia, cujos embrulhos são desfeitos de forma diferente em cada tela.
- Saída por perfil: o documento (com o programa de movimento **embutido**, como o desenho da cópia já previa para a
  criação) e os arquivos que ele usa. Arquivos de mídia e `vendor/` são os mesmos nos quatro perfis.

### 4.2 Reconciliação dos nomes (sem navegador)
Depois das quatro gravações, uma passada no servidor dá a `tablet`, `celular` e `ref` os **mesmos ids do `desktop`**
quando o par é **verificável e único**:
- a chave de origem (4.1) aparece **uma única vez** em cada um dos dois perfis;
- a conferência de conteúdo bate (mesma tag, mesmo texto próprio, mesma mídia), e para contêineres a concordância
  dos descendentes casados (4.1, nível 3);
- qualquer dúvida — chave repetida, conteúdo diferente, mais de um candidato — vira **elemento exclusivo do perfil**.
Elementos sem par ficam com o id do próprio perfil, com prefixo do perfil para nunca colidir com um id do desktop.
A troca de id usa **um mapa só** e reescreve **todas** as referências internas: o atributo `id`, os seletores `#id` do
CSS, `href="#…"`, `for`, `aria-labelledby`/`aria-controls`/`aria-describedby`, `href`/`xlink:href` de SVG e `url(#…)`
em atributos e declarações CSS, os `alvo`/`sequencia` do programa e o plano. Depois da troca, verifica-se que nenhuma
referência que antes resolvia ficou pendente; se ficar, a reconciliação daquele perfil falha e ele segue sem pares.
Resultado medido e guardado: quantos elementos de cada perfil ganharam par (o casamento).
Os ids das fichas de movimento não são reconciliados nesta etapa (a edição de animação entre telas é da parte 4).

### 4.3 A tarefa com quatro máquinas
- `canonical_jobs` continua a tarefa (uma ativa por node, publicação por comparação-e-troca, cobrança, limpeza).
  Nasce uma tabela filha **`canonical_job_profiles`** (`job_id`, `perfil`, `status`, `sandbox_name`, `command_id`,
  `attempt`, `progress_pct`, `error_code`), com a mesma cerca por geração e dono da trava.
- Cada perfil roda numa máquina própria (nome determinístico `uc-canon-<job>-<perfil>-a<n>`), com o script de hoje e
  o `--perfil`. Recomeço do zero: por perfil, uma vez.
- **O número da tela é o do perfil mais lento**, e nunca volta.
- Tudo ou nada nesta etapa: se um perfil falha depois do recomeço, a tarefa falha com o código dele.
- A limpeza (desligar máquinas, encerrar a cobrança) cobre as quatro; `cleanup_done` só com as quatro confirmadas.

### 4.4 O pacote e quem abre qual página
Um pacote só: `index.desktop.html`, `index.tablet.html`, `index.celular.html`, `index.ref.html`, mais mídia e `vendor/`
partilhados. O descritor ganha a lista de perfis (`profiles: [{ nome, largura, altura, documento }]`).
Contrato de quem consome:
- **Editor:** abre o documento do aparelho escolhido (5.1).
- **Página principal `index.html`:** é um **seletor** pequeno — escolhe o documento do perfil pela largura da tela
  ao abrir (e troca se a largura cruzar um ponto de quebra). Assim, quem abre o pacote fora do editor (pré-visualizar,
  abrir no navegador, exportar) recebe o celular no celular.
- **Criação por nodes:** continua lendo `snapshots.html`, que guarda o documento **desktop** (limite declarado: a
  criação parte do desktop).
- **Edições salvas:** quando a parte 3 (materializar as edições) chegar, ela materializa **cada** documento de perfil
  com as edições compartilhadas e as daquele perfil. Verificação obrigatória: abrir a página publicada no celular com
  uma edição compartilhada e uma só do celular, e as duas aparecerem certas.

## 5. Mostrar e editar

### 5.1 Trocar de tela carrega a página daquela tela
A sessão do editor passa a saber o aparelho: trocar Desktop/Tablet/Celular abre a página do perfil
(`index.tablet.html`…) na mesma sessão. A troca recarrega o documento; a seleção volta pelo id quando o elemento
existe na outra tela.

### 5.2 Edição entre telas
- Como os ids casam entre perfis (4.2), uma edição "em todas as telas" aponta para o **mesmo id** em cada página.
- **Valor original é de cada perfil.** O mecanismo de hoje (`responsive-manifest.js`) supõe um documento só: sem
  edição para o aparelho, ele reaplica o `sharedValue` — que, com páginas diferentes, seria o valor do desktop por cima
  do valor original do tablet. Passa a valer: **só se reaplica o que foi editado de verdade** — edição compartilhada
  vai para todos os perfis onde o id existe; edição "só nesta tela" vai só para aquele perfil; propriedade sem edição
  aplicável **não gera nada** e o documento carregado fica com o seu valor original. O estado efetivo é reaplicado
  depois que cada documento novo fica pronto. Teste obrigatório: editar só no desktop deixa intacto o valor original
  do tablet.
- **Elemento que não existe numa tela:** ao reaplicar as edições nessa tela, as que apontam para um id ausente são
  separadas ANTES de aplicar (a aplicação é tudo ou nada; um alvo ausente derrubaria a transação inteira) e o editor
  avisa: "2 edits don't apply on Tablet (element not on this layout)".
- O editor mostra, na hora de editar, se o elemento existe nas outras telas.

### 5.3 Cópias antigas (um perfil só)
Abrem no Desktop reduzidas para caber na largura do node, com o aviso "Prepared for desktop only — prepare again for
tablet and mobile"; Tablet e Celular ficam desligados com a mesma explicação.

## 6. Medir antes de valer

- **Régua por perfil:** cada perfil da cópia contra o clone original no MESMO tamanho (a régua e a gravação de
  referência ganham o perfil). O `ref` (1440) continua comparável com o histórico.
- **Casamento entre telas:** porcentagem de elementos de `tablet`/`celular` com par no `desktop`. Esperado: alto no
  farmminerals, perto de zero no landonorris; o número não é meta, é o que decide se o aviso de "não existe nesta
  tela" vai aparecer muito.
- **Sem rolagem horizontal** em nenhum perfil (`scrollWidth ≤ innerWidth`) nos 5 sites da bateria.

## 7. Entregas

1. **T1 — Desktop certo:** a cópia passa a ser gravada a 1280×800 (perfil `desktop`), com a régua no mesmo tamanho.
   Corrige o defeito relatado. Ainda é um perfil só: o Desktop já abre certo (sem redução), e Tablet/Celular ficam
   desligados com o aviso de 5.3 até a T2.
   *Como saiu (2026-10-19):* a cópia declara a tela em `<html data-u-tela>` e a régua recusa medir em outra. O node
   guarda `meta.canonicalCopy = { bundleId, screens }` na publicação; a trava vale só enquanto o node mostra aquele
   pacote (Reset volta ao clone original, que se adapta a qualquer tela). Clicar em Tablet/Mobile mostra "This
   editable copy was prepared for desktop only" — o texto de 5.3 ("prepare again…") só faz sentido quando preparar
   de novo der as outras telas (T2). Nomes no código: `mobile` (= celular, o id do aparelho no editor) e `reference`
   (= ref). Cópias preparadas ANTES da T1 (gravadas a 1440) não têm a marca e continuam transbordando: Reset + Edit
   prepara uma nova.
2. **T2 — Quatro perfis:** quatro máquinas, tabela filha, pacote com quatro páginas e o seletor, troca de tela
   carregando a página do perfil, cópias antigas com o aviso. **Na T2 toda edição vale só na tela em que foi feita**:
   os ids ainda não estão reconciliados, e um id que por acaso coincida entre perfis apontaria para elementos
   diferentes. A edição compartilhada só liga na T3.
3. **T3 — Os mesmos nomes entre telas:** chave de origem, reconciliação, edição entre telas com aviso, medição do
   casamento.

## 8. Riscos e resíduos

- **Identidade entre telas é por evidência, não por prova.** A auditoria (Codex, 3 rodadas) achou três contraexemplos
  seguidos para regras de casamento — o terceiro levou à regra de cima para baixo com pai casado. Paramos pelo teto
  (o tema repetiu). Resíduo declarado: num caso exótico ainda pode haver par errado. Proteções: (1) na hora de editar,
  o editor mostra **em quais telas a edição vai valer** e permite "só nesta tela"; (2) a T3 só liga a edição
  compartilhada depois de conferir os pares nos 5 sites da bateria **olhando** (foto lado a lado de uma amostra de
  pares por perfil), não só pela porcentagem.

- **Limite de máquinas simultâneas do plano da Vercel:** quatro por Edit pode bater no teto de concorrência do Hobby;
  medir em T2 (se bater, a tarefa enfileira os perfis — a espera cresce, o resultado é o mesmo).
- **Texto dividido em linhas** (SplitText) muda com a largura: as partes (`--l1`, `--w3`) não casam entre telas;
  o elemento pai casa.
- **Sites que montam outra página** (landonorris): quase nada casa entre telas, então quase toda edição fica na tela
  feita. É o comportamento fiel ao site, não um defeito.
- **Larguras intermediárias** (ex.: 1024) usam o perfil mais próximo; não há interpolação.
- A cena 3D (M2) e a edição de animação (M4) vão precisar de perfis também; ficam com as suas entregas.

## 9. Fora desta entrega

Larguras além das quatro; reconciliação dos ids das fichas de movimento; escolha de perfis pelo usuário; preparar só
alguns perfis.
