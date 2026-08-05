# DaSelva clone-first V2: Gate B congelado

Gate B executou apenas descoberta, pontuação, seleção e captura limitada de evidências. Nenhum clone, site, board ou imagem V2 foi gerado; nenhum crédito foi consumido; a raiz de saída V2 não foi criada; V1 não foi alterado.

## Resultado

O bundle congelado é `d724f9071eb4d551f1339f187926e4c64aee99fbc0233b5d13b99b2f73fc6a3f`.

### S — clone integral de uma referência

- [Cecilie Bahnsen](https://ceciliebahnsen.com) — referência única e completa, 91/100.
- Razão: foi a página completa mais forte do pool. A sequência longa, a direção editorial de imagem, o controle de branco e a transformação mobile suportam os sete movimentos de DaSelva sem donors.
- Clone-first: reproduzir a página inteira em desktop e mobile antes de trocar marca, tipografia, paleta, imagens, texto e comportamento comercial.

### C — chassis completo com dois donors limitados

- [Playfight](https://letsplayfight.com) — chassis primário, 90/100. É dono de navegação, spine, alturas, whitespace, scroll, responsividade e campo de mídia flutuante.
- [Order & Chaos](https://ordernchaos.aiziza.com) — donor, 88/100. Pode fornecer somente a cena de constelação arredondada com navegação 01/02/03.
- [Built for Archives](https://builtforarchives.com) — donor, 90/100. Pode fornecer somente a cena editorial com linha tipográfica de grande escala e grid de informação assimétrico.

Playfight continua sendo o chassis mesmo com empate de nota com Built for Archives porque sua página é mais completa e tem maior capacidade temporal e editorial. Os donors resolvem dois gaps nomeados; não podem fornecer sistema global, tipo global, cor global ou autoridade de scroll.

Off Mute chegou a ser finalista para donor, mas foi retirado depois que a verificação ao vivo revelou erro de hidratação React e evidência responsiva fraca. A substituição por Built for Archives melhora simultaneamente gosto, previsibilidade de clone e mobile.

### W — síntese de cenas, com parada estática W0

- [Ponder](https://ponder.ai) — abertura escura de mídias flutuantes e cadência narrativa pinned, 85/100.
- [Bureau Rouge](https://bureaurouge.com) — plano de mídia full-bleed, micro-navegação e tipografia sobreposta contida para a cena da Banda, 83/100.
- [The Red](https://333southwabash.com) — câmara tipográfica em perspectiva como transição de maior risco, 80/100.

A compatibilidade proposta é visual, não setorial: verde-floresta profundo, terracota, off-white, planos grandes de imagem, navegação escassa e uma única transição teatral. The Red pode dominar as cenas mais quietas; por isso W para obrigatoriamente no board estático W0 desktop/mobile. Movimento permanece proibido até aprovação humana explícita de gosto e coerência.

## Auditoria anti-categoria

- 16 candidatos, 11 grupos de categoria de negócio.
- Peso da categoria na pontuação: zero.
- Uso de categoria para filtro, desempate ou alocação: não.
- Referências de restaurante, comida e bebida, hotel ou hospitalidade: 0 de 16.
- Participação de categorias adjacentes: 0%, abaixo do limite de 25%.
- As quatro buscas externas usaram somente capacidades de composição, motion, navegação, grid e narrativa vertical.

| ID | Referência | Nota | Decisão |
| --- | --- | ---: | --- |
| C07 | Cecilie Bahnsen | 91 | S |
| C04 | Playfight | 90 | C chassis |
| C16 | Built for Archives | 90 | C donor |
| C11 | Order & Chaos | 88 | C donor |
| C15 | Aarke | 86 | não selecionada |
| C06 | Ponder | 85 | W |
| C03 | Bureau Rouge | 83 | W |
| C02 | The Red | 80 | W |
| C05 | Cantor8 | 80 | não selecionada |
| C14 | Index Georgia | 78 | não selecionada |
| C01 | AND2ES™ | 76 | não selecionada |
| C08 | Wwake | 76 | não selecionada |
| C13 | Bruno Simon | 70 | não selecionada |
| C09 | Longbow | 69 | não selecionada; live 403 |
| C10 | Off Mute | 64 | não selecionada; hydration error |
| C12 | TILToooTILT | 62 | não selecionada |

A tabela completa, as seis notas por candidato e as razões de promoção/rejeição estão em `candidate-pool.v2.json`.

## Evidência congelada

Cada referência selecionada tem:

- conteúdo e links extraídos;
- HTML de runtime;
- hero desktop em 1440 × 1000;
- segundo estado desktop produzido por scroll ou interação real;
- hero mobile em 390 × 844;
- hash SHA-256 de cada arquivo;
- observação de geometria, responsividade, motion e gaps de runtime.

Gaps conhecidos não foram escondidos: Cecilie exige consentimento para liberar scroll; Playfight e Built for Archives têm loaders; Ponder apresentou erro de callback no runtime-fonte; The Red depende de WebGL/scroll virtual. Nenhum código, asset, identidade ou runtime dessas páginas pode chegar ao resultado final.

## Estado dos gates

- Gate A: congelado e validado.
- Gate B: congelado neste bundle.
- Gate C: **não autorizado**.
- Geração no Gate B: 0 calls, 0 imagens, 0 sites/clones, 0 créditos.
- Teto proposto para Gate C: máximo de 1.425 créditos, ainda não aprovado.
- Novas imagens no Gate C: zero; reutilização byte-idêntica do media pack `e21ee52d96adccd7200d1799622ed460262923dcceacea3ed54386a8f206019f`.

Gate C exige uma única autorização que inclua o token exato, o hash deste bundle, o teto máximo e a reutilização do media pack:

`START-DASELVA-V2-GATE-C-1B0FCD27F0992769 — aprovo o bundle d724f9071eb4d551f1339f187926e4c64aee99fbc0233b5d13b99b2f73fc6a3f, o teto máximo de 1.425 créditos e a reutilização do media pack e21ee52d96adccd7200d1799622ed460262923dcceacea3ed54386a8f206019f.`

O token sozinho não autoriza execução.
