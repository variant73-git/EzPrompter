// MAPA DA CAPTURA: endereco remoto -> arquivo que o produtor do nativo guardou. Modulo PROPRIO porque a
// normalizacao e a analise do plano visual usam os dois — e a analise importada pela normalizacao que importava
// a normalizacao de volta TRAVAVA o processo (ciclo de import com await no topo: cada lado esperava o outro).
// A identidade vem do MAPA que o produtor gravou (caminho emitido -> URL original, ja com os desempates de
// nome que ele faz quando dois enderecos colidem), embutido na pagina nativa. Nunca se recalcula o nome e se
// toma "o arquivo existe" como prova (Astra r2: `a%20b.png` e `a_20b.png` dao o mesmo nome; o segundo fica
// com sufixo, e o recalculo serviria os bytes do primeiro). Sem o mapa: nada e trocado.
export function mapaDaCaptura(htmlNativo) {
  const porUrl = Object.create(null);   // sem prototipo: uma URL nunca cai num setter herdado
  const m = /var ALHEIOS = JSON\.parse\(("(?:[^"\\]|\\.)*")\)/.exec(htmlNativo || '');
  if (!m) return porUrl;
  try { for (const [c, u] of Object.entries(JSON.parse(JSON.parse(m[1])))) if (typeof u === 'string' && !(u in porUrl)) porUrl[u] = c; } catch { return Object.create(null); }
  return porUrl;
}
export function arquivoCapturado(porUrl, url) { const u = String(url).split('#')[0]; return Object.prototype.hasOwnProperty.call(porUrl, u) ? porUrl[u] : null; }
export function mapaDeRemotas(urls, porUrl) {
  const m = {}; for (const u of new Set(urls)) { const l = arquivoCapturado(porUrl, u); if (l) m[u] = l; } return m;
}
