import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../../lib/auth.js';
import { addAssetFromUrlTool } from '../../../../lib/agent/tools/add-asset-from-url.js';
import { sql } from '../../../../lib/db.js';

export const runtime = 'nodejs';
// Buscar a imagem na rede e guardar em base64: 30s aperta para arquivo grande
// em rede ruim, e o corte fica no cap de 10MB da ferramenta, nao no relogio.
export const maxDuration = 60;

/**
 * Trazer uma imagem de fora para dentro do quadro, por ENDEREÇO.
 *
 * Existe porque colar uma imagem copiada da internet não entregava arquivo
 * nenhum: o navegador põe só `text/html` com o `<img src>` (ou a URL, quando se
 * copia o endereço). O servidor é quem busca — o navegador esbarraria em CORS
 * na maioria dos sites.
 *
 * A mesma ingestão que o agente já usava, agora também alcançável pela colagem.
 * A guarda de rede (endereço tem que ser público) vive lá dentro, valendo para
 * os dois caminhos.
 */
export async function POST(request) {
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let corpo;
  try { corpo = await request.json(); } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }); }

  const url = String(corpo?.url || '').trim();
  const boardId = corpo?.boardId;
  if (!url) return NextResponse.json({ error: 'invalid_args', message: 'url required' }, { status: 400 });
  if (!boardId) return NextResponse.json({ error: 'invalid_args', message: 'boardId required' }, { status: 400 });

  const out = await addAssetFromUrlTool.execute(
    { url, name: corpo?.name || null, attachToBoard: corpo?.attachToBoard !== false },
    { userId: user.id, boardId },
  );

  if (out?.error) {
    // `not_image` e `blocked_host` não são falha do servidor: são respostas.
    // O canvas usa a primeira para voltar ao comportamento antigo (node de
    // site) em vez de deixar a colagem morrer em silêncio.
    const status = out.error === 'forbidden' ? 403
      : out.error === 'invalid_args' ? 400
        : out.error === 'not_image' ? 415
          : out.error === 'blocked_host' ? 422
            : 502;
    return NextResponse.json(out, { status });
  }
  // O node ja nasceu no servidor com os pixels em `meta.dataUrl` — e' de la'
  // que o canvas desenha um asset. Devolver a LINHA em vez de remontar no
  // cliente evita que o que aparece na tela e o que esta guardado divirjam.
  // (A ferramenta do agente nao devolve `dataUrl` de proposito: o retorno dela
  // vai para dentro do contexto do modelo.)
  let node = null;
  if (out?.nodeId) {
    const linhas = await sql`SELECT id, board_id, kind, pos_x, pos_y, width, height, meta FROM nodes WHERE id = ${out.nodeId}`;
    node = linhas[0] || null;
  }
  return NextResponse.json({ ...out, node }, { status: 201 });
}
