/**
 * A ORIGEM QUE O SITE MONTA EM RUNTIME.
 *
 * Medido no clone real: 145 imagens de uma sequência de rolagem morrem porque o
 * JavaScript do site concatena `base + nome` e pede ao CDN, que a política de
 * segurança bloqueia — com os 142 arquivos já dentro do bundle. A captura pegou
 * tudo; o que falta é a tradução, porque nenhuma reescrita alcança uma URL que
 * só existe depois que o código roda.
 *
 * A tradução acontece AO SERVIR, nunca no bundle guardado: o artefato fica
 * imutável e o caminho traduzido carrega o token da sessão.
 *
 * ⚠️ Dirigida pelo MANIFESTO: só se traduz origem que existe no bundle. Uma
 * origem que não foi capturada continua externa — e é melhor um pedido
 * bloqueado, que aparece, do que um caminho local que devolve 404 calado.
 *
 * ⚠️ E só dentro de STRING de verdade, com a origem começando no PRIMEIRO
 * caractere do valor. Uma URL citada num comentário, dentro de uma expressão
 * regular, ou no meio de uma frase, não é referência. Onde a leitura do
 * JavaScript não é segura, o arquivo inteiro fica INTOCADO.
 */
import { parseFragment } from 'parse5';
import { bundlePathForUrl } from './capture-bundle.js';
import { stringLiteralsDeJs } from './js-string-literals.js';

/**
 * O que o bundle de fato contém: os hosts E os caminhos.
 *
 * Só o host não basta (achado do Sol): traduzir `https://host/inexistente.png`
 * porque OUTRO arquivo daquele host foi capturado transforma um pedido externo
 * explícito num 404 local. Quando o literal traz caminho, ele é conferido
 * contra o índice; quando é só a base (o caso da sequência de frames, em que o
 * sufixo ainda não existe), a conferência cabe ao gateway ao servir.
 */
export function origensDoBundle(assetIndex) {
  const hosts = new Set();
  const caminhos = new Set();
  for (const asset of Array.isArray(assetIndex) ? assetIndex : []) {
    const p = String(asset?.path || '');
    const m = /^_ext\/([a-z0-9.-]+)\//i.exec(p);
    if (!m) continue;
    hosts.add(m[1].toLowerCase());
    // ⚠️ Só o HOST é insensível a maiúsculas. Caminho de URL não é: baixar
    // `foo.png` não autoriza `FOO.png`, e traduzir assim mandaria o gateway
    // procurar um arquivo que não existe — 404 local no lugar de um pedido
    // externo honesto (Sol).
    caminhos.add(p);
  }
  hosts.caminhos = caminhos;
  return hosts;
}

function origemNoInicio(valor, hosts) {
  const m = /^(https?:)?\/\/([a-z0-9.-]+)(?=\/|$)/i.exec(valor);
  if (!m) return null;
  const host = m[2].toLowerCase();
  if (!hosts.has(host)) return null;
  const resto = valor.slice(m[0].length);
  // Base (só origem, ou origem + diretório): o sufixo é montado depois, então
  // não há o que conferir aqui — o gateway confere o caminho resolvido.
  const ehBase = resto === '' || resto.endsWith('/');
  if (ehBase) return { tamanho: m[0].length, host };
  // Caminho completo: só traduz se ESTE arquivo existe no bundle — e a chave é
  // derivada pela MESMA função que a captura usou para nomear o arquivo.
  //
  // ⚠️ Derivar com normalização própria foi erro medido: a captura saneia o
  // nome (espaço e parêntese viram `_`) e embute a query no nome, então
  // `field%20img%20(1).avif` vira `field_20img_20_1_.avif`. Comparando à minha
  // maneira, o arquivo existia e eu dizia que não — e o pedido saía externo.
  const caminhos = hosts.caminhos;
  if (!caminhos) return null;
  let chave = null;
  try {
    // O segundo argumento é a página de ORIGEM. Passando o mesmo host, a função
    // trataria o recurso como interno e não geraria o prefixo `_ext/` — daí o
    // host-sentinela, que nunca coincide com um real.
    chave = bundlePathForUrl(new URL(valor, `https://${host}`).toString(), 'https://uncraft.invalid/');
  } catch { return null; }
  return caminhos.has(chave) ? { tamanho: m[0].length, host } : null;
}

/**
 * @returns {{ texto: string, traduzidas: number, completo: boolean, motivo: string|null }}
 */
export function translateRuntimeOrigins(fonte, { hosts, runtimeBase } = {}) {
  const texto = String(fonte || '');
  const conjunto = hosts instanceof Set ? hosts : new Set(hosts || []);
  if (!conjunto.size) return { texto, traduzidas: 0, completo: true, motivo: null };
  const base = String(runtimeBase || '').replace(/\/+$/, '');
  if (!base) throw new TypeError('A runtime base path is required');

  const leitura = stringLiteralsDeJs(texto);
  if (!leitura.completo) {
    // Servir o original é sempre melhor que corromper o script que faz o site
    // se mexer. A cobertura incompleta é DITA, não engolida.
    return { texto, traduzidas: 0, completo: false, motivo: leitura.motivo };
  }

  // De trás para frente: os offsets dos literais seguintes continuam válidos.
  let saida = texto;
  let traduzidas = 0;
  for (let i = leitura.literais.length - 1; i >= 0; i -= 1) {
    const { inicio, fim } = leitura.literais[i];
    const valor = texto.slice(inicio, fim);
    const achado = origemNoInicio(valor, conjunto);
    if (!achado) continue;
    const resto = valor.slice(achado.tamanho);
    saida = `${saida.slice(0, inicio)}${base}/_ext/${achado.host}${resto}${saida.slice(fim)}`;
    traduzidas += 1;
  }
  return { texto: saida, traduzidas, completo: true, motivo: null };
}

/**
 * O MESMO, DENTRO DOS `<script>` INLINE DE UM HTML.
 *
 * Medido: no clone real a origem aparece 164 vezes no documento de entrada, e o
 * DOM tem só 4 atributos apontando para lá — o resto vive em script embutido,
 * que constrói `Image()` para uma sequência de 145 frames. A reescrita de
 * referências não alcança isso por desenho, e é onde o defeito de fato mora.
 *
 * Cada bloco é traduzido isoladamente. Um bloco cuja leitura não é segura fica
 * INTOCADO e conta como cobertura incompleta — o resto do documento segue.
 */
export function translateRuntimeOriginsInHtml(html, { hosts, runtimeBase } = {}) {
  const texto = String(html || '');
  const conjunto = hosts instanceof Set ? hosts : new Set(hosts || []);
  if (!conjunto.size) return { texto, traduzidas: 0, blocos: 0, incompletos: 0 };

  // ⚠️ TOKENIZER DE HTML, não expressão regular (achado do Sol). Um `<script>`
  // dentro de `<textarea>` é TEXTO para o navegador, e uma regex o trataria
  // como código; e um `>` dentro de atributo com aspas encerra `[^>]*` cedo
  // demais, deslocando os limites do corpo. Quem sabe onde um script começa e
  // termina é o parser.
  const arvore = parseFragment(texto, { sourceCodeLocationInfo: true });
  const encontrados = [];
  const visitar = (no, dentroDeTexto) => {
    for (const filho of no.childNodes || []) {
      const nome = filho.nodeName;
      // `textarea`, `title`, `xmp` e afins têm conteúdo de TEXTO puro.
      const textual = dentroDeTexto || ['textarea', 'title', 'xmp', 'noscript', 'noembed', 'noframes'].includes(nome);
      if (nome === 'script' && !textual) {
        const attrs = Object.fromEntries((filho.attrs || []).map((a2) => [a2.name.toLowerCase(), a2.value]));
        const tipo = attrs.type;
        const executavel = !('src' in attrs)
          && (!tipo || /^(?:text\/javascript|application\/javascript|module)$/i.test(tipo.trim()));
        const loc = filho.sourceCodeLocation;
        if (executavel && loc?.startTag && loc?.endTag) {
          encontrados.push({ inicio: loc.startTag.endOffset, fim: loc.endTag.startOffset });
        }
      }
      visitar(filho, textual);
      if (filho.content) visitar(filho.content, textual);
    }
  };
  visitar(arvore, false);

  let traduzidas = 0;
  let blocos = 0;
  let incompletos = 0;
  let saida = texto;
  // De trás para frente: os offsets anteriores continuam válidos.
  for (let i = encontrados.length - 1; i >= 0; i -= 1) {
    const { inicio, fim } = encontrados[i];
    const corpo = texto.slice(inicio, fim);
    if (!corpo.trim()) continue;
    blocos += 1;
    const r = translateRuntimeOrigins(corpo, { hosts: conjunto, runtimeBase });
    if (!r.completo) { incompletos += 1; continue; }
    if (!r.traduzidas) continue;
    traduzidas += r.traduzidas;
    saida = saida.slice(0, inicio) + r.texto + saida.slice(fim);
  }
  return { texto: saida, traduzidas, blocos, incompletos };
}

/**
 * O MESMO, DENTRO DE UM JSON.
 *
 * Lottie e manifestos de mídia guardam URLs absolutas, e o código do site as
 * usa direto, sem passar por nenhuma reescrita.
 *
 * ⚠️ Honestidade sobre a motivação: eu escrevi antes que um `logo icon.svg`
 * vinha de um Lottie. Isso era HIPÓTESE, não medida — cobrir JSON não mudou o
 * resultado daquele arquivo, e a origem real do pedido continua não
 * identificada. A cobertura de JSON vale por si (URL absoluta em JSON não era
 * traduzida por ninguém), mas não é a causa daquele residual.
 *
 * ⚠️ Residual conhecido: a regra é "string que COMEÇA com origem conhecida", a
 * mesma do JavaScript. Um texto visível que comece com a URL do CDN seria
 * traduzido junto. Restringir por campo exigiria conhecer o schema de cada
 * formato; fica nomeado.
 *
 * Aqui não há a ambiguidade do JavaScript: string em JSON é string, e o próprio
 * `JSON.parse` diz se o arquivo é válido. Inválido fica INTOCADO.
 */
export function translateRuntimeOriginsInJson(fonte, { hosts, runtimeBase } = {}) {
  const texto = String(fonte || '');
  const conjunto = hosts instanceof Set ? hosts : new Set(hosts || []);
  if (!conjunto.size || !texto.trim()) return { texto, traduzidas: 0, completo: true, motivo: null };
  const base = String(runtimeBase || '').replace(/\/+$/, '');
  if (!base) throw new TypeError('A runtime base path is required');

  let dados;
  try { dados = JSON.parse(texto); } catch (erro) {
    return { texto, traduzidas: 0, completo: false, motivo: 'json_invalido' };
  }
  let traduzidas = 0;
  const visitar = (valor) => {
    if (typeof valor === 'string') {
      const achado = origemNoInicio(valor, conjunto);
      if (!achado) return valor;
      traduzidas += 1;
      return `${base}/_ext/${achado.host}${valor.slice(achado.tamanho)}`;
    }
    if (Array.isArray(valor)) return valor.map(visitar);
    if (valor && typeof valor === 'object') {
      // `Object.create(null)` e `defineProperty`: um JSON com a chave
      // `__proto__` viraria mutação de protótipo numa atribuição comum, e a
      // chave sumiria do objeto reconstruído (Sol).
      const saida = Object.create(null);
      for (const chave of Object.keys(valor)) {
        Object.defineProperty(saida, chave, {
          value: visitar(valor[chave]), enumerable: true, writable: true, configurable: true,
        });
      }
      return saida;
    }
    return valor;
  };
  const convertido = visitar(dados);
  if (!traduzidas) return { texto, traduzidas: 0, completo: true, motivo: null };
  return { texto: JSON.stringify(convertido), traduzidas, completo: true, motivo: null };
}
