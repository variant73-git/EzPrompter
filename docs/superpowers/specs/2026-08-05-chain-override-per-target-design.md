# Corrente → edição per-target por cima do vínculo (Opção A) — Design

> **Data:** 2026-08-05 · **Frente:** `live-animated-clone-editing` · **Status:** aprovado em
> brainstorm com o Adilson (2026-08-03→05), com consulta ao Sol (advise, effort max) incorporada.
>
> Substitui a promessa do `link.detach` ("clique e esta camada vira uma animação independente e
> EQUIVALENTE") — impossível de garantir em princípio para páginas arbitrárias, com 6 tentativas
> técnicas falhadas como evidência (handoff `2026-08-02-detach-continuity-fix-handoff.md` §0) e
> veredito do Sol confirmando: *"a fronteira real não é amostrável vs adaptativo; é runtime
> controlado/cooperativo vs programa arbitrário já vivo"*.

## 1. Contrato de produto (o que o usuário vê)

**Deixa de existir "operação de desacorrentar".** O usuário seleciona a camada acorrentada e
edita campos no inspector, como qualquer camada — a edição vale só pra ela, por cima do grupo.

- **Corrente = indicador puro** de grupo (tooltip diz de que grupo a camada faz parte). Sem ação
  de clique própria.
- **Promessa única:** *"todo controle visível e validado produz uma edição só desta camada."*
  Nunca recusa, nunca dialog bloqueante, nada condicionado a como o site original escreveu a
  animação (regra de produto do Adilson, itens 168 e handoff 2026-08-03 § guarda interna).
  Formulação calibrada pelo Sol: a promessa é sobre os controles que o editor EXPÕE (já
  validados por forma), não "qualquer propriedade de qualquer animação".
- **Editar o grupo** continua alcançando as camadas acorrentadas nas propriedades que elas não
  sobrescreveram.
- **Durante o play:** a camada continua animando e chega no valor editado — nas formas onde isso
  estiver PROVADO (Fase 0). Nas formas onde não for provável, a propriedade editada fica no valor
  dado, parada — comportamento definido por design (decisão consciente, mesma UI), nunca
  variação acidental.
- **Reversibilidade:**
  - Campo sobrescrito ganha **indicador discreto no inspector** (decisão do Adilson: "só nos
    campos" — nenhuma mudança visual na linha da camada). Clicar no indicador devolve **aquela
    propriedade** ao grupo.
  - **"Reset all changes"** da camada existe só no menu de contexto (botão direito na linha da
    camada), sem botão dedicado — modelo Figma.
  - **Cmd+Z** segue como hoje: cada edição = 1 transação com rollback exato.
- Texto de UI em **inglês** (regra do projeto).

## 2. Roteador interno — a escada (disposição do detach, decidida; não reabrir)

O detach não é removido nem vira menu avançado: o mecanismo sobrevive como **rota interna** da
mesma edição. Por baixo de um contrato único, o roteador escolhe a representação física por
**escada** (ordem do Sol, incorporada):

1. **Transplante da instância viva** — quando o GSAP já criou um filho interno por alvo
   (stagger/duração funcional): reparentear a PRÓPRIA instância (PropTweens, estado de plugin,
   randoms resolvidos, tempo local intactos) pra timeline independente. Evita exatamente a
   operação que falhou 6 vezes (reinicializar um clone a partir do DOM intermediário).
   **Candidato — precisa de probe (Fase 0), não está provado.**
2. **Divisão real** — só no universo controlado/cooperativo (formas core/CSSPlugin com witness
   de equivalência verde).
3. **Override por alvo** — o caminho que funciona sempre que o canal for escrevível com
   segurança (retarget per-target).
4. **Congelar-e-assumir** — último degrau: a propriedade fica no valor dado, parada.

**Obrigação de indistinguibilidade:** um degrau só é elegível se preservar o contrato do §1
por fora — em particular (a) o reset ao grupo reconstruível e (b) edições futuras do grupo
continuando a alcançar a camada nas propriedades não sobrescritas. Falhou qualquer um → desce
um degrau. A diferença entre degraus 1–3 e o 4 (anima vs parada) é atribuída **por classe de
forma, fixa e provada** — nunca decidida em tempo de execução por fator invisível.

Correção de honestidade (Sol): o antigo desenho "Opção C / mapa de PropTweens" **não fecha o
ponto cego por construção** — o mapa enumera o que plugins DECLARAM, não o que FAZEM dentro do
`render`. Se for construído, é um *classificador de detach suportado*: a segurança vem da lista
fechada de formas/plugins confiáveis + versão do GSAP fixada, não do mapa. Qualquer fast path
baseado em internals exige pin de versão/hash do GSAP.

## 3. Sequência — evidência antes de arquitetura (decisão do Adilson: provar primeiro)

**Fase 0 (provas; herda os 4 pré-requisitos do furo #4 + 2 novos):**

| # | Prova | Origem |
|---|-------|--------|
| P1 | SplitText REAL com re-split (fixture com a biblioteca de verdade, não spans à mão) | furo #4 |
| P2 | Conversão escalar→função por alvo sem quebrar a malha de proveniência/token da fase-2 | furo #4 |
| P3 | Caminho de escrita REAL do bridge (nunca `vars` direto); validar renderizando do início | furo #4 |
| P4 | Função-por-alvo no fluxo de edição real (multi-target simples) | furo #4 |
| P5 | **Transplante da instância viva** (filho de stagger → timeline independente; o que o pai carrega — repeat/callbacks/ScrollTrigger/timeScale — e o que precisa ser projetado no wrapper) | Sol |
| P6 | **Override sobrevive ao tick** — o residual do caminho de escrita (`sampleGsapValue`/`invalidatePreservingStart` restauram por `progress`; dano em edição de repeat/yoyo) é pré-requisito do degrau 3, não só item de fila | Sol + fila §1 do handoff |

Regras da fase: cada prova com witness próprio; REUSAR o rebobinador auditado da inspeção
(verdict + `totalTime` + unsampleable) — não construir outro instrumento; instrumento
independente do defeito medido; controle de sensibilidade; formas adaptativas confirmadas
como degrau 4 (ou promovidas pelo transplante, se P5 provar).

**Proibição explícita (Sol):** a Fase 0 valida o override e, separadamente, o candidato a
transplante. **Não é a 7ª tentativa de provar detach universal.**

**Fase 1 (arquitetura + implementação):** só começa com a Fase 0 fechada. O mapa
"forma → degrau da escada" sai das provas, não de argumento. Plano próprio via writing-plans.

## 4. O que não muda agora

- Até a Opção A existir, o comportamento shipado de hoje permanece (defeito do detach
  documentado e aceito; witness tracked com 11 RED = contrato do defeito).
- O código das rotas provadas do detach não é removido.
- Suíte 1536/1536 e witnesses verdes (fase-2, caminho-seguro, furo #2, inspeção) são o baseline.

## 5. Validação e método

- Tudo com auditoria do Sol antes de commit (standing rule; veto assimétrico — achado dele só
  entra confirmado rodando, refutação só com probe).
- Witnesses rodam de dentro de `packages/web-shell`, caminhos absolutos, fixture GSAP em
  `~/Desktop/IA/Unspirit-Clone-1to1/site`.
- Lições vigentes: provar que Y estava vivo antes de medir se X destrói Y; probe com controle
  de sensibilidade; fixture da biblioteca real, não à mão; validar renderizando do início.

## 6. Registro de decisões (quem decidiu o quê)

- **Adilson:** contrato sempre-override (nunca roteador visível); provar primeiro, entregar
  depois; reset por propriedade via indicador discreto + "Reset all changes" só no menu de
  contexto; indicador de sobrescrita só nos campos; disposição do detach como rota interna
  (handoff 2026-08-03, não reaberta).
- **Sol (advise 2026-08-05):** veredito "impossível em princípio para runtime arbitrário; caro
  e viável em universo fechado"; correções PropTweens-não-fecha e adaptativas-não-intrínsecas;
  escada de 4 degraus; caminho do transplante; promessa calibrada; estimativas (4–8 semanas
  fast path / 3–6 meses-eng universo fechado / universal sem cronograma honesto).
- **Claude (lead):** obrigação de indistinguibilidade entre degraus; P6 promovido a
  pré-requisito; síntese e este spec.
