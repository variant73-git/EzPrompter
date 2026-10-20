# Alças e guias na cópia editável — prova ao vivo (2026-10-20)

Spec: `docs/superpowers/specs/2026-10-20-alcas-e-guias-no-editor-da-copia-design.md`.
Plano: `docs/superpowers/plans/2026-10-20-alcas-e-guias.md` (Tasks 1–12).

## O que foi provado no canvas (node de prova `63f9dca3`, cópia do farmminerals no desktop 1280)

Roteiro: `_alcas-viva.mjs.txt` (Chromium + login assinado, servidor de dev 3030 com o `main` local). Resultado bruto: `viva.json`.

| Passo | Resultado |
|---|---|
| Clicar no título "For Your Crops. For the Planet." | caixa com 8 alças exatamente sobre ele (408 × 83) |
| Arrastar a alça leste −60 px da página | largura 408 → **348**, o painel da direita mostra 348 |
| Selecionar o cartão "Zero emissions" | guias de espaçamento nos 4 lados (15 px) |
| Shift + arrastar a guia de cima 8 px | os **quatro** lados juntos 15 → 23 |
| Duplo clique no rótulo, digitar 24, Enter | espaçamento de cima **24** |
| Ctrl+Z com o foco dentro da página | volta para **23** |
| Done (salvar e sair) | sai sem aviso de erro |
| Reabrir o editor | o título continua com **348** |

## Lado a lado com o editor antigo, no MESMO elemento

O antigo foi carregado na própria cópia do node (a pasta do pacote, só leitura), com o editor antigo injetado, à mesma largura: `_alcas-antigo.mjs.txt`.

| Novo (cópia editável) | Antigo (editor-core) |
|---|---|
| `1-novo-caixa-titulo.png` — título com 8 alças | `1-antigo-caixa-titulo.png` — mesmo título, mesmas alças (quadrado branco, borda azul), guia rosa de margem |
| `3-novo-guias-cartao.png` — cartão 295 × 152, rótulos "15" | `3-antigo-guias-cartao.png` — mesmo cartão, mesmos rótulos nas mesmas posições |
| `5-novo-campo-digitando.png` — campo de digitar no rótulo | `5-antigo-campo.png` — campo do antigo |

Iguais de propósito: o desenho das alças, o rótulo "L × A", os rótulos rosa no meio de cada faixa (inclusive o de dentro em cima da alça do meio, como no antigo). Fora desta entrega, como na spec: a aba "Add feedback" e a barra de texto flutuante do antigo.

## Defeitos que a prova ao vivo achou (corrigidos antes de fechar)

- **Todo salvamento depois de arrastar uma alça voltava 400.** O gesto saía com a origem `overlay`, que a checagem do servidor não aceita; os testes do controle usam um salvamento falso e não viam. Agora grava como `properties`, igual às outras edições que vêm da página (texto inline, Mover). Teste: `native-edit-api.test.js` › "saves an overlay gesture in a draft the server accepts".

## Resíduos conhecidos (não desta entrega)

- **Enquadramento do editor no canvas**: o quadro da página às vezes abre deslocado (parte atrás do cabeçalho ou do painel de camadas). Já acontecia antes deste ramo (visto na cópia de 9/10). O roteiro rola a página até o alvo cair na parte visível.
- **Elemento com `transform: scale()`** redimensiona a partir da largura VISÍVEL (como o antigo): arrastar para fora pode encolher.
- **Tabela por tela com edições sobrepostas** (troca de tela entre duas edições da mesma propriedade dentro de uma ida e volta de mensagem) — fica para a frente de tablet/celular, que vai passar toda mudança da tabela pela mesma fila de confirmação.
