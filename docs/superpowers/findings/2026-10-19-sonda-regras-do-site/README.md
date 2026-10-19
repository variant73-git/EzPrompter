# Sonda: levar as regras de estilo do próprio site para a cópia editável (2026-10-19)

**Pergunta.** Em vez de gravar a cópia quatro vezes (uma por tela) e casar os elementos entre as gravações (plano
T2/T3 de `docs/superpowers/specs/2026-10-19-copia-editavel-telas-design.md`), dá para fazer UM documento que se adapta
sozinho, levando as regras de estilo do site (com as de cada tamanho de tela) para os ids da cópia?

**Como.** `sonda.mjs.txt` (descartável, só leitura, sem IA): numa sessão do clone original a 1280, junta cada regra do
site e os elementos que ela pega, roda a nossa montagem (que carimba o id de cada elemento) e reescreve cada seletor
como `:where(#ids)` com a especificidade original. Três cópias: a de hoje (estilo calculado a 1280), a traduzida, e a
traduzida + os estilos que o código do site escreve no próprio elemento (`style=""`). Comparação com o original
redimensionado (caixas por id) e aberto do zero em cada largura (fotos + semelhança da primeira tela).

**Resultado** (`resultados.txt`; fotos `<site>-<tela>-original-traduzida-hoje.png`, na ordem original | traduzida + estilos | cópia de hoje):

| site | tablet / celular: tamanhos certos | semelhança da 1ª tela | o que falta |
|---|---|---|---|
| farmminerals | 82% / 74% (hoje 16% / 11%) | 0,92 / 0,82 (hoje 0,50 / 0,32) | logo do celular (só existe nessa tela) |
| gsap.com | 92% / 88% (hoje 22% / 21%) | 0,80 / 0,74 (hoje 0,71 / 0,68) | letras do título posicionadas para o desktop; página alta demais |
| bleibtgleich | 96% / 96% (hoje 0% / 15%) | 0,99 / 0,99 (hoje 0,51 / 0,55) | página 46% mais curta no celular (carrossel 3D) |
| uptechsoft (Framer) | 66% / 66% (hoje 56% / 60%) | 0,64 / 0,65 | ~320 elementos que só existem no tablet/celular |
| landonorris | não mede | não mede | o site se reconstrói ao mudar de largura; offline, o celular fica no carregamento |

**Auditoria do Astra (xhigh) — aceita.** A direção é promissora, mas a evidência NÃO autoriza trocar a T2/T3:
1. a porcentagem só conta elementos que já estão na cópia (o uptechsoft deu "100% presentes" com 337 faltando); a
   semelhança é só da primeira tela (o bleibtgleich deu 0,997 com a página 46% mais curta); geometria e foto vêm de
   execuções diferentes do original; "melhor em tudo" é falso (desktop do uptechsoft 0,893 × 0,906; posição do gsap 84% × 95%);
2. a montagem desfaz no desktop invólucros que no celular viram grade/moldura; quem cada regra pega é avaliado uma vez
   só; os estilos escritos pelo código são amostras, não regras;
3. um documento não dá o contrato de edição: no Framer a versão do celular é OUTRO elemento; `!important` dentro de
   `@media` derrota a edição; o problema do `sharedValue` continua;
4. o tradutor da sonda tem defeitos de cascata (estado contado em dobro, `:is(:hover,…)`, regras aninhadas não
   percorridas, `@layer` reordenado, precedência do `style=""`) — os números não validam o tradutor;
5. o tocador JÁ aceita disparos relativos ao elemento (o leitor do Webflow os emite) — "movimento por posição absoluta"
   era generalização errada.

**Recomendação (Astra, adotada como direção técnica):** modelo único de edição/identidade com DOIS jeitos de montar —
documento que se adapta para a captura que passar nas verificações de estrutura, cascata, edição e movimento; documento
por tela onde precisar; trava do desktop quando não houver versão válida do celular. Várias telas podem sair de UMA
máquina (sem trocar em silêncio a decisão de espera do dono). **Experimento decisivo seguinte:** o uptechsoft de ponta a
ponta (desktop + celular + uma largura intermediária), preservando invólucros e variantes, com a ponte do editor e o
tocador montados, uma edição de texto compartilhada, uma de estilo compartilhada e uma só do desktop, troca de tela,
desfazer e reabrir — sem conteúdo visível faltando e com o escopo das edições certo. Falhar descarta o atalho.
