# Finding — replay de chamada de runtime precisa de IDENTIDADE, não de um mapa de URL

> **Data:** 2026-09-29 · **Estado:** resultado NEGATIVO medido; duas afirmações minhas retiradas.

## 1. O que eu afirmei, e por que estava errado

Reportei que o remendo de `fetch` no clone tinha produzido:

- imagens no DOM **5 → 8** (paridade com a referência)
- **ponto congelado 1 → 0**

**As duas medições vieram do caminho INSEGURO.** A primeira versão do remendo traduzia
qualquer chamada cuja URL estivesse no mapa, inclusive **POST com corpo**. O servidor
estático devolve o arquivo ignorando o método, então o site recebia os dados e injetava
as imagens. Funcionava porque fazia exatamente o que a auditoria apontou como
inseguro — converter outra origem em mesma origem e colapsar método e corpo num
arquivo.

Depois de conter o remendo a **GET/HEAD sem corpo** (correção correta), o ganho
desapareceu: 5 imagens, e o erro reaparece apontando para o próprio remendo.

## 2. A causa, medida no código do site

`js/header.js` do gsap.com:

```js
const url = `${apiBaseUrl}index.php?app=gspages&module=ajax&controller=api`;
const data = { query: `{core{me{name,email,...,photo,...}}}` };
return fetch(url, { method: 'POST', body: JSON.stringify(data) })
```

É **POST com corpo GraphQL**. A identidade desta requisição inclui o **corpo** — a
mesma URL com outro corpo devolve outra coisa. Um manifesto indexado por URL não pode
representá-la, e traduzir a chamada para um arquivo estático é sorte, não replay.

É exatamente o achado do Astra na forma mais direta: *"GET, POST e corpos diferentes
para a mesma URL colapsam no mesmo arquivo"*.

## 3. O que fica, e o que não fica

| peça | estado |
|---|---|
| Remendo de `fetch`/XHR contido a GET/HEAD | **correto e testado**, mas **inerte neste site** — a chamada é POST. Serve a sites cujo dado de runtime venha por GET; benefício não demonstrado ponta a ponta ainda. |
| Reescrita de URL dentro de corpo **JSON** | **correta e testada** (6 testes, escape de barra nas duas pontas, caminho relativo à RAIZ porque quem resolve é o documento). Benefício ponta a ponta **também não demonstrado**: aqui o JSON nunca chega ao consumidor, porque o POST morre antes. |
| "imagens 5 → 8" e "congelado 1 → 0" | **RETIRADOS** |

## 4. O desenho certo, quando for a hora

Replay fiel exige interceptar na **camada de rede do player**, antes do documento
carregar, com:

- manifesto indexado por **identidade de requisição**: método + URL + hash do corpo +
  ocorrência (duas respostas diferentes para a mesma URL passam a ser representáveis);
- **envelope completo** da resposta: status, cabeçalhos, `Response.url`, `redirected`,
  `responseURL` — hoje o remendo entrega os do arquivo local, e um site que leia esses
  campos vê outra coisa;
- cobertura de **todos os tipos de recurso e todos os realms** (`img.src`, CSS, worker,
  iframe, `sendBeacon`, `EventSource`, WebSocket), que um remendo em `window.fetch`
  nunca alcança;
- bytes servidos em origem/namespace **isolado e sem rotas mutáveis**, para que um POST
  traduzido não possa atingir rota real (confused deputy).

Isso é arquitetura, não remendo — e é o que o Astra prescreveu antes de eu medir.

## 5. Lição de método

O ganho que eu reportei era **efeito colateral de um defeito**. Consertar o defeito
apagou o ganho — e é assim que se descobre que o ganho nunca foi conserto. Corolário
prático: quando uma correção de segurança **reduz** um número de qualidade, a primeira
hipótese não é "a correção foi longe demais"; é **"o número dependia do defeito"**.
