// RASTRO COMPLETO DA GRAVACAO (2026-10-06): tudo o que decide as fichas — as DUAS leituras de cada parada
// (a: 300 ms, b: assentada), o que cada canvas mostrava nelas, os lacos confirmados e o historico de desenho
// dos canvas — por id canonico. A comparacao de "mesmo resultado" precisa disto: a gravacao-nativa guarda
// so b, e a e que separa revelacao de rolagem e escolhe os suspeitos de laco (Astra/Codex, 2026-10-06).
// Liga com UNCRAFT_RASTRO=<arquivo>; nao muda nada na gravacao.
import { writeFile } from 'node:fs/promises';

export async function gravarRastro(arquivo, gravacao, mapa) {
  const id = (k) => mapa[k] || `rec:${k}`;
  const porId = (m) => (m ? Object.fromEntries(Object.entries(m).map(([k, v]) => [id(k), v])) : m);
  await writeFile(arquivo, JSON.stringify({
    amostras: gravacao.amostras.map((s) => ({ y: s.y, a: porId(s.a), b: porId(s.b), telasA: porId(s.telasA), telas: porId(s.telas) })),
    lacos: [...gravacao.lacos].map(id).sort(),
    sequencias: (gravacao.sequencias || []).map((q) => ({ ...q, rec: id(q.rec) })),
  }));
}
