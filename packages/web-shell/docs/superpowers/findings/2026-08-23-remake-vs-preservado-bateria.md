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

---

# Adendo, mesmo dia — o vídeo entrou, e duas correções que eu devia

## Correção 1: meu instrumento serviu o remake sem as imagens dele

A bateria copiou só o `index.html` do remake para a pasta servida. As oito
rasters que ele referencia 404aram, e o número saiu de um documento capado.
Re-medido com os arquivos no lugar (14/14 imagens carregadas, zero falha):

| | capado | correto |
|---|---|---|
| altura | 9368px | 9414px |
| SSIM médio | 0,539 | **0,533** |

A conclusão não muda — mas o número estava medido errado, e isso vale registrar
mais que o fato de ter dado no mesmo.

## Correção 2: a repescagem que eu tinha commitado era código morto

O commit de independência dizia que o que a captura perde no meio "agora é
pedido de novo". **Não era.** A repescagem procura reservas nulas
(`filter(([, v]) => !v)`), e o caminho de "corpo nao chegou" fazia
`recursos.delete(u)` — apagava exatamente o que ela procura. Medido no site
real: a etapa `retrying` **nunca disparava**.

O purgo que nomeia o que faltou já roda DEPOIS da repescagem; o desenho estava
certo e a interceptação o furava. Agora só redirect/204/304 liberam a vaga —
esses não têm corpo por natureza. O resto fica nulo, e a repescagem acha.

⚠️ Corolário: o ganho de arquivos que atribuí à repescagem no commit anterior
veio de outro lugar (o fechamento de referências). "Guarda sem teste nasce
morta" agora tem a quarta instância neste projeto.

## O vídeo entrou — e não bastava entrar

Com a repescagem viva, os três vídeos entram no pacote: **descartados 2 → 0**.
O vídeo toca do próprio pacote e **continua tocando com a rede desligada**.

Mas o SSIM aos 50% só foi de 0,762 para ~0,81–0,85, variando por rodada. A
causa não era conteúdo: **o clone não conseguia PROCURAR quadro.** Pedir
`currentTime = 2` deixava o tempo em zero, porque o portão do runtime servia
todo arquivo inteiro, sem `Accept-Ranges` nem resposta 206.

Isso não é detalhe de medição. O site tem um `<video class="scroll-video">`
cuja animação inteira é o quadro seguindo a rolagem — sem faixa de bytes, essa
coreografia não existe no clone, e nenhuma bateria de rolagem a veria porque o
vídeo fica parado no primeiro quadro em qualquer posição.

Com faixa de bytes no portão, os dois lados travam em `t=2` e a mesma parada dá:

| aos 50% | SSIM |
|---|---|
| vídeo ausente (antes) | 0,762 |
| vídeo presente, tempo livre | 0,806 – 0,849 (varia por rodada) |
| vídeo presente, **mesmo instante** | **0,998** |

O resíduo era temporal, não de conteúdo — agora medido, não suposto. E a
bateria com tempo livre **não pode** chegar lá: dois vídeos tocando sem
sincronia nunca batem quadro a quadro. O número da bateria (0,950) tem esse
teto embutido.

## O que ressuscitar código morto trouxe junto (achado do Sol)

Viva, a repescagem passou a violar o que ninguém tinha checado enquanto ela não
rodava: usava orçamento **próprio** de 60MB sem olhar o teto global de 220MB, e
não somava ao total. Somados, o pacote podia chegar a 280MB, e o relatório
omitia **todos** os bytes recuperados — os três vídeos, 10,7MB, invisíveis na
telemetria.

A primeira correção que fiz — orçamento da repescagem limitado ao que sobra —
**não bastava, e o Sol mostrou por quê**: o ouvinte de respostas continua ativo
enquanto a repescagem roda, então os dois caminhos leem "quanto sobra" cada um
por si e gastam o mesmo espaço livre duas vezes.

O que fecha é uma **contabilidade única** (`byte-ledger.js`): reservar é a única
porta, e em JavaScript a reserva é atômica por construção — o teto não pode ser
furado por corrida, independente da ordem em que os dois chegam. A leitura em
fluxo reserva pedaço a pedaço e devolve o que abortou. E a contabilidade
**fecha** quando o pacote é congelado, senão uma resposta atrasada somaria bytes
que nunca serão empacotados.

O comportamento está testado no módulo (não por expressão no fonte): reserva que
não cabe não reserva pela metade, dois caminhos concorrentes não gastam o mesmo
espaço livre, e fechada não aceita mais nada.

## E uma diferença de 0,003% que valia investigar

A prova comportamental mostrou o relatório 2.149 bytes acima da soma real dos
corpos. Pequeno, mas "não sei por quê" não é resposta. A contagem de arquivos
batia (365 = 365), sem vazios nem duplicados — então era um corpo que **muda
entre contar e guardar**: a reescrita de referências encurta HTML/CSS/JS.

Duas quantidades legítimas com um nome só. Agora são dois campos: `bytes` (o que
chegou da rede, sobre o qual os tetos decidem) e `bytesNoPacote` (o que ficou
guardado). O segundo bate exato com a soma dos corpos.

## Um residual que a auditoria me fez parar de esconder

Um comentário meu, antigo, dizia que conferir `content-length` antes de
bufferizar limitava a memória. **Não limita.** O cabeçalho é opcional, pode
mentir e pode vir comprimido; quando falta, `res.body()` carrega o arquivo
inteiro do mesmo jeito, e a API de interceptação do Playwright não tem leitura
em fluxo. O que aquilo faz é **rejeição antecipada no caso honesto** — útil, e
diferente do que estava escrito.

Quem tem limite de verdade durante a leitura é a repescagem, que usa `fetch`
com `getReader()`. O residual — pico de memória de um corpo, no caminho de
interceptação, com cabeçalho ausente ou mentiroso — está agora nomeado no
código em vez de coberto por uma frase confiante.

**Fica em aberto:** por que a captura não lê o corpo de mídia na interceptação.
A repescagem contorna, e contornar tem custo (uma busca a mais por arquivo).
