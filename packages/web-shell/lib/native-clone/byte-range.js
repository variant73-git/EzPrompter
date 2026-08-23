/**
 * FAIXAS DE BYTES — o que faz vídeo buscar quadro.
 *
 * O portão do runtime servia todo arquivo inteiro, sem `Accept-Ranges`. Um
 * `<video>` até TOCA assim (o navegador baixa tudo e reproduz do começo), mas
 * não consegue PROCURAR: pedir `currentTime = 2` exige faixa de bytes, e sem
 * ela o navegador mantém o tempo em zero — medido no clone real.
 *
 * Isso não é detalhe de mídia: o site clonado tem um `<video class="scroll-video">`
 * cuja animação inteira é o quadro seguindo a rolagem. Sem faixa, essa
 * coreografia simplesmente não existe no clone.
 *
 * Só a forma de faixa ÚNICA é atendida. Faixa múltipla exige resposta
 * multipart, e responder o arquivo inteiro (200) é resposta permitida — melhor
 * que uma multipart mal formada.
 */

/** Interpreta o cabeçalho `Range`. Devolve null quando não se aplica. */
export function parseByteRange(cabecalho, tamanho) {
  if (typeof cabecalho !== 'string' || !Number.isInteger(tamanho) || tamanho < 0) return null;
  const m = /^\s*bytes\s*=\s*(.+)$/i.exec(cabecalho);
  if (!m) return null;
  const partes = m[1].split(',');
  // Faixa múltipla: não fingimos atender — quem chama serve o arquivo inteiro.
  if (partes.length !== 1) return null;
  const spec = partes[0].trim();
  const sufixo = /^-(\d+)$/.exec(spec);
  if (sufixo) {
    const quantos = Number(sufixo[1]);
    // `bytes=-0` não pede byte nenhum: é insatisfazível, não o arquivo inteiro.
    if (!Number.isFinite(quantos) || quantos <= 0) return { satisfazivel: false, tamanho };
    if (tamanho === 0) return { satisfazivel: false, tamanho };
    const inicio = Math.max(0, tamanho - quantos);
    return { satisfazivel: true, inicio, fim: tamanho - 1, tamanho };
  }
  const par = /^(\d+)-(\d*)$/.exec(spec);
  if (!par) return null;                       // forma que não entendemos: ignora
  const inicio = Number(par[1]);
  if (!Number.isFinite(inicio)) return null;
  // Início além do fim é insatisfazível — e num arquivo vazio TODA faixa é.
  if (inicio >= tamanho) return { satisfazivel: false, tamanho };
  const fim = par[2] === '' ? tamanho - 1 : Math.min(Number(par[2]), tamanho - 1);
  if (!Number.isFinite(fim) || fim < inicio) return { satisfazivel: false, tamanho };
  return { satisfazivel: true, inicio, fim, tamanho };
}

/** Cabeçalhos da resposta 206 (ou 416, quando insatisfazível). */
export function rangeHeaders(faixa) {
  if (!faixa) return null;
  if (!faixa.satisfazivel) return { status: 416, 'Content-Range': `bytes */${faixa.tamanho}` };
  return {
    status: 206,
    'Content-Range': `bytes ${faixa.inicio}-${faixa.fim}/${faixa.tamanho}`,
    'Content-Length': String(faixa.fim - faixa.inicio + 1),
  };
}
