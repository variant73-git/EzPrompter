# Finding — a segunda cobaia, e o mapa do JEV auditado

> **Data:** 2026-09-29 · **Sessão:** frente do clone verbatim / terceira via
> **Estado:** medições feitas e reproduzíveis; o mapa do JEV é projeto, **zero código de produção**.

## 1. A segunda cobaia achou o que a primeira escondia

O farmminerals é Webflow, servido estático, 365 arquivos, cheio de imagem. O `gsap.com` é
Vite/SPA, 30 arquivos, leve em imagem e pesado em JS e vídeo. Trocar de cobaia mudou o
resultado em três dimensões — a lição "a cobaia pode esconder a classe inteira", outra vez.

| | farmminerals | gsap.com |
|---|---|---|
| Altura / rolagem / texto | idênticos | **idênticos** (10357 · 9157 · 2462) |
| Imagens (ref → clone) | 70 → 70 | **8 → 5** |
| Tentativas externas | 0 | **5** |
| Erros de console | 0 | **6** |
| Editabilidade (ref / clone) | 64% / 65% | 59% / 59% |
| SSIM mínimo | 0,606 | 0,834 |

### 1a. ⭐ O clone perde o conteúdo que a página busca em tempo de execução

Causa raiz medida, e é **estrutural, não defeito de captura**:

- `js/header.js` chama `fetch` com URL **construída em código**. A reescrita estática
  troca apenas URL que aparece como texto e que bate exatamente com uma resposta
  capturada — uma URL montada em runtime é inalcançável por construção (resíduo já
  declarado no cabeçalho de `lib/native-clone/rewrite-references.js`).
- Offline esse `fetch` falha (`TypeError: Failed to fetch` em `header.js:230`), e **as 3
  imagens que faltam são consequência disso**: o HTML servido tem 5 `<img>` — as outras
  são injetadas por JS com os dados que o `fetch` traria.

Portanto "faltam imagens" era o sintoma; a causa é uma chamada de rede morta. A saída
existe e é nomeável: **a captura JÁ grava respostas de fetch/XHR** (o pacote contém
`community/index.93580e97.php`). O que falta é o runtime do clone **interceptar `fetch` e
mapear a URL original para o caminho no pacote** — decisão de arquitetura, não remendo.

⚠️ Não medido: quantos sites dependem disso. Um site servido estático não exibe a classe.

### 1b. Independência não estava fechada — estava escondida

No farmminerals, depois do conserto das referências em corpo de script, as tentativas
externas foram a 0 e eu declarei a classe resolvida. **Não estava.** No gsap.com são 5:
analytics, `www.google.com`, e `gsap.com` (mesma origem, não reescrita — `og:image` de
`<meta>` e links de navegação, que o navegador nunca buscou durante a captura, logo não
há resposta capturada para casar).

### 1c. A cadência do portão FUNCIONA — era a página que estourava o orçamento

No gsap.com a referência **esperou em 5 das 13 paradas** (custo médio do instrumento
3,5 s). No farmminerals nenhuma esperava, porque lá o instrumento custava ~11 s por
parada. O mecanismo estava correto; o diagnóstico anterior ("a cadência é inerte") era
sobre aquela página, não sobre o desenho.

⚠️ **Resíduo do portão de regime:** ele exige `passoMs` igual, mas aqui a referência
esperou 5 vezes e o candidato **zero** — os dois lados rodaram sob cadência igual no papel
e desigual de fato. `paradasQueEsperaram` é reportado, mas não derruba a comparação.
Candidato a virar falha declarada.

## 2. O mapa do JEV, auditado — a taxonomia do handoff é inválida

Capacidade **verificada hoje** na documentação: só texto (*"No images, audio or video
yet"*), saídas sim/não, uma-de-N (até 255) e nota (2–10 níveis), todas com confiança;
US$ 0,042/M de entrada, saída grátis; ~100 ms; **1.200 requisições/minuto**; estado +
pergunta em ~32k tokens, ~64k no total. **Não** conta itens, **não** faz aritmética, **não**
gera código nem texto, e tem dificuldade declarada com **texto adversarial**.

### 2a. Achado decisivo do Astra

O rótulo `dormant_library_string → manter` **contradiz a receita**, que manda remover URL
de origem, CDN e serviço de terceiro mesmo quando aparecem só como string em JS. E provar
que a string não disparou rede num percurso offline **não prova que ela é dormente** em
hover, breakpoint, formulário ou rota não exercitados. Pior: a omissão mais grave da
taxonomia é **endpoint externo ativo** classificado como dormente — isso pode deixar
transmissão de dados externa, efeito **não recuperável**.

A taxonomia de 6 rótulos também não é exaustiva nem mutuamente exclusiva: `rewrite_local` e
`remove` são **ações**, os outros são **tipos**; uma fonte externa essencial é as duas
coisas ao mesmo tempo. A correção é **fatorar**: um `Choice` para papel semântico, um
`Noul` para "pode causar ação externa", um `Choice` para a obrigação da especificação, e a
**ação final calculada por política determinística** — qualquer consumidor `required` ou
`unknown` bloqueia remoção.

### 2b. Centenas de ocorrências não são centenas de julgamentos

Namespace conhecido, tag de metadado, diretiva de source-map, caminho de máquina,
existência de rota e referência que casa exatamente com o manifesto resolvem-se
**deterministicamente**. O JEV recebe só o **resíduo semanticamente ambíguo**. Isso muda a
ordem de grandeza da economia projetada.

### 2c. Dois números do handoff que não se sustentam

- **"uma passada de ~1 s"**: o limite é 1.200 requisições/minuto = 20/s. 373 decisões como
  requisições separadas levam **≥ 18,65 s** só pela cota. Se forem em lote, é preciso
  demonstrar que tudo cabe nos limites de contexto. Reportar requisições/site,
  perguntas/requisição e tokens/site.
- **"zero remoção indevida" como critério**: zero sem denominador não é critério. Com zero
  falhas em `n` casos independentes, o teto de 95% é ~`3/n` — zero em 100 ainda é
  compatível com ~3% real; para sustentar <0,1% seriam ~3.000 casos independentes, e
  ocorrências do mesmo site são correlacionadas (o `n` efetivo é menor).

### 2d. O "ground truth" do protocolo é circular

Usar relatórios que o próprio agente escreveu como verdade mede se o JEV **imita aquele
agente**, não se ele acerta. Servem como rótulo *silver* ou para estratificar. O protocolo
corrigido exige: extrator/taxonomia/IDs congelados antes de rotular; **dois revisores
independentes cegos ao JEV** com adjudicação por AST/trace/experimento causal numa cópia;
separação de calibração e teste **por site inteiro e por hash de biblioteca** (o mesmo
bundle GSAP em treino e holdout dá falsa generalização); vários arquétipos; e medição do
sistema **depois** do fallback (cobertura automática, resíduo humano, custo, latência).

### 2e. Onde o JEV NÃO entra, mesmo parecendo caber

Descarte **durante** a captura (silencioso e irreversível — capture primeiro, classifique
numa cópia); qualquer coisa de geometria, pintura, stacking ou SSIM; duração, delay,
distância, contagem, limiar (aritmética); "dormente" a partir de ausência no trace;
essencialidade a partir de janela local de 200 caracteres; liberação **negativa** de
challenge ("não vi texto de challenge" ≠ "a página é a real"); o gate offline em si; e
remoção de licença/aviso legal.

### 2f. Oportunidades que o handoff tinha perdido

Classificação de site/stack · recomendação de motor · detecção **positiva** de challenge ·
triagem de tráfego pós-captura (`asset_runtime` · `analytics_tracker` · `beacon_longpoll` ·
`form_api` · `navigation` · `challenge` · `unknown`) · classificação de chunk/recurso
textual · inventário textual de movimento (é movimento? qual família? qual gatilho — mas
**nunca** duração/delay) · papel semântico da referência antes da reescrita ·
essencialidade de atributo · triagem dos avisos da validação offline · papel semântico de
seção/camada · conteúdo × decoração · agrupamento de animações (facetas por `Choice`,
agrupamento determinístico) · nomeação de camada (**escolher** entre candidatos gerados por
template, nunca inventar nome).

## 3. Fila

1. Interceptar `fetch`/XHR no runtime do clone e mapear para o pacote (§1a) — é o que
   destrava sites que renderizam parte de si em tempo de execução.
2. Fechar as referências de mesma origem que o navegador nunca buscou (§1b).
3. Portão de regime: `paradasQueEsperaram` divergente virar falha (§1c).
4. JEV: extrator determinístico + taxonomia fatorada (§2a) **antes** de qualquer chamada.
