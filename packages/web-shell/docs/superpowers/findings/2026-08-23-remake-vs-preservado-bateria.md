# A bateria do verbatim nos dois motores — o número que decide a arquitetura

**Pergunta:** o `remake` (reconstruir nas nossas regras, com o movimento medido)
alcança o `preservado` (o bundle nativo, que guarda o site como ele é)?

**Instrumento:** a bateria do prompt verbatim de 2026-07-17 — rede desligada,
altura de página, coreografia — no viewport dele (1440×1200), com o site vivo
como referência.

**Braço de controle:** o site vivo contra ELE MESMO, em duas sessões
independentes. Sem esse braço, um número baixo não distingue "reproduziu mal" de
"a página nunca está duas vezes no mesmo lugar" (lição de 179).

⚠️ **SSIM não é escala de razão** — zero não significa "nenhuma fidelidade",
então dividir um SSIM pelo outro não dá "porcentagem do teto". Os números abaixo
são comparados entre si (preservado × controle × remake), nunca convertidos em
percentual.

## Os três critérios

| | vivo | controle | preservado | remake |
|---|---|---|---|---|
| altura da página | 20942px | 20942px | **20942px — exata** | 9368px (**45%**) |
| rede desligada | — | — | 3 pedidos falhados + vídeo ausente | 0 pedidos externos (com 45% da página) |
| coreografia (SSIM médio) | — | **0,995** (controle) | **0,941** | **0,539** |
| ScrollTriggers | 51 | 51 | **51** | 0 |
| superfície de movimento | 75 GSAP + 376 transições | — | 138 GSAP + 376 transições | 0 GSAP + 23 transições (**6%**) |

## Onde vive o déficit do preservado

O preservado marca **0,941**, com o controle em **0,995** — quase encostado no
que o próprio site vivo consegue contra si mesmo. Esse é o número, na bateria
inteira.

Ele cai em UMA parada só (0,762 aos 50%). Contar GSAP não explicava: 0 tweens
ativos nos dois braços, relógio andando nos dois, nenhum congelado. A inspeção
daquele ponto respondeu:

```
VIVO aos 50%:        vídeo TOCANDO t=2,5s  m-minerals.b-cdn.net/farm_main_video.mp4
PRESERVADO aos 50%:  vídeo parado  t=0,0s  currentSrc VAZIO
                     mesmo lottie, mesmo canvas, mesmos 8 elementos com transform
```

É **o vídeo que não entrou no bundle** — o residual já nomeado em 185
("farmminerals 1 vídeo").

Para localizar o déficit em vez de supor, a caixa do elemento `<video>` foi
mascarada nos dois lados. A caixa foi MEDIDA, e é idêntica nos dois braços:
`{x:0, y:0, w:720, h:1200}` — o vídeo ocupa exatamente a metade esquerda da
tela. O controle é uma máscara de mesma geometria na metade direita:

| aos 50%, vivo × preservado | SSIM |
|---|---|
| sem máscara | 0,769 |
| mascarando a caixa do `<video>` (720×1200, medida) | **0,999** |
| mascarando a metade direita — mesma geometria, controle | 0,770 |

O controle quase não move. **O déficit está inteiro dentro da caixa do vídeo** —
e o vídeo, que no vivo toca e no preservado está sem fonte, é a hipótese
principal.

⚠️ **Duas coisas que isto NÃO diz.** Primeira: a caixa do vídeo é meia tela, e
mascará-la esconde também o que estiver por cima dela — tipografia, sobreposição,
qualquer pixel dali. Está provado que a divergência mora nessa caixa, não que o
vídeo seja a única causa dentro dela. Segunda: não diz que pôr o vídeo no bundle
levaria a média a 0,986 — um vídeo tocando em tempo dessincronizado entre duas
sessões não bate quadro a quadro. Medir o ganho exige o vídeo incorporado e
reprodução sincronizada.

*(0,762 na bateria e 0,769 aqui são a mesma parada em rodadas diferentes: cada
uma abre o site de novo, e a variação entre execuções é dessa ordem.)*

## A armadilha que quase entrou no relatório — duas vezes

**A primeira:** contar animações do GSAP (vivo 75, preservado 138, remake **0**
— a contagem varia entre rodadas, 69 numa e 75 noutra, porque o site cria um
número diferente a cada carga; é o mesmo efeito que quebrou a identidade
posicional em 180).
Lido de fora, isso condena o remake — mas mede o MECANISMO, não o movimento. O
próprio módulo de evidência diz que quem reconstrói escolhe como reproduzir
(CSS, WAAPI, a biblioteca que for), então zero GSAP não prova página parada.

**A segunda, que a auditoria pegou:** ler o SSIM de 0,539 do remake como
"não reproduz coreografia". Não é o que ele mede. Com 45% da altura, a mesma
fração de rolagem mostra **seções diferentes** — o número mistura página
faltando com movimento faltando, e não isola nenhum dos dois. Contagem de
transições e de gatilhos também é mecanismo, pela mesma razão de cima.

O que a bateria sustenta sobre o remake, sem esticar: **ele não reproduz a
extensão nem a composição da página** (45% da altura é medida direta e não
confundida), e **não há evidência de paridade de coreografia** — que é diferente
de ter evidência contra. Medir coreografia nele exigiria comparar cenas
semanticamente correspondentes, com posição e tempo sincronizados, ou seguir a
trajetória dos mesmos elementos. Isso não foi feito.

## O que isso decide

**Nesta bateria, o preservado é o clone mais fiel — e não por pouco.** Bate a
altura na casa do pixel, tem os mesmos 51 gatilhos de rolagem, e fica quase
encostado (0,941) no teto que o próprio site vivo estabelece contra si mesmo
(0,995), com o déficit localizado numa caixa identificada da tela.

⚠️ **O alcance disso.** Um viewport (1440×1200), um trajeto de rolagem, cinco
paradas. Isso é paridade VISUAL nesse cenário — não verifica navegação,
interação, estados, formulários, responsividade nem paridade funcional. A
própria execução offline já perde o vídeo e mantém três dependências. Declarar
que o preservado guarda o site inteiro exige testes que não foram feitos.

**O remake não substitui o preservado como clone.** A medida direta e não
confundida é a extensão: 45% da altura da página. Sobre movimento a bateria não
dá veredito — falta evidência de paridade, e obtê-la exige cenas correspondentes
com tempo sincronizado. No trajeto testado ele fez **zero** pedido
externo, contra três do preservado — mas isso não é vitória em independência: o
remake pode estar conseguindo o zero por OMISSÃO, já que entrega 45% da página e
não passou por teste de paridade funcional.

O mesmo critério vale para os dois, e nenhum o cumpre: independência exige as
dependências necessárias zeradas E a bateria offline repetida com paridade de
função. O preservado melhorou muito hoje (147 pedidos falhados → 3, zero imagem
visível quebrada) e ainda assim não é autocontido — sobram três dependências e o
vídeo que não entrou.

**Onde o remake ainda tem lugar:** ele nasce nas NOSSAS regras — que é o que faz
o editor completo funcionar em qualquer site. Isso é uma pergunta de
homogeneização, não de clonagem, e não se decide por esta bateria.

## Próximo passo com endereço

Pôr o vídeo no bundle ataca a caixa onde o déficit mora — o mesmo residual de
185. Quanto isso recupera só se sabe medindo depois, com reprodução sincronizada;
a bateria localizou a lacuna, não a precificou nem provou causa única.

**Instrumentos:** `_bateria-verbatim.mjs`, `_bateria-movimento.mjs`,
`_quem-mexe.mjs`, `_checar-congelado.mjs`. Fotos e JSON em `_bateria/`.
