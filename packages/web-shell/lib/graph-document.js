/**
 * O DOCUMENTO QUE VAI PARA O MODELO — sem os pixels.
 *
 * Medido em 2026-08-22 na fotocópia do DOM de um site real: 18.131 KB, dos
 * quais **96% são data URIs** (960 imagens em base64, 17.409 KB). Estrutura e
 * texto somam 479 KB; folhas de estilo, 243 KB.
 *
 * Mandar base64 para um modelo é queimar token por nada: ele não vê a imagem
 * ali, vê um paredão de caracteres. E o teto é real — o style transfer sobre um
 * documento desses volta `429 Request too large`. Era por isso que o grafo só
 * funcionava a partir do motor legado, cuja saída tem ~70 KB.
 *
 * Aqui os pixels saem e um MARCADOR fica no lugar, com o tipo e uma etiqueta
 * estável. O modelo continua sabendo que existe uma imagem naquela posição, e o
 * que ele devolver pode ser re-inflado com os bytes originais.
 *
 * ⚠️ Referências ficam PRIVADAS (advise do Sol): nada de URL pública por
 * bundle. O marcador não é endereço — é etiqueta local do documento, e só quem
 * já tem o documento consegue re-inflar.
 */

// `data:<mime>[;param]*;base64,<payload>` — o payload é o que pesa.
const DATA_URI = /data:([a-z0-9.+-]+\/[a-z0-9.+-]+)((?:;[a-z0-9.+-]+=?[a-z0-9.+-]*)*);base64,([A-Za-z0-9+/=]{64,})/gi;

/** Etiqueta curta e estável para o mesmo payload — repetições viram uma só. */
function etiqueta(payload, indice) {
  let h = 2166136261;
  for (let i = 0; i < payload.length; i += 1) {
    h ^= payload.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `${(h >>> 0).toString(36)}${indice.toString(36)}`;
}

/**
 * @returns {{ text: string, assets: Map<string,string>, removedBytes: number }}
 */
export function toModelDocument(html) {
  const assets = new Map();
  const porPayload = new Map();
  let indice = 0;
  let removedBytes = 0;
  const text = String(html || '').replace(DATA_URI, (inteiro, mime, params, payload) => {
    // Chave e' a URI INTEIRA, nao so' o payload: os mesmos bytes anunciados com
    // mime diferente sao coisas diferentes, e chavear pelo payload devolvia o
    // primeiro mime na restauracao (o teste de srcset/CSS pegou).
    let id = porPayload.get(inteiro);
    if (!id) {
      id = etiqueta(payload, indice++);
      porPayload.set(inteiro, id);
      assets.set(id, inteiro);
    }
    removedBytes += inteiro.length;
    // O marcador é uma URL válida: assim ele sobrevive a atributos `src`,
    // `srcset` e a `url()` de CSS sem quebrar o parsing de quem ler depois.
    return `uncraft-asset:${id};${mime}`;
  });
  return { text, assets, removedBytes };
}

/** Devolve os bytes ao que o modelo escreveu. Marcador desconhecido fica. */
export function restoreModelDocument(text, assets) {
  if (!assets || assets.size === 0) return String(text || '');
  return String(text || '').replace(/uncraft-asset:([a-z0-9]+);[a-z0-9.+-]+\/[a-z0-9.+-]+/gi, (inteiro, id) => (
    assets.get(id) || inteiro
  ));
}

/** Une os mapas de várias fontes; etiquetas iguais carregam o mesmo payload. */
export function mergeDocumentAssets(...mapas) {
  const uniao = new Map();
  for (const m of mapas) {
    if (!m) continue;
    for (const [k, v] of m) if (!uniao.has(k)) uniao.set(k, v);
  }
  return uniao;
}
