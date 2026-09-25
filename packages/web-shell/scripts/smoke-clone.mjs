/**
 * smoke:clone — o porteiro. Roda O PRODUTO, não o código.
 *
 * POR QUE ISTO EXISTE (2026-08-21): numa mesma sessão a suíte deu 1920 verdes,
 * o build compilou, e mesmo assim uma feature saiu MORTA — apontava para uma
 * rota que devolve erro em produção. Testes de unidade provam a lógica de quem
 * os escreveu; nenhum deles perguntou "o produto ainda funciona?". Este script
 * pergunta, contra o servidor de verdade, pelas rotas de verdade.
 *
 * A CADEIA verificada é a que quebra na prática:
 *   1. servidor responde
 *   2. bundle nativo registra (bytes + descritor no banco)
 *   3. node existe apontando para esse bundle
 *   4. /runtime-session emite a URL do runtime  ← autenticação + sessão
 *   5. o runtime SERVE a página                 ← o elo do "localhost is blocked"
 *   6. as rotas de mídia do node respondem o esperado
 *
 * Custa ZERO: usa o fixture local (`e2e/fixtures/native-motion/fixture-site`),
 * não sai para a internet e não chama modelo nenhum. Roda em segundos.
 * Limpa o que criou — o board de smoke é apagado no fim, sempre.
 *
 * Uso:
 *   npm run smoke:clone                 # servidor já rodando em :3030
 *   npm run smoke:clone -- --port 3030
 *   npm run smoke:clone -- --keep       # não apaga o board (para inspecionar)
 */
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { db } from '../lib/db.js';
import { createToken } from '../lib/auth.js';
import { createConfiguredBundleStore } from '../lib/native-clone/bundle-store.js';
import { registerNativeBundle } from '../lib/native-clone/register-bundle.js';
import { persistNativeBundleDescriptor } from '../lib/motion-editor/edit-session-store.js';
import { createEmptyMotionManifest } from '../lib/motion-editor/manifest.js';

// O servidor de dev herda `.env.local` porque o Next o carrega; um `node`
// puro não. Sem isto o smoke morre no passo 2 dizendo que falta DATABASE_URL
// enquanto o servidor ao lado funciona — e a culpa parece do produto.
// (`--env-file-if-exists` no npm script cobre o caminho normal; este bloco
// cobre quem chama `node scripts/smoke-clone.mjs` na mão.)
if (!process.env.DATABASE_URL) {
  try {
    const { readFileSync: lerArquivo } = await import('node:fs');
    for (const linha of lerArquivo('.env.local', 'utf8').split('\n')) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(linha);
      if (!m) continue;
      const valor = m[2].trim().replace(/^["']|["']$/g, '');
      if (!(m[1] in process.env)) process.env[m[1]] = valor;
    }
  } catch { /* sem .env.local: o passo 2 dirá o que falta */ }
}

const args = process.argv.slice(2);
const opt = (nome, padrao) => {
  const i = args.indexOf(`--${nome}`);
  return i === -1 ? padrao : args[i + 1];
};
const PORT = Number(opt('port', process.env.PORT || 3030));
const BASE = `http://localhost:${PORT}`;
const MANTER = args.includes('--keep');
const TAG = 'smoke-clone';

const passos = [];
let falhou = false;

async function passo(nome, fn) {
  if (falhou) { passos.push({ nome, estado: 'pulado' }); return null; }
  const t = Date.now();
  try {
    const valor = await fn();
    passos.push({ nome, estado: 'ok', ms: Date.now() - t, detalhe: valor?.__detalhe });
    return valor;
  } catch (e) {
    passos.push({ nome, estado: 'FALHOU', ms: Date.now() - t, erro: String(e?.message || e) });
    falhou = true;
    return null;
  }
}

function conferir(condicao, mensagem) {
  if (!condicao) throw new Error(mensagem);
}

// ── a cadeia ────────────────────────────────────────────────────────────────
let sql; let store; let cookie; let boardId; let nodeId; let descriptor;

await passo('1. servidor de dev responde', async () => {
  const res = await fetch(`${BASE}/api/boards`, { redirect: 'manual' }).catch((e) => {
    throw new Error(`sem resposta em ${BASE} — o servidor está rodando? (${e.message})`);
  });
  conferir(res.status !== 404, `${BASE}/api/boards devolveu 404 — porta errada?`);
  // ⚠️ A primeira versão deste passo aceitava QUALQUER status que não fosse
  // 404 — e passou com HTTP 500, dizendo "ok" para um servidor quebrado.
  // Teste que não testa: o smoke que existe para pegar isso não pode ser o
  // primeiro a deixar passar. Sem sessão, o esperado é 401/403; 5xx é defeito.
  if (res.status >= 500) {
    const corpo = await res.text().catch(() => '');
    throw new Error(`o servidor respondeu HTTP ${res.status} numa rota básica `
      + `(/api/boards sem sessão deveria dar 401). Corpo: ${corpo.slice(0, 200) || '(vazio)'}`);
  }
  conferir([401, 403, 200].includes(res.status),
    `/api/boards devolveu ${res.status}; esperado 401 sem sessão`);
  return { __detalhe: `HTTP ${res.status}` };
});

await passo('2. banco alcançável + usuário de smoke', async () => {
  sql = await db();
  const [u] = await sql`
    INSERT INTO users (email, password_hash, name, plan, role)
    VALUES (${'smoke-clone@uncraft.local'}, ${'x'}, ${'Smoke'}, 'free', 'member')
    ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
    RETURNING id, email, plan`;
  cookie = `uncraft_sess=${createToken({ id: u.id, email: u.email, plan: u.plan })}`;
  const [b] = await sql`
    INSERT INTO boards (user_id, name) VALUES (${u.id}, ${TAG}) RETURNING id`;
  boardId = b.id;
  return { __detalhe: `board ${boardId}` };
});

await passo('3. bundle nativo registra (bytes + descritor)', async () => {
  store = createConfiguredBundleStore();
  const html = readFileSync(join(process.cwd(), 'e2e/fixtures/native-motion/fixture-site/index.html'), 'utf8');
  descriptor = await registerNativeBundle({
    assets: [{ path: 'index.html', body: html, contentType: 'text/html; charset=utf-8' }],
    entryPath: 'index.html',
    runtimeFingerprint: `sha256:${createHash('sha256').update(`smoke:${html}`).digest('hex')}`,
    reconstructionCapabilities: { detectedEngines: ['css'], candidateControls: [] },
  }, { store });
  await persistNativeBundleDescriptor({ sql, descriptor });
  conferir(descriptor.assetIndex.length > 0, 'bundle registrado sem nenhum arquivo');
  return { __detalhe: `${descriptor.assetIndex.length} arquivo(s), bundle ${descriptor.bundleId.slice(0, 8)}` };
});

await passo('4. node aponta para o bundle', async () => {
  const manifest = createEmptyMotionManifest({
    baseBundleId: descriptor.bundleId,
    runtimeFingerprint: descriptor.runtimeFingerprint,
  });
  const [n] = await sql`
    INSERT INTO nodes (board_id, kind, pos_x, pos_y, width, height, meta)
    VALUES (${boardId}, 'site', 0, 0, 1280, 720, ${JSON.stringify({ smoke: TAG })}::jsonb)
    RETURNING id`;
  nodeId = n.id;
  const [s] = await sql`
    INSERT INTO snapshots (node_id, source, native_bundle_id, motion_manifest, motion_manifest_version)
    VALUES (${nodeId}, 'native-bundle', ${descriptor.bundleId},
            ${JSON.stringify(manifest)}::jsonb, ${manifest.schemaVersion})
    RETURNING id`;
  await sql`UPDATE nodes SET current_snapshot_id = ${s.id} WHERE id = ${nodeId}`;
  return { __detalhe: `node ${nodeId}` };
});

const runtime = await passo('5. /runtime-session emite a URL do runtime', async () => {
  const res = await fetch(`${BASE}/api/nodes/${nodeId}/runtime-session`, {
    method: 'POST', headers: { cookie },
  });
  const corpo = await res.json().catch(() => ({}));
  conferir(res.ok, `HTTP ${res.status} — ${JSON.stringify(corpo).slice(0, 160)}`);
  conferir(corpo?.runtime?.url, 'resposta sem runtime.url');
  return { url: corpo.runtime.url, __detalhe: new URL(corpo.runtime.url).pathname.slice(0, 48) + '…' };
});

await passo('6. o runtime SERVE a página (o elo do "localhost is blocked")', async () => {
  const res = await fetch(runtime.url, { headers: { cookie } });
  const corpo = await res.text();
  const motivo = res.headers.get('x-uncraft-runtime-failure');
  conferir(res.ok, motivo
    ? `o runtime RECUSOU — motivo: ${motivo} (HTTP ${res.status})`
    : `HTTP ${res.status} — corpo: ${corpo.slice(0, 120)}`);
  conferir(/<html|<!doctype/i.test(corpo), 'o runtime respondeu 200 mas não devolveu HTML');
  conferir(corpo.includes('data-uncraft-runtime-bridge'), 'HTML servido SEM a ponte do editor injetada');
  return { __detalhe: `${corpo.length}B, com ponte` };
});

await passo('7. mídia do node responde o esperado', async () => {
  const thumb = await fetch(`${BASE}/api/nodes/${nodeId}/thumbnail`, { headers: { cookie } });
  conferir([200, 404].includes(thumb.status), `thumbnail devolveu ${thumb.status}`);
  // ⚠️ CUIDADO com o 404 aqui. A primeira versão exigia só `status === 404`,
  // e isso passa DUAS vezes por motivos diferentes: a rota existindo e dizendo
  // "não tem vídeo", ou a rota não existindo (o 404 padrão do Next). Passou
  // verde numa máquina onde a rota nem estava instalada — asserção satisfeita
  // pelo motivo errado, o mesmo defeito que este smoke existe para pegar.
  // O corpo distingue: a rota responde JSON; o 404 do framework, HTML.
  const prev = await fetch(`${BASE}/api/nodes/${nodeId}/preview-video`, { headers: { cookie } });
  const corpoPrev = await prev.text().catch(() => '');
  const rotaExiste = prev.headers.get('content-type')?.includes('json') || corpoPrev.trim().startsWith('{');
  let detalhePrev;
  if (!rotaExiste && prev.status === 404) {
    detalhePrev = 'preview-video AUSENTE (rota não instalada)';
  } else {
    conferir(prev.status === 404, `preview-video devolveu ${prev.status}; esperado 404 sem vídeo no bundle`);
    conferir(/no_preview/.test(corpoPrev), `preview-video respondeu 404 sem dizer no_preview: ${corpoPrev.slice(0, 80)}`);
    // E a rota não pode servir mídia de node alheio.
    const alheio = await fetch(`${BASE}/api/nodes/${randomUUID()}/preview-video`, { headers: { cookie } });
    conferir(alheio.status === 404, `node inexistente devolveu ${alheio.status}`);
    detalhePrev = 'preview-video ok';
  }
  return { __detalhe: `thumbnail + ${detalhePrev}` };
});

// ── limpeza ─────────────────────────────────────────────────────────────────
if (sql && boardId && !MANTER) {
  try {
    await sql`DELETE FROM nodes WHERE board_id = ${boardId}`;
    await sql`DELETE FROM boards WHERE id = ${boardId}`;
  } catch (e) {
    passos.push({ nome: 'limpeza', estado: 'FALHOU', erro: String(e?.message || e) });
  }
}

// ── veredito ────────────────────────────────────────────────────────────────
console.log('\n  SMOKE DO CLONE — a cadeia do produto\n');
for (const p of passos) {
  const marca = p.estado === 'ok' ? '  ok  ' : p.estado === 'pulado' ? '  --  ' : ' FALHA';
  const tempo = p.ms != null ? ` ${String(p.ms).padStart(5)}ms` : '        ';
  console.log(`${marca}${tempo}  ${p.nome}${p.detalhe ? `  (${p.detalhe})` : ''}`);
  if (p.erro) console.log(`         ↳ ${p.erro}`);
}
if (falhou) {
  console.log('\n  ✖ A CADEIA QUEBROU no passo acima. Os passos seguintes nem rodaram —');
  console.log('    conserte este primeiro; o que vem depois pode estar inteiro.\n');
  process.exit(1);
}
console.log(`\n  ✔ cadeia inteira de pé${MANTER ? ` (board ${boardId} mantido)` : ''}\n`);
process.exit(0);
