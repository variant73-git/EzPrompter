# Handoff — próxima sessão (escrito em 2026-08-03)

> **Porta de entrada.** Substitui `2026-08-02-next-session-handoff.md`. O registro detalhado de
> evidência vive em `2026-08-02-detach-continuity-fix-handoff.md` (§ citadas abaixo) — quando
> precisar do detalhe, ler a § citada, nunca adivinhar.

## Estado

- Branch `codex/live-animated-clone-editing` · HEAD **`7cf15937`** · suíte **1536/1536** (10 skip).
- Witnesses verdes: fase-2, caminho-seguro, furo #2, **inspeção (novo, 9 casos)**.
- Witness do detach agora TRACKED (`_probe-detach-witness.mjs` + baseline): **11 RED limpos** =
  o contrato do defeito do detach, ainda aberto e documentado.

**Shipado nesta sessão:** `1ada4a7b` — **selecionar um elemento não danifica mais o estado
temporal** de tweens com `repeat`/`yoyo` (antes: looping voltava uma batida, vaivém invertia de
direção, a CADA clique; o cssText restaurado mascarava até o tick seguinte). Bônus: as trilhas
publicadas agora carregam o início verdadeiro. Formas adaptativas (`repeatRefresh`/`yoyoEase`/
`easeReverse`) viraram **unsampleable fail-closed**: end-only + lock, seleção inócua. Audit Sol
9 rodadas — 5 achados dele reproduzidos e corrigidos; dissenso final dele registrado (classe
r46, deferida). Detalhe: handoff do detach §0b.

**Aberto:** a continuidade do `link.detach` (o elemento salta ao desacorrentar no meio da
animação). **Seis tentativas técnicas falharam** — a última com instrumento provado e ainda
assim quatro defeitos achados por auditoria. Diagnóstico estrutural: *"o `cssText` enxerga tudo
que o tween escreve" não é estabelecível por enumeração* — o instrumento de verificação tem
ponto cego de tamanho desconhecido (handoff do detach §0, `28e29d40`).

## ⭐ Sugestão de contorno para a próxima sessão (a pergunta do Adilson: "rever o sistema de corrente/link?")

A corrente (ícone nas linhas de camada da timeline, quando várias camadas compartilham uma
animação) promete algo caro demais: *"clique e esta camada vira uma animação independente e
EQUIVALENTE"*. Seis tentativas mediram o custo dessa promessa. O contorno que recomendo ataca a
promessa, não o mecanismo:

### Opção A — RECOMENDADA: edição per-target por CIMA do vínculo (a corrente vira indicador, não botão de quebra)

**Ideia:** "quero mexer só nesta barra" deixa de significar *quebrar o vínculo* (irreversível
pra stagger) e passa a significar *editar por cima* — um override por-alvo, **reversível**, com
o compartilhado intacto por baixo. A corrente continua existindo como INDICADOR de grupo (com
tooltip), e o detach é rebaixado a operação avançada ou removido.

**Por que é viável — o que JÁ existe apontando pra cá:**
1. O retarget **por-componente/por-alvo já funciona** para canais single-owner (itens 167/168):
   editar X de um elemento cujo canal tem um dono é retarget genuíno, sem detach.
2. Os probes do furo #4 (item 172) mostraram que **função por alvo em `vars` isola o alvo com
   rollback exato** no multi-target simples, e que num stagger a verdade por-alvo vive nos
   **filhos internos** (`child.vars` + invalidate + render do início — validar SEMPRE
   renderizando a partir do início, lição do 172).
3. O fix da inspeção deixou um **rebobinador correto e auditado** neste exato seam (verdict +
   `totalTime` + unsampleable). Quem for escrever o override deve REUSAR esse seam — não
   construir outro (handoff do detach §0b, consequência).

**O que precisa ser decidido/provado (é o MESMO fork do furo #4 — tratar como uma conversa só):**
- A decisão de produto que o furo #4 já esperava: *vale a identidade registrada (converter
  escalar→função por alvo, que mexe na política auditada do canal keyframe) para ter edição
  per-target sem detach?* Esta opção responde SIM e materializa o valor.
- Os 4 pré-requisitos de evidência do furo #4 seguem valendo ANTES de arquitetura
  (handoff 2026-08-01 §3.3c e handoff de entrada anterior §1): SplitText REAL com re-split;
  interação com proveniência congelada/token da fase-2 (converter escalar→função muda o SHAPE
  de `vars` — a malha existe pra detectar isso); caminho de escrita REAL do bridge; e o detach
  NÃO validado como mecanismo (agora com 6 evidências contra).
- UX: o que a corrente mostra quando há override ativo (ex.: corrente + ponto), e onde vive o
  "reset to group".
- **Variante de promessa cumprível, a considerar no brainstorm:** redefinir o que a corrente
  promete. "Desacorrentar" hoje promete *"animação independente e EQUIVALENTE"* — a promessa
  impossível. *"Este elemento passa a ser meu daqui em diante"* (congela onde está, vira
  editável, o grupo segue sem ele) é **sempre cumprível**, em qualquer forma autoral, com zero
  recusa. Menos poderosa, 100% previsível.

### Recusa nas formas não comprovadas — DEMOVIDA de opção de produto a GUARDA INTERNA da A

> ⭐ **Decisão de produto do Adilson (2026-08-03), contrariando a proposta original deste
> handoff:** recusa voltada ao usuário ("isso não funciona nesse caso") é inaceitável — a
> condição da recusa é *como o site original escreveu a animação* (`from` vs `to`,
> `repeatRefresh`…), invisível e imprevisível pro usuário do Uncraft; a funcionalidade viraria
> loteria. Bate com a regra de produto do item 168 (nunca bloqueio sem escolha). A distinção
> que salva os locks do 168: lá o lock tranca um CAMPO com motivo acionável e caminho; aqui
> trancaria a FUNCIONALIDADE inteira condicionada a fator oculto.

O mecanismo continua valendo, mas **por dentro**: saber com precisão quais formas não podem ser
divididas com equivalência (o witness de 30 casos já diz) é o **roteador interno** da A — quando
o grupo não pode ser dividido de verdade, o clique na corrente devolve o override por cima, que
funciona sempre. O usuário vê UMA capacidade consistente ("posso sempre editar só esta camada");
a decisão dividir-vs-editar-por-cima fica invisível, onde inconsistência não machuca. **Nenhuma
recusa jamais chega ao usuário.**

### Opção C — só se o produto EXIGIR detach universal: mapa de cobertura por PropTweens

Perguntar ao próprio GSAP quais canais existem (cadeia viva `pt.d._pt` como **mapa de
cobertura** — os VALORES continuam vindo da medição; difere do leitor de internals descartado,
que reconstruía valores). Fecha o ponto cego por construção, mas: não cobre as formas
adaptativas (continuam não-amostráveis), apoia-se em internals com falha já medida pra plugins
(furo #2 v10) e variáveis entre versões de GSAP, e no melhor caso converge pra "guarda interna
com mais cobertura" — pagando caro por ela. Handoff do detach §"O desenho que fecharia a
classe". Não começar por aqui.

**Ordem recomendada: A (explorar produto, junto com o fork do furo #4), com a guarda interna
como roteador. C só se A morrer.** Se a sessão for de exploração da A, começar por brainstorm de
produto com o Adilson (regra dele decide o desenho — precedente do item 162), não por código.

## Fila depois

1. **Residual do caminho de ESCRITA** (mesma classe do fix shipado): `sampleGsapValue` e
   `invalidatePreservingStart` restauram por `progress` — dano em edição (não seleção) de tweens
   repeat/yoyo. Seam próprio, witness próprio; o padrão do fix da inspeção é o template.
2. **Furo #4** — absorvido pela Opção A acima se ela for adiante; senão, os pré-requisitos de
   evidência seguem como estavam.
3. **Residual do `</body>` no injetor** (independente, bounded): `injectRuntimeBridge` posiciona
   o script por `/<\/body>/i` — um `"</body>"` em string de script derruba a injeção; `<frameset>`
   não tem `</body>`. Pede política própria.
4. **Task 16 / gate persistido `/canvas`** — Tasks 12–20 (Task 14 = seam de fault em código de
   PROD, server-only fail-closed). Env Neon isolado `ep-orange-frost-acaedcil` — **NUNCA
   produção**. Plano `docs/superpowers/plans/2026-07-28-task16-persisted-e2e-gate-implementation.md`.
5. **r46** — deferida, dono Adilson, reabre por gatilho. O dissenso do Sol nas rodadas 7–9 desta
   sessão é mais um dado PRÓ-gatilho (ele insiste que as leituras pré-existentes de vars sob
   página adversarial merecem a obra), registrado com crédito no handoff do detach §0b.

## Como retomar

```bash
cd ~/Desktop/IA/Uncraft && git checkout codex/live-animated-clone-editing
cd packages/web-shell
npx vitest run                        # 1536
node _probe-inspect-witness.mjs       # inspeção — esperado "WITNESS VERDE"
node _probe-detach-witness.mjs        # detach — esperado 11 RED (o defeito aberto)
node _probe-phase2-witness.mjs        # esperado "TUDO VERDE"
node _probe-entryedit-witness.mjs     # esperado "TUDO VERDE"
node _probe-furo2-witness.mjs         # esperado "TUDO VERDE"
```

- Witnesses rodam de DENTRO de `packages/web-shell` (fixture GSAP em
  `~/Desktop/IA/Unspirit-Clone-1to1/site`). ⚠️ `cwd` herdado de comando composto mordeu DUAS
  sessões seguidas — caminho absoluto sempre; A/B de código por
  `git show HEAD:<path> > <path>`, nunca stash.
- Sol: `~/.claude/bin/codex-adversary.sh --mode prose --effort max --timeout 1400`, bundle
  enxuto. Rodar em `run_in_background` (estoura o teto de 10min do shell).
- Modelo de coordenação: **Sol dirige a frente; Claude executa/revisa (lead) + faz o [SALVAR]**.

## Lições de método desta sessão (as novas; as demais nos handoffs anteriores)

1. ⭐ **O instrumento de medida tem que ser independente do defeito que ele mede** — verifiquei
   um clone contra um baseline produzido pelo próprio instrumento torto; os dois casaram no erro
   e o defeito saiu carimbado de "verificado".
2. ⭐ **Propriedade não-enumerável não vira gate** — "o cssText vê tudo que o tween escreve"
   caiu por duas portas diferentes em duas rodadas. Quando a completude da lista é a segurança,
   a lista tem que vir do sistema (mapa de cobertura), não da minha enumeração.
3. **"Não reproduzido" ≠ refutado** — o `easeReverse` do auditor ficou uma sessão como "não
   reproduzido localmente"; a forma do meu probe é que estava errada. Registrar a FORMA testada
   junto com o veredito.
4. **Contraditório com A/B resolve litígio de escopo** — "isso é pré-existente ou é do diff?"
   se decide medindo shipado × fix com o MESMO probe (getters: 8/8 → depois 8→4), não
   argumentando. E o lead fecha com dissenso registrado quando a rodada vira classe deferida.
5. **Verde instável não é verde** — um witness que passou 1× com a suíte rodando em paralelo e
   6× isolado ganha o registro "flake sob carga, não reproduzido isolado", nunca só "verde".
6. **Dano temporal se mede no tick SEGUINTE, contra referência nunca tocada** — posição correta
   no instante + estado interno errado é o modo de falha padrão desta classe.
