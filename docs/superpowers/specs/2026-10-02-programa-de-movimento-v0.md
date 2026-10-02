# Programa de movimento v0 — a "ficha" e o tocador

> **Data:** 2026-10-02 · **Decisão de produto:** caminho B (Adilson, 2026-10-02) — o movimento de um clone canônico é DESCRIÇÃO EM DADOS executada por um tocador NOSSO; texto animado guardado inteiro e cortado na hora. Direção já validada em 2026-08-10 (`handoffs/2026-08-10-re-expressar-vs-herdar-advise-e-censo.md`). Esquema da página: `2026-10-01-esquema-canonico-do-editor-rascunho.md`.

## 1. As três lições que este desenho obedece (medidas, não opinião)

1. **Separar rolagem de tempo ANTES de compilar.** O spike de 11/08 tratou toda animação como dirigida pela rolagem e PIOROU o clone (0,549 → 0,701). Toda ficha declara o seu MOTOR: rolagem, tempo, carga, hover.
2. **Um só motor com autoridade.** O clone nativo fica como oráculo e reserva; o clone canônico roda SÓ o tocador — nenhuma linha do código de animação original. Promoção pelo clone INTEIRO.
3. **Três braços.** O original (O), o clone nativo de hoje (H) e o clone re-expresso (R). Defeito velho da captura nunca é atribuído ao tocador.

## 2. A ficha (`motion.json`, ao lado do `index.html`)

```json
{
  "versao": 0,
  "rolagemSuave": { "tipo": "lenis", "lerp": 0.1 },
  "fichas": [
    {
      "id": "m-hero-titulo-entrada",
      "alvo": "#u-hero-titulo",
      "dividir": "chars",
      "motor": { "tipo": "carga", "atraso": 0.2 },
      "de": { "opacity": 0, "y": 40 },
      "para": { "opacity": 1, "y": 0 },
      "duracao": 0.8,
      "curva": "power2.out",
      "intervalo": 0.03
    },
    {
      "id": "m-sec2-imagem-parallax",
      "alvo": "#u-sec2-imagem",
      "motor": { "tipo": "rolagem", "inicio": "top bottom", "fim": "bottom top", "arrasto": true },
      "de": { "y": -80 },
      "para": { "y": 80 },
      "curva": "none"
    }
  ]
}
```

**Campos:**
- `id` — descritivo, único (regra 1 do esquema); é por ele que o painel edita e desfaz.
- `alvo` — `#id` de UM nó, ou lista de ids (grupo). Nunca seletor de classe do site.
- `motor.tipo`:
  - `carga` — toca uma vez depois de carregar (`atraso` em s);
  - `rolagem` — ligada à rolagem: `inicio`/`fim` no formato ScrollTrigger (`"top 80%"`); `arrasto: true` = acompanha a rolagem (scrub), `false` = dispara ao entrar (com `acoes`, ex.: `"play none none reverse"`); `fixar: true` = pin;
  - `tempo` — laço independente da rolagem (`repetir: -1`, `vaiVolta`);
  - `hover` — toca ao passar o mouse sobre `alvo` (ou `gatilho`, outro id), volta ao sair.
- `de` / `para` — valores ABSOLUTOS das propriedades (transform em campos separados: `x`, `y`, `scale`, `rotate`; mais `opacity`, cores, `clipPath`, `filter`). Ou `quadros: [{…}, {…}]` para mais de dois estados.
- `duracao`, `curva`, `atraso`, `repetir`, `vaiVolta` — tempo.
- `dividir` — `chars` | `words` | `lines`: o tocador corta o TEXTO INTEIRO na hora e anima as partes com `intervalo` (stagger). O documento guardado nunca tem as partes.
- `sequencia` — opcional: `{ "id": "s-hero", "motor": {…}, "passos": [{ "ficha": "m-…", "em": "<" }] }` para encadear fichas numa linha do tempo.

**Superfícies opacas** (sem ficha de propriedade, mas COM nó e id): vídeo (`<video>` com `autoplay muted loop playsinline`, trocável — esquema, regra "vídeo"), Lottie (`{"tipo":"lottie","alvo":…,"src":…,"motor":…}`, tocado por lottie-web), canvas/WebGL (ilha preservada, isolada no próprio elemento, declarada no relatório).

**Fora do v0** (o compilador DECLARA e o clone fica no nativo — promoção é pelo clone inteiro): valores por função ou aleatórios, motionPath, morph de SVG, física, rAF próprio, arrastar, criação dinâmica de animações depois da carga.

## 3. O tocador (`uncraft-motion.js`)

- ~200 linhas sobre GSAP + ScrollTrigger (vendorizados no pacote, nada de CDN) e Lenis opcional. Lê `motion.json`, valida, cria uma animação por ficha. Nenhum código do site roda.
- Corte de texto próprio (sem dependência de SplitText): envolve palavras/letras em `span` na hora, guarda o texto original e o RESTAURA ao desmontar — editar o texto é editar o texto.
- Expõe `window.__uncraftMotion` com `montar()`, `desmontar()`, `fichas()` e `aplicar(id, campos)` (para o painel: muda campos de uma ficha e remonta só ela).
- Valida antes de tocar: ficha inválida é ignorada e REPORTADA (nunca lança e derruba a página).

## 4. Aceite — regras fixadas ANTES dos dados

Para a execução 2 (farmminerals, um agente gera página canônica + `motion.json`):
- **Portão nos três braços** (O, H, R), passo 20 s, máquina ociosa. O piso é o site contra si mesmo (O1×O2) medido no MESMO dia.
- **Falha crítica binária** (qualquer uma reprova): altura da página fora de ±2%; seção ausente; hero errado; pin quebrado; movimento por região "congelado" (≥ 2 pontos) onde O é vivo; erro de console do tocador.
- **Cobertura Canônica de Edição** ≥ 90%: unidades visíveis com id descritivo, texto simples e alcançáveis, sobre unidades visíveis de O escolhidas antes.
- **Quatro edições de prova** feitas SÓ mudando o `motion.json` e observadas no navegador: mudar a duração; mudar o valor final; separar um alvo de um grupo; mudar o intervalo de rolagem. Cada uma tem que mudar o que se vê e nada além do alvo.
- **Zero código de animação original** no pacote R (busca por `gsap.to/from/timeline` fora do tocador).
- Resultado reportado como é. Se reprovar, o relatório diz em qual critério e por quê — nenhum ajuste de critério depois de ver os dados.
