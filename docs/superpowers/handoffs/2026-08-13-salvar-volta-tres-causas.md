# Handoff — o SALVAR volta: três causas medidas (2026-08-13, sessão 2)

Continua o handoff `2026-08-13-editor-estado-e-o-que-falta.md`, item §2.1.

**Resultado:** editar → salvar → recarregar **devolve a alteração**, e ela fica viva no site.
Verificado no editor real (`/motion-editor`, porta 3032, clone do farmminerals): duração
620ms → 888ms, "Save changes", F5 → `transaction-committed src=replay`, o campo mostra 888 e
o site tem a animação de 888ms rodando. Foto: `packages/web-shell/_probe-replay-ordem-volta.png`.

**Suíte:** 1828 passando, 17 puladas (baseline medido no mesmo dia: 1817 + 11 testes novos).

---

## 1. A hipótese do handoff anterior estava ERRADA

Ele apostava em **ordem** — o site recriaria a animação por cima do replay. Refutada por medida:
o valor 888 não aparece em **nenhuma** amostra depois de recarregar (série a cada 200ms por 20s),
e nenhuma transação chegava a ser enviada. Não havia nada para ser sobrescrito.

Instrumento: um espião de `postMessage` nos **dois** lados da fronteira (host e iframe), instalado
no início do documento, mais Playwright dirigindo o editor de verdade. O espião foi validado com
controle de sensibilidade — na ida ele registra `apply-transaction` e `transaction-committed`.

## 2. As três causas, na ordem em que apareciam

### 2.1 O anúncio do site se perdia (era esta a causa do sintoma)

O site anuncia-se **uma vez** (`runtime-ready`), sem confirmação. Medido:

| | ouvinte do editor liga | anúncio chega | resultado |
|---|---|---|---|
| 1ª abertura (fria) | 5,9s **antes** | é tratado | negocia → inspeciona → replay roda |
| depois de recarregar (quente) | 0,27s **depois** | ninguém escuta | sem negociação, sem replay |

Recarregando, o iframe vem do cache e fala antes de o React montar o ouvinte. `replayCurrentHistory`
só é chamado nos ramos `runtime-ready` e `protocol-negotiated` — perdido o anúncio, ele nunca roda.

**Mascarava o defeito:** o ramo de batimento faz `setStatus('ready')` sem handshake nenhum, então o
editor parecia conectado, selecionava e editava — só não reaplicava nada.

**Correção:** a ponte ganhou `announce()` reutilizável e o comando `request-announce`; o editor, ao
receber um batimento sem sessão, pede o anúncio de volta. Um pedido por vez (gasta-se um batimento
esperando a resposta), teto de 5, e a desistência é **dita** (mensagem + diagnóstico) em vez de
silenciosa. A ponte recusa reanunciar depois de negociar — reanunciar no meio da sessão zeraria o
registro de transações.

### 2.2 A identidade da animação não sobrevivia à recarga

Com o replay rodando, a ponte recusava: `motion_missing`. A ponte batizava cada animação com a
**posição dela na lista global do GSAP**. Medido em duas cargas do mesmo site:

| comparação | identidade igual | mudou |
|---|---|---|
| mesma sessão, depois de rolar | 111 | 12 |
| **depois de recarregar** | **1** | **122** |

O site cria 184 animações numa carga e 189 na outra; toda posição escorrega. Candidatas medidas
(unicidade dentro da sessão × estabilidade entre cargas, com referência independente =
elemento+duração+atraso+propriedades):

| chave | colisões | estável |
|---|---|---|
| posição global (a de então) | 0 | **0/114** |
| elemento + ordem dentro do elemento | 0 | 114/114 |
| elemento + propriedades | 43 | 114/114 |
| **elemento + propriedades + ordem entre iguais** | **0** | **114/114** |

Escolhida a última (`gsapMotionSeed`). A **duração não entra** — é o que o usuário edita, e a
identidade não pode mudar de nome no primeiro ajuste. Medido também no caso real (salvo depois de
rolar × reaplicado 1s após recarregar): 114/114.

⚠️ **Quem batiza é o inventário do viewport** (`runtime-bridge-source.js`, passe de
`inspect-viewport`), não a inspeção da seleção: o nome fica guardado por objeto e quem chega depois
só lê o cache. Trocar a semente no outro ponto era inerte — descoberto por rastreamento, não por
leitura.

### 2.3 Recusar reaplicar apagava o que estava salvo

Achado da auditoria (Codex), reproduzido em teste antes de corrigir: quando o site recusava o
replay, os patches recusados saíam do histórico — e `save()` grava o histórico atual. O próximo
"Save changes" **apagaria o trabalho guardado**. Como a identidade não sobrevivia (2.2), a recusa
seria a regra. Recusar reaplicar não pode ser o mesmo que esquecer: a poda foi removida, e o aviso
ao usuário agora é próprio da recusa de replay.

## 3. Auditoria (regra fixa)

Duas rodadas, Codex + agente Claude independente, **11 achados aceitos, todos tratados**; cada
correção com vermelho observado antes.

- Rodada 1 — Codex pegou a perda de trabalho (2.3) e que a guarda de reanúncio que eu *afirmava
  em comentário* não existia para mensagens v2. O agente Claude mediu no clone real que o
  identificador derivado de elemento **não é estável**: ele lê a lista de classes viva do elemento
  e de até 8 ancestrais (92% dos elementos expostos), e o ScrollTrigger insere ancestral ao fixar
  seção. Isso derrubou a primeira versão da minha busca por elemento salvo.
- Rodada 2 — Codex pegou que a minha recusa por ambiguidade **ficava de fora no caminho real**:
  a ponte inspeciona a tela antes do replay e carimba um dos gêmeos; olhar o carimbo primeiro fazia
  o outro nem ser considerado. Corrigido: carimbados e derivados entram na mesma conta, e só se
  aceita casamento único.

**Onde ficou a busca por alvo salvo:** `findSavedElement`, usada **só** no caminho dos patches
(nunca nos laços quentes). Só sementes que não dependem do DOM ao redor (id autoral e `data-w-id`),
varredura restrita a `[id],[data-w-id]`, e recusa fechada quando há mais de um candidato. Um alvo
cuja identidade só vem do caminho estrutural **não** é reencontrado entre sessões — limite
deliberado, com teste que o documenta.

## 4. O que continua aberto

1. **O caminho do produto nunca foi visto funcionando.** O que foi provado é o laboratório
   (armazenamento do navegador). No canvas o salvamento vai para o servidor
   (`/api/nodes/[id]/motion-session` → `/commit`); a cadeia tem testes e **exige login, que só o
   Adilson faz**. As três causas são da ponte e do controlador, então valem para os dois caminhos —
   mas isso é dedução, não medida.
2. **Alvo sem id próprio** (§3) não volta entre sessões. Fechar isso pede um localizador persistido
   com características de conferência, não um hash derivado.
3. **Texto quebrado em letras** (furo #4) — o editor avisa sozinho que uma gravação de produção
   precisa reconstruir a divisão. Não construído.
4. **Régua silenciosa na rolagem** — decisão de produto tomada, mecanismo não existe.
5. **Teste automático (Task 16)** — parou em 11 de 20 etapas.
6. Predicado do pedido de anúncio: hoje ele dispara com "não tenho sessão". Numa recuperação de
   runtime o editor segura uma sessão morta, e aí a rede de segurança fica inerte. Não consegui
   produzir falha alcançável hoje (o anúncio novo chega em v1 e cura sozinho); fica anotado.

## 5. Como reproduzir

```
UNCRAFT_NATIVE_CLONE_ROOT=/tmp/uncraft-bundle-endurecido npm run dev:motion   # porta 3032
node packages/web-shell/_probe-replay-ordem.mjs          # edita, salva, recarrega e mede
node packages/web-shell/_probe-identidade-candidatas.mjs # unicidade x estabilidade das chaves
node packages/web-shell/_probe-identidade-animacao.mjs   # a identidade sobrevive a recarga?
```
