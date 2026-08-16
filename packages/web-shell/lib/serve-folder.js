import { createServer } from 'node:http';
import { realpath, readFile } from 'node:fs/promises';
import path from 'node:path';

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.otf': 'font/otf',
  '.ttf': 'font/ttf',
  '.mp4': 'video/mp4',
};

/**
 * Serve UMA pasta por HTTP, para que uma página local seja medida com a folha de
 * estilo e as imagens resolvendo como resolvem de verdade.
 *
 * ⚠️ A contenção compara CAMINHO REAL e inclui o separador. `startsWith(raiz)`
 * cru deixaria passar `/tmp/site-secreto` quando a raiz é `/tmp/site` — o texto
 * começa igual — e um symlink dentro da pasta apontaria para qualquer lugar.
 * Importa porque a página medida roda na MESMA origem: o que este servidor
 * entrega, ela lê e pode mandar embora.
 */
export async function serveFolder(raiz) {
  const raizReal = await realpath(path.resolve(raiz));
  const prefixo = raizReal.endsWith(path.sep) ? raizReal : raizReal + path.sep;
  const servidor = createServer(async (req, res) => {
    let relativo;
    try {
      relativo = decodeURIComponent((req.url || '/').split('?')[0]).replace(/^\/+/, '');
    } catch (_) {
      res.writeHead(400).end();
      return;
    }
    try {
      const alvoReal = await realpath(path.resolve(raizReal, relativo));
      if (alvoReal !== raizReal && !alvoReal.startsWith(prefixo)) { res.writeHead(403).end(); return; }
      const corpo = await readFile(alvoReal);
      res.writeHead(200, { 'content-type': TIPOS[path.extname(alvoReal).toLowerCase()] || 'application/octet-stream' });
      res.end(corpo);
    } catch (_) {
      res.writeHead(404).end();
    }
  });
  await new Promise((pronto) => servidor.listen(0, '127.0.0.1', pronto));
  const porta = servidor.address().port;
  return {
    porta,
    origem: `http://127.0.0.1:${porta}`,
    fechar: () => new Promise((pronto) => servidor.close(pronto)),
  };
}
