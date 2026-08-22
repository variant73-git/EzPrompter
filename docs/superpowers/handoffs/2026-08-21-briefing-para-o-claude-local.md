# Briefing para o Claude LOCAL — o que fazer no clone (2026-08-21)

## Antes de tudo: a armadilha deste documento

Ele foi escrito por uma sessão do Claude Code **na nuvem**, que enxerga apenas
um clone do espelho `variant73-git/EzPrompter`, cujo `main` estava parado em
**16/08** (`bb7eb48`). O código local do Adilson é mais novo e tem branches que
o espelho nem conhece (`codex/*`). Tentar mesclar aquele branch aqui já derrubou
o servidor uma vez: 7 arquivos em conflito, marcadores dentro do código, HTTP
500 em todas as rotas.

**Logo: nada abaixo é fato sobre o código local.** Cada item traz o comando que
CONFIRMA a premissa. Se a confirmação falhar, o item morre — não se adapta.

⚠️ **NÃO mesclar** `claude/skill-clone-comparison-fg9h0l`. Ele serve como
REFERÊNCIA de implementação (abrir arquivo, ler, reescrever no código local),
nunca como merge.

## Item 0 — o porteiro, antes e depois de tudo

`packages/web-shell/scripts/smoke-clone.mjs` já está na máquina. Roda a cadeia
real do produto (servidor → bundle → node → sessão de runtime → runtime SERVE →
mídia) contra o dev server. Custa zero: fixture local, sem internet, sem modelo.

```
cd packages/web-shell
node --env-file-if-exists=.env.local scripts/smoke-clone.mjs
```

**Regra:** rodar ANTES de começar (para saber o estado inicial) e DEPOIS de cada
item. Se um item deixa o smoke vermelho, ele volta atrás — não segue.

Verificado em 21/08 na máquina do Adilson: 7/7 passos verdes.

## Item 1 — o erro mudo do runtime (pequeno, alto valor)

**Problema observado:** ao clonar, o node mostrava "localhost is blocked" atrás
da máscara e voltava para "ready to edit". A causa daquele dia era outra (o
merge quebrado), mas a opacidade é real e vai custar de novo: a rota do runtime
recusa por **10 motivos diferentes** e devolve uma página que o Chrome se recusa
a renderizar (`frame-ancestors 'none'`), então o motivo fica invisível.

**Confirmar a premissa:**
```
grep -n "inertFailure" "packages/web-shell/app/api/runtime/[token]/[...path]/route.js" | head
```
Se houver ~10 chamadas e a função fixar `frame-ancestors 'none'`, a premissa vale.

**O que fazer:** em `NODE_ENV === 'development'` (e SÓ nele), a página passa a ser
enquadrável pela própria app e a dizer o motivo, mais um header
`X-Uncraft-Runtime-Failure`. Em `production` **e em `test`** nada muda — a suíte
guarda o contrato "recusa é opaca" e foi ela que pegou um afrouxamento amplo
demais na primeira tentativa.

**Referência:** mesmo caminho no branch, commit `8d74e67`.
**Prova:** os testes da rota continuam verdes + o smoke verde.

## Item 2 — medir onde o clone gasta tempo e dinheiro

**Por que primeiro:** a pergunta "por que meu clone demora minutos se o motor
faz em 24s?" segue **sem resposta medida**. Sem isso, qualquer otimização é
palpite. O 22–24s do handoff de 10/08 é do produtor ISOLADO, não do fluxo que o
usuário vive (fila, banco, thumbnail, geração de controles).

**O que construir** (referência: `lib/clone-telemetry.js`, `lib/dev-clock.js`,
e as gravações em `lib/deferred-reconstruction.js` no branch):
1. `meta.cloneTelemetry` gravado no node ao fim de cada clone, **depois** do
   settle (só aí `credits` e µ¢ existem), com: engine (native/iter9), etapas
   separadas (captura / geração de controles / persistência), total, credits,
   µ¢ e USD. Fail-open: telemetria nunca derruba um clone que deu certo, e
   replay de dedup não grava (não é clone novo).
2. O billing precisa **expor** o total de µ¢ que já calcula (hoje ele é
   somado e descartado). É leitura pura — não pode tocar em nada de cobrança.
3. Relógio no cliente para o wall-clock que a PESSOA sente (do clique à
   resposta), que é diferente do tempo de servidor.
4. Exibir no **pill DEV que já existe localmente** — ⚠️ o branch da nuvem tem um
   `components/DevWidget.jsx` NOVO que colide por nome com o local. O conteúdo
   dele (linhas por clone, fusão wall-clock × telemetria) deve ir para DENTRO do
   widget local, não substituí-lo.

**Prova:** clonar 2 sites e ver as linhas aparecerem com números coerentes
(server ≤ wall, custo > 0 onde há modelo).

## Item 3 — o achado com maior potencial de economia (MEDIR antes)

**Premissa a confirmar, nesta ordem:**
```
grep -n "candidateControls" packages/web-shell/lib/native-clone/capture-bundle.js
grep -n -A3 "export function needsCustomGeneration" packages/web-shell/lib/motion-editor/control-capabilities.js
```
Na nuvem: o produtor devolve `candidateControls: []` **sempre**, e
`needsCustomGeneration` retorna `true` para lista vazia. Junto, isso significa
que **todo clone native chama modelo — inclusive num site 100% estático**, onde
não há movimento nenhum a converter.

**NÃO otimizar antes de medir.** Com o Item 2 pronto, clonar 3 sites estáticos
(confirmados pelo `detectedEngines` do relatório, não pela aparência) + 1
animado como controle, e ler a etapa `motion-controls`.

**Critérios escritos ANTES do resultado:**
- custo ~zero em estático → não há o que otimizar; encerrar o item.
- custo real → implementar curto-circuito: sem candidatos **E** sem engine
  detectada, manifesto vazio e nenhuma chamada. ⚠️ Não pode pegar o caso
  legítimo "poucos candidatos" (`useful.length < target`), que é quando o
  modelo é útil de verdade.
- **Contra-prova obrigatória:** o site animado precisa mostrar custo claramente
  maior. Se não mostrar, o instrumento não está medindo o que se pensa.

Detalhe completo: `docs/superpowers/handoffs/2026-08-21-iter9-tem-lugar-finding.md`
(separa F = medido de I = inferido).

## Item 4 — dinheiro na tabela de preços (conferir, é rápido)

```
grep -n "gpt-5.6-terra\|kimi-k2.6" packages/web-shell/lib/agent/cost.js
```
Na nuvem: (a) Terra estava $2.50/$15 e o preço público caiu para **$2/$12** em
30/07 — a tabela superestimava; (b) `kimi-k2.6` está no seletor de modelos mas
**faltava** na tabela, então qualquer run nele metrava **$0**. Preço errado
contamina metering E cobrança (o multiplicador incide sobre µ¢).

Conferir contra as páginas oficiais antes de mudar — pode ter mudado de novo.

## Item 5 — Terra nos caminhos de visão (só depois do Item 2)

O corte de input do Terra (−60%) vale onde a chamada é de VISÃO: iter9
(`lib/reconstruct.js`) e clone de imagem (`extract.clone`). **Não** vale no clone
animado: o modelo da geração de controles é fixo no código e já é Terra.

Se for fazer o A/B, o registro de harness da nuvem (`lib/harness.js`) serve de
referência — com uma ressalva registrada lá: plumbar um slot para a geração de
controles toca 5 pontos, e um deles reporta o modelo para o **metering**. Fiar
errado ali cobra pelo modelo errado. Não fazer sem rodar o caminho.

## Item 6 — preview animado do node (opcional, menor prioridade)

Ideia: o produtor native já percorre a página inteira para acordar recurso
preguiçoso; gravar essa passada em vídeo custa quase nada e o node passa a
mostrar o clone em movimento, com interruptor Video/Static.

⚠️ **Duas armadilhas descobertas na nuvem, ambas caras:**
1. A primeira fiação apontava para `/api/native-clone/...`, que é rota de
   LABORATÓRIO (503 em produção). A feature nascia morta e ainda gravava
   megabytes por clone. A rota tem de ser **por node**, autorizada por dono do
   board (padrão do `thumbnail`).
2. Nunca foi possível medir o **custo em tempo** da gravação — duas tentativas
   em nuvem falharam (o Chromium não passa pelo proxy). Existe
   `scripts/witness-preview-video.mjs` no branch, que mede com e sem, braços
   alternados. **Rodar isso primeiro**; a regra do Adilson é "se sacrificar
   performance, volta pro estático".

## O que o Adilson decidiu e não se rediscute
- "Clone" é o **animado** (native). iter9 só por nome ou pela exceção da
  composição textual; screenshot→site é ferramenta de imagem.
- Objetivo permanente: **baratear e acelerar o clone sem perder qualidade.**
- Qualidade decide, planilha não: preço só muda default depois de A/B julgado
  por SSIM + olho nos pares.

## Referências no branch (ler, não mesclar)
- Experimento da skill de vídeo: `_teste-skill-video/REPORT.md` + `comparison/`
- Achado do iter9: `docs/superpowers/handoffs/2026-08-21-iter9-tem-lugar-finding.md`
- Revisão adversarial (14 achados, 12 corrigidos): adendo em
  `docs/superpowers/handoffs/2026-08-21-briefing-auditoria-sol.md`
- Auditoria do Sol: **pendente**, e o código é money-adjacent.
