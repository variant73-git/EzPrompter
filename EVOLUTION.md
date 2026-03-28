# Repix — Da ideia ao produto: evolução estratégica

## Fase 1: O Prompt Describer (EzPrompter)

**Decisão inicial:** resolver um problema real e específico — reverse-engineer de prompts de imagens. Clique direito, IA analisa, salva prompt + metadata. Simples, funcional, zero fricção.

**Por que foi inteligente:** validou a hipótese de que o browser é o ponto de captura natural de referências visuais. Nenhum app nativo tem esse acesso privilegiado ao contexto onde o usuário encontra inspiração.

## Fase 2: De ferramenta para ponte (RepixBridge)

**Decisão:** não ser apenas um describer, mas uma **ponte** entre web e ferramentas criativas. Duas frentes: HTML→Design + Image Remix. O nome "Bridge" explicitava a proposta.

**Decisões de negócio:**
- **Dual-mode UI** com inversão de paleta — não é cosmético, é semântico. Dark = estrutura/código. Light = visual/imagem. O usuário sabe onde está pelo ambiente.
- **"Open in..."** com 6 modelos de IA — o produto não compete com nenhum model, conecta todos. É agnóstico. Isso é a uniqueness: o Repix não é um gerador, é um **roteador criativo**.
- **Figma plugin companion** — estender o valor para dentro da ferramenta de design. O capture não é fim, é meio.

## Fase 3: O modelo de monetização (Gated por conta)

**Decisão:** rejeitar license keys anônimas em favor de auth com conta. O argumento: "leads + canal de comunicação > receita imediata".

**Estrutura:**
- Free: describe prompts ilimitado (o hook que traz o usuário)
- Pro ($7/mês): capturas ilimitadas + geração inline
- Custo de infra: ~$0.001/usuário. Margem de >99%.

**Por que foi inteligente:** o free tier entrega valor real sem API (Ollama + Pencil = $0). O usuário experimenta o produto completo antes de pagar. O paywall aparece no momento de maior valor percebido (geração), não na entrada.

## Fase 4: De ponte para editor (Repix)

**Decisão que mudou tudo:** o nome perdeu o "Bridge". Não é mais uma ponte — é **a ferramenta**. O browser não é o ponto de partida, é o workspace.

**O conceito:**

> O browser é a última ferramenta de design que faltava. Não é roubar site. É design direto no HTML. Referências não são tabu — são o início real de todo processo criativo.

Isso posiciona o Repix como **a evolução pós-IA para design**. Depois do Lovable, do Stitch, do Figma MCP — todos geram código a partir de prompts. O Repix inverte: parte do que **já existe na web** e transforma. É atemporal porque a web é a base de tudo.

**Decisões de produto nesta fase:**
- **Editor de JSON categorizado** (7 categorias: Subject, Environment, Style, Color, Mood, Camera, Lighting, Technical) — transforma metadata crua em interface de design. O prompt vira um painel de controle.
- **Color swatch pills** — hex values viram elementos visuais editáveis. O JSON é a linguagem, mas a UI é o canvas.
- **Geração inline** — o remix acontece **dentro do browser**, no contexto da referência original. Sem trocar de janela, sem upload, sem contexto perdido.
- **Grid de imagens estilo Pinterest** — a extensão mostra as imagens do site como um feed visual. O browser vira uma galeria curada automaticamente.

## Fase 5: Progressive Gate — a decisão de conversão mais sofisticada

**O insight:** forçar setup antes de explorar = abandono. Mostrar erro técnico = frustração. O Progressive Gate resolve ambos:

| Nível | Estado | Experiência |
|-------|--------|-------------|
| 0 — Explorar | Sem API | Tudo visível, tudo navegável. Zero bloqueio. |
| 1 — Tentar | Clica em Repix/Generate | Inline: "Connect [Provider] to unlock" + Quick Setup (1 tap) |
| 2 — Conectado | API ativa | Zero fricção. Tudo funciona. |

**Por que é superior ao paywall tradicional:**
- O usuário vê o valor antes de decidir
- A linguagem é de produto ("unlock this"), não de dev ("API key not configured")
- O Quick Setup Wizard (5 presets) resolve em 30 segundos
- O gate é contextual — aparece onde o valor é máximo, não na porta de entrada

**Os 5 presets do Quick Setup:**
1. **Zero Setup** — Ollama + Pencil = $0
2. **OpenAI All-in-One** — 1 key resolve tudo
3. **Pro Quality** — Stability AI + melhor modelo
4. **Offline** — 100% local, zero dependência
5. **Custom** — escolhe cada peça

## A uniqueness

O mercado tem geradores (Midjourney, DALL-E), tem ferramentas de design (Figma, Sketch), tem AI-to-code (Lovable, v0). Ninguém fez **web-to-design**. O Repix é:

1. **O único que parte da referência**, não do prompt vazio
2. **Agnóstico de modelo** — conecta qualquer IA, qualquer design tool
3. **Vive onde a inspiração acontece** — o browser
4. **Transforma consumo em criação** — navegar vira projetar
5. **Borderless por design** — sem janelas, sem upload, sem troca de contexto. O panel flutua sobre o site que é a referência

## O arco narrativo

```
Simples prompter → Ponte para ferramentas → Editor no browser → Design where design lives
```

Cada fase manteve o que funcionava e adicionou uma camada. Nenhuma feature foi descartada — foram **integradas**. O describe virou o motor do remix. O remix virou o input do editor. O editor vive no browser. O browser é a ferramenta.

## Conceito fundador

Transformar o próprio browser numa ferramenta de design a partir da edição da referência — right where design happens. Não é roubar site. É design direto no HTML. Referências não são tabu, e sim o real início de todo processo de design.

Após a IA para design (do Lovable ao Stitch, do Figma MCP ao v0), o Repix é o passo seguinte da revolução. É a evolução atemporal, já que a web é a base de tudo — onde todas as ferramentas de IA rodam, onde a internet acontece, e onde o design da internet se manifesta.
