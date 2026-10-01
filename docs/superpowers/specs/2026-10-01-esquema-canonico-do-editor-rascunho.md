# Esquema canônico do editor — RASCUNHO para validação do Adilson

> **Data:** 2026-10-01 · **Estado:** rascunho, NADA executado. É o pré-requisito escrito da execução 2 (homogeneização) do plano `2026-09-29-verbatim-agente-fatia-1.md` §10. A execução 2 gasta IA e só parte depois que este documento for aprovado — um esquema errado faria o agente homogeneizar para o alvo errado.
>
> **De onde vem:** inventário do código do editor feito em 2026-10-01 (referências `arquivo:linha` abaixo; RB = `packages/web-shell/lib/motion-editor/runtime-bridge-source.js`). Cada regra diz QUAL limite do editor ela atende. Nada aqui é preferência estética.

## O que "canônico" quer dizer

Uma página está no esquema canônico quando **toda unidade visível** (bloco de texto, mídia, container com peso visual) é **um nó que o editor nativo seleciona, edita e reencontra depois de recarregar**, sem adaptador específico do site. A medida é a **Cobertura Canônica de Edição** (§10 do plano): unidades visíveis editáveis pela API padrão e persistentes após reload ÷ unidades visíveis escolhidas antes na referência.

## Regras (cada uma amarrada a um limite medido do editor)

**1. Identidade estável e única em toda unidade editável.**
Todo nó editável leva um `id` único no documento (ex.: `u-hero-titulo`, `u-sec3-card2-img`).
- Por quê: o editor do clone só reencontra um elemento entre sessões por `[id]` ou `[data-w-id]` (RB:260-285); a semente por caminho muda em 92% dos elementos quando uma classe de ancestral alterna (RB:251-257). A porta de escrita recusa `unstable_identity` sem `id`/`data-w-id` e `ambiguous_identity` com duplicata (RB:9239-9256). Wrapper sem `id` não salva.

**2. Texto como texto simples, um nó por bloco.**
Cada bloco de texto visível é UM elemento de bloco (`h1`–`h6`, `p`, `a`, `button`, `li`, `label`…) contendo **só texto**, sem marcação filha.
- Por quê: texto com marcação filha é recusado (`rich_text`, RB:9331-9333). Texto quebrado em `.char`/`.word` gravado no HTML é achatado pelo replay (`textContent`, RB:7677).
- Consequência: efeitos de texto dividido (SplitText) são aplicados EM TEMPO DE EXECUÇÃO sobre o texto simples, nunca gravados como spans no documento.

**3. Estilo editável sem `!important` e sem quem o reescreva.**
As propriedades que o editor expõe (cor, fundo, opacidade, raio, tipografia, transform) vêm de CSS do autor sem `!important` no próprio nó, e nenhum script reescreve `style`/`className` depois de carregar.
- Por quê: a porta recusa propriedade mantida pelo site com `!important` (RB:9163-9210); a ponte não tem observador contra re-render de framework (0 ocorrências de MutationObserver no RB).

**4. Nada de camada invisível por cima.**
Nenhuma unidade editável sob `pointer-events:none` herdado nem coberta por uma camada transparente de viewport inteiro.
- Por quê: o portão mede hoje ~30% de nós visíveis obstruídos no farmminerals (414 de 1334 por percurso); a seleção nativa contorna parte disso (RB:6841-6855), o modo A não.

**5. Mídia como elemento direto.**
Imagem e vídeo como `<img>`/`<video>` com `src`/`srcset`/`poster`; fundo como `background-image` no próprio nó; SVG inline com `id` próprio; Lottie com `data-src`.
- Por quê: a porta só aceita os atributos `src`, `srcset`, `href`, `alt`, `poster` (RB:9221); a troca de SVG preserva o id (RB:7269-7283); a de Lottie é por `data-src` (sem reinício — limite conhecido).

**6. Movimento endereçado por `id`, um dono por canal.**
Cada animação mira nós pelo `id` da regra 1; cada canal (transform inteiro conta como UM canal, RB:9275-9282) tem um dono só; keyframes em forma de array com valores absolutos; sem valores por função/aleatórios e sem stagger nas animações que se quer editáveis.
- Por quê: canal com dois donos fica `ambiguous`/travado (motion-ownership.js:171-209); stagger e funções são reportados mas não editáveis (RB:2465-2481, 2579, 2582).

**7. Proibido no canônico:** cópia do DOM de origem; grafo de seletores específico do site (classes geradas como `.w-1a2b3c`); código executável da página além das bibliotecas e da declaração de movimento (regra 6). Conteúdo, mídia e bibliotecas originais podem ser reaproveitados.

## Decisões de PRODUTO (Adilson, 2026-10-01)

- **O que é editável (pergunta 2) — DECIDIDO:** tudo o que o painel do editor já prevê, como no Figma: sombras, arredondamento de bordas do bloco, todas as propriedades de mídia, texto, cor e fundo de um bloco. A regra 2/3/5 acima vale para todas essas propriedades, não só para as que o editor nativo expõe hoje (o editor nativo ainda não tem sombra, gradiente, padding/margem nem link — lacuna a fechar).
- **Nome dos ids (pergunta 3) — DECIDIDO:** sempre DESCRITIVO (`u-hero-titulo`, `u-sec3-video-fundo`).
- **Vídeo é cidadão de primeira classe — NOVO REQUISITO:**
  - Um site com vídeo precisa poder ter **só o vídeo trocado**.
  - **Por cadeias de nodes:** do site pode sair um node de MÍDIA e um node de HTML, se o usuário quiser separar; e um vídeo subido num node de mídia e LIGADO ao site que está sendo editado substitui o vídeo, conforme a ordem da cadeia.
  - **No painel do editor:** os vídeos do site aparecem para substituir, como os fundos. Um vídeo de site dirigido por rolagem é um vídeo de FUNDO, então a **aba de fundo aceita vídeo** quando houver. Cada seção pode ter o seu vídeo, e cada um é editável separadamente.
  - Consequência para o esquema: todo vídeo é um nó próprio com `id` descritivo (regra 1), ligado à SEÇÃO a que pertence, com `src`/`poster` substituíveis (regra 5) — nunca embutido em código de animação.
- **Movimento (pergunta 1) e texto dividido (pergunta 4):** explicados ao Adilson em linguagem simples; aguardando a escolha. Recomendação registrada: movimento como DESCRIÇÃO EM DADOS + motor nosso (editável igual em todo site; custo: construir o tocador antes da execução 2); texto guardado INTEIRO, com o corte em letras refeito na hora da animação.

## Perguntas de PRODUTO (decidem o desenho; não são técnicas)

1. **Como o movimento é expresso?** (a) código GSAP por site, escrito pelo agente seguindo a regra 6; ou (b) um manifesto declarativo de movimento + runtime NOSSO (a direção registrada em `decision_reexpressar_movimento_clone`). (b) é mais editável e homogêneo, mas exige construir o runtime antes da execução 2.
2. **Quais unidades contam como "visíveis"?** Proposta: todo bloco de texto, toda mídia e todo container com fundo, borda, sombra ou raio. Wrappers sem peso visual existem só para layout e não precisam ser editáveis.
3. **Nome dos ids:** semântico legível (`u-hero-titulo`) ou neutro (`u-0147`)? Semântico ajuda o painel de camadas; neutro é mais barato de gerar.
4. **Texto dividido:** aceitar que a animação de letras (SplitText) seja reaplicada em tempo de execução a partir do texto simples, como propõe a regra 2?

## Como a execução 2 usaria este documento

O prompt troca a cláusula do DOM pela do §10 do plano e anexa este esquema. Aceite pelo portão atual MAIS a Cobertura Canônica de Edição, que precisa ser implementada antes (o portão hoje mede patologias — `pe:none`, obstrução, split —, não conformidade ao esquema).
