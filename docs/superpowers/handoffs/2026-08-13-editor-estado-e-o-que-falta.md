# Handoff — estado do editor e o que falta (2026-08-13)

**Para a próxima sessão.** Escrito em português comum a pedido do Adilson: ele decide
produto, não implementação, e não tem acesso visual ao projeto enquanto o trabalho corre —
ver [[feedback_dinamica_de_trabalho_uncraft]].

**Onde abrir:** `UNCRAFT_NATIVE_CLONE_ROOT=/tmp/uncraft-bundle-endurecido npm run dev:motion`
→ `http://localhost:3032/motion-editor` (sem login). O app completo é `npm run dev` → 3030
(com login).

**Suíte:** 1814 passando, 17 puladas. Um arquivo vermelho pré-existente e alheio:
`lib/design/rubric.test.js` importa um `slop-checks.js` que não existe — trabalho não
commitado de outra sessão, confirmado por `git status`.

---

## 1. O que ficou PROVADO nesta sessão

- ⭐ **A edição chega à animação real da página.** Painel 1500 → digitado 777 → **o site
  passa a reportar 777**, com uma transação registrada. Primeira confirmação de ponta a
  ponta.
- ⭐ **O produtor de clone nativo existe, está ligado e endurecido.** URL viva → 22s → 323
  arquivos → editor abre com GSAP vivo (184 animações, 51 ScrollTriggers). O Edit do produto
  usa esse caminho; o iter9 (que descarta movimento) ficou para as outras razões.
- **O editor alcança GSAP, CSS e WAAPI** — não é só GSAP, ao contrário do que este handoff
  afirmava em versões anteriores.

## 2. ⚠️ O QUE FALTA — e é aqui que a próxima sessão começa

### 2.1 SALVAR: guarda, mas não volta

**Medido no laboratório:**

| passo | resultado |
|---|---|
| editar 1500 → 888 | ✅ o site passa a 888 |
| clicar "Save changes" | ✅ grava (207 bytes no armazenamento local) |
| recarregar | ❌ **campo e site voltam a 1500** |

O caminho de reaplicar **existe e parece correto** (`useNativeMotionController`, ~l.799-848:
carrega, filtra por dispositivo, monta transação `replay` e envia `apply-transaction`). E
`loadedHistory` aceita o formato que o adaptador do laboratório grava (array puro).

**Hipótese principal, NÃO confirmada:** é **ordem**. Os patches são reaplicados no início, e
logo depois o próprio site cria suas animações GSAP do zero, sobrescrevendo o valor. Se for
isso, a correção é reaplicar **depois** de o runtime do site terminar de instalar, ou
reaplicar de novo ao detectar que a animação foi recriada.

#### Referências exatas do caminho de replay

| peça | onde |
|---|---|
| adaptador do laboratório | `components/motion-editor/useNativeMotionController.js:188` `createLocalMotionPersistenceAdapter` — `save()` grava `JSON.stringify(patches)` cru; `load()` aceita array, `{patches}` ou `{transactions}` |
| chave de armazenamento | `storageKey(source)` → observada como `uncraft:native-motion-patches:v1:/api/nati…` (207 bytes com um patch) |
| carga | `useNativeMotionController.js:799` `await persistenceRef.current.load()` |
| escopo por sessão | `loadedHistory(value, sessionId)` — aceita array puro via `sessionHistoryFromPatches`, então **o formato do laboratório não é o problema** |
| filtro por dispositivo | `:817` `sessionHistoryPatches(scoped).filter(responsivePatchAppliesToDevice)` |
| envio | `:831-838` fatia por `TRANSACTION_LIMITS.maxPatches`, `createTransaction({ patches, source: 'replay' })`, `send('apply-transaction', …)` |
| recepção no bridge | `lib/motion-editor/runtime-bridge-source.js:8000` `message.type === 'apply-transaction'` |
| adaptador do produto | `lib/motion-editor/native-edit-api.js` → `/api/nodes/{id}/motion-session` + `/commit`; grava snapshot novo com `motion_manifest` em `lib/motion-editor/edit-session-store.js:305,354` |

#### Como confirmar a hipótese de ordem (roteiro)

1. No bridge, logar com carimbo de tempo no ramo `apply-transaction` quando `source === 'replay'`
   (l.8000), incluindo `motionId` e `property` de cada patch.
2. No mesmo bridge, logar quando o GSAP do site cria o tween daquele alvo — o gancho barato é
   `gsap.globalTimeline` já ter o filho no momento do replay: registrar
   `gsap.globalTimeline.getChildren(true,true,true).length` antes e depois.
3. Comparar. **Se a contagem de filhos subir DEPOIS do replay**, o site recriou a animação
   por cima e a hipótese está confirmada.
4. Verificação independente, sem instrumentar: no `_salvar.mjs` (removido, mas trivial de
   refazer) medir a duração no site **imediatamente** após `apply-transaction` e de novo 3s
   depois. Se ela for 888 no primeiro instante e 1500 no segundo, o site sobrescreveu.

#### Correções candidatas, em ordem de custo

1. **Adiar o replay** até o runtime do site assentar — o bridge já tem `runtime-ready` e a
   noção de `historyReady` (`useNativeMotionController.js:240,553,586,747`); falta um sinal de
   "o site terminou de instalar as animações". Barato, mas depende de um sinal confiável.
2. **Reaplicar ao detectar recriação** — a vigia de seleção adicionada nesta sessão
   (`runtime-bridge-source.js`, `vigiarSelecao`, intervalo de 500ms) já compara retrato
   publicado × vivo; o mesmo mecanismo pode disparar re-replay do patch daquele alvo.
3. **Escrever no autor, não na instância** — mudar `vars` em vez do tween vivo, para que a
   recriação nasça já com o valor. É a mais robusta e a mais cara; encosta na malha de
   proveniência congelada dos itens 168b–171.

⚠️ **Não presumir que o problema é o mesmo nos dois adaptadores** antes de medir: no
laboratório o replay ocorre no boot do editor; no produto, o `motion_manifest` é servido
junto do bundle e pode ser aplicado por outro caminho.

⚠️ **Não confundir com o caminho do produto.** No laboratório o salvamento vai para o
armazenamento do navegador. No canvas ele vai para o servidor (`/api/nodes/[id]/motion-session`
→ `/commit`, que grava um snapshot novo com o manifesto). Essa cadeia tem **20 testes
passando** e **nunca foi vista funcionando com um node real** — exige login, que só o Adilson
faz. O problema de ordem acima, se confirmado, atinge os dois.

### 2.2 Texto quebrado em letras

Pedido explícito do Adilson para retomar. O editor avisa sozinho: *"Text is split by the
animation runtime. A production save must rebuild its split instance."* Mapeado no furo #4,
nunca construído. Sem isso, salvar um texto animado por SplitText não tem como reconstruir a
divisão.

### 2.3 Régua silenciosa na rolagem

Decisão de produto tomada (a régua é instrumento de observação, não visita). **Mecanismo não
existe.** Medido: a técnica do relógio não transfere, e `disable`/`enable` cala mas mata o
desenho. A busca por saída está **1 de ~5 famílias** — faltam `limitCallbacks`, a matriz de
argumentos de `disable`/`enable` com scrub numérico, `kill(reset, allowAnimation)`, e usar
`st.animation`/`getTween()` como eixo separado. Impacto medido: **~10% dos sites** mostram
dano que sobrevive ao arrasto; 84% voltam idênticos.

### 2.4 Teste automático (Task 16)

Parou em 11 de 20 etapas. Sem ele, cada mudança depende de alguém abrir e olhar. Ambiente
isolado já provisionado (Neon `ep-orange-frost-acaedcil`) — **nunca produção**.

## 3. Bugs do Adilson: o que foi fechado hoje

| bug | estado |
|---|---|
| régua "fugindo do mouse" | ✅ eixo travado; a largura vinha da altura viva da página e arrastar a régua rola a página |
| ponteiro deixando rastro | ✅ largura inteira + camada própria |
| fontes ilegíveis | ✅ timeline maior; painel direito de volta ao original a pedido |
| campos altos e valor colado no topo | ✅ era `margin-bottom: 16px` herdada do reset |
| digitar num campo não funcionava | ✅ o campo era recriado a cada atualização, apagando o que se digitava |
| keyframe não clicável na timeline | ✅ estava desabilitado por falta de permissão de **escrita** |
| menu de contexto | ✅ igual ao Figma nos campos; keyframe e linha com opções próprias; área vazia sem menu |
| menu não fechava na timeline | ✅ ela cancela o evento que o menu escutava |
| aba da timeline abre/fecha | ✅ clicando em qualquer lugar, menos nos controles |
| arraste ao vivo e suave | ✅ régua acompanha durante o gesto; movimentos agrupados por quadro |
| animação fantasma | ✅ o painel exibia animação que já tinha morrido |

**Ainda aberto da lista dele:** arrastar keyframes para movê-los (hoje o arraste só existe
para as bordas de duração/atraso), e keyframes respeitando os limites da régua.

## 4. Como NÃO trabalhar (custou caro nesta sessão)

- **Quatro réguas seguidas mediram alinhamento e foram lidas como qualidade.** Posição de
  rolagem não é coordenada comparável entre um site com JS e um clone sem JS.
- **"Isto funciona?" se responde executando e mostrando**, não instrumentando — abrir o
  programa e tirar uma foto respondeu em 20 minutos o que quatro instrumentos não
  responderam.
- **Layout se diagnostica pelo estilo COMPUTADO** do elemento e de cada filho, nunca pela
  folha de estilo: a causa dos campos altos era uma margem herdada que eu nunca imprimi, e
  gastei três hipóteses erradas antes disso.
- **Zero sem oportunidade não é zero** — dois probes desta sessão deram falso negativo por
  medir com a aba fechada ou a timeline vazia.

## 5. Ordem sugerida

1. **Confirmar a ordem do replay** (§2.1) — decide se o salvar funciona; é o que separa
   "edita" de "entrega".
2. **Ver o salvar no canvas com um node real** — só o Adilson consegue logar.
3. Texto quebrado em letras (§2.2).
4. Régua silenciosa (§2.3) ou teste automático (§2.4), conforme a prioridade for qualidade
   percebida ou velocidade de desenvolvimento.
