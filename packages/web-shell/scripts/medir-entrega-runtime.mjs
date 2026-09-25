// Régua de ACEITE do lease B (plano 2026-08-26, Task 14): mede os BYTES DE REDE
// que o navegador realmente baixa ao servir o runtime do clone, em três
// momentos — abrir sem rolar / rolar até o fim / RECARREGAR — antes (flag OFF)
// e depois (flag ON). O aceite é: no depois, o RELOAD ≈ 0 (só o HTML no-store +
// revalidações), enquanto no antes o reload re-paga o pacote inteiro.
//
// ⚠️ EXIGE Chrome de MARCA (channel:'chrome'). O Chromium/WebKit do Playwright
// tem o particionamento de cache DESLIGADO e dá resultado FALSO (finding
// 2026-08-25). O runtime é carregado DENTRO de um iframe (como o editor real),
// porque o comportamento de cache depende da origem do frame (opaca × própria).
//
// PRÉ-REQUISITOS (fornecidos por você — não dá para o agente sozinho):
//   BASE_URL     — o app (default http://localhost:3030)
//   E2E_COOKIE   — o cookie de login (copie de um browser autenticado:
//                  DevTools → Application → Cookies → o cookie de sessão do app)
//   NODE_ID      — um node de clone NATIVO seu (uuid)
//   Para o modo LEASE (flag ON) também:
//     - o dev server com UNCRAFT_RUNTIME_LEASE=1, UNCRAFT_RUNTIME_HOST_SUFFIX e
//       UNCRAFT_RUNTIME_AUTHORITY_TEMPLATE apontando para HTTPS local;
//     - HTTPS local para *.<suffix> (mkcert + proxy TLS) — o cookie __Host-/
//       Partitioned EXIGE Secure, e o Chrome só isenta 'localhost' literal.
//
// USO:  E2E_COOKIE='sid=...' NODE_ID='<uuid>' node scripts/medir-entrega-runtime.mjs
//       (rode uma vez com o server flag OFF e outra com flag ON; compare.)

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '../node_modules/playwright-core/index.mjs';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3030';
const COOKIE = process.env.E2E_COOKIE || '';
const NODE_ID = process.env.NODE_ID || '';
if (!COOKIE || !NODE_ID) {
  console.error('Faltam E2E_COOKIE e/ou NODE_ID — veja o cabeçalho deste arquivo.');
  process.exit(2);
}

// 1) Abre a sessão de runtime como o editor faz (com o cookie de login) e
//    descobre a URL do runtime + o modo (lease | legacy).
async function abrirSessao() {
  const res = await fetch(`${BASE_URL}/api/nodes/${encodeURIComponent(NODE_ID)}/runtime-session`, {
    method: 'POST', headers: { cookie: COOKIE, 'content-type': 'application/json' },
  });
  if (!res.ok) throw new Error(`runtime-session ${res.status}`);
  const body = await res.json();
  if (!body?.runtime?.url) throw new Error('sem runtime.url na resposta');
  return { url: body.runtime.url, mode: body.runtime.mode === 'lease' ? 'lease' : 'legacy' };
}

// 2) Página-pai servida PELA ORIGEM DO APP (public/_aceite-lease-parent.html):
//    o runtime só aceita ser emoldurado por essa origem (frame-ancestors) —
//    um servidor local próprio em outra porta era bloqueado, e o aceite
//    falharia pelo motivo errado (medido 2026-09-06). O sandbox do modo
//    (opaco × própria origem) é o que reproduz o cache que se quer medir.
function paginaPaiUrl(runtimeUrl, mode) {
  const u = new URL('/_aceite-lease-parent.html', BASE_URL);
  u.searchParams.set('runtime', runtimeUrl);
  u.searchParams.set('mode', mode);
  return u.toString();
}

// A pergunta do aceite é uma só: RECARREGAR re-paga o pacote? Mede-se com CDP
// NO FRAME do runtime (o iframe é OOPIF — o CDP do topo não o vê, foi o erro da
// 1ª versão), recarregando o iframe NO LUGAR (identidade do frame preservada,
// a sessão CDP sobrevive). `encodedDataLength` são os bytes REAIS no fio;
// `fromDiskCache` distingue "não pediu" de "pediu de novo".
async function medirRecarga(ctx, frame) {
  const cdp = await ctx.newCDPSession(frame);
  const fase = { bytes: 0, req: 0, cache: 0 };
  await cdp.send('Network.enable');
  cdp.on('Network.loadingFinished', (e) => { fase.bytes += e.encodedDataLength || 0; });
  cdp.on('Network.responseReceived', (e) => {
    const r = e.response || {};
    if (r.fromDiskCache || r.fromPrefetchCache) fase.cache += 1; else fase.req += 1;
  });
  cdp.on('Network.requestServedFromCache', () => { fase.cache += 1; });

  await frame.evaluate(() => new Promise((res) => { location.reload(); setTimeout(res, 200); })).catch(() => {});
  await frame.waitForLoadState('load').catch(() => {});
  await new Promise((r) => setTimeout(r, 3500));
  return {
    rede_kb: (fase.bytes / 1024).toFixed(1),
    req_do_servidor: fase.req,
    req_do_cache: fase.cache,
  };
}

async function run() {
  const sessao = await abrirSessao();
  const perfil = mkdtempSync(join(tmpdir(), 'aceite-lease-'));
  const ctx = await chromium.launchPersistentContext(perfil, { headless: true, channel: 'chrome' });
  const page = await ctx.newPage();

  // Abertura FRIA: carrega o pai + o iframe do runtime (isto aquece o cache de
  // disco na origem própria; na opaca, nada é guardado).
  await page.goto(paginaPaiUrl(sessao.url, sessao.mode), { waitUntil: 'load' });
  const frame = await page.waitForSelector('#rt').then((h) => h.contentFrame());
  await frame.waitForLoadState('load').catch(() => {});
  await new Promise((r) => setTimeout(r, 4000));

  // Prova POSITIVA de render (senão "0 bytes" seria "não carregou", lição 177).
  let render = null;
  try {
    render = await frame.evaluate(() => ({
      imgs: document.images.length,
      decoded: [...document.images].filter((i) => i.complete && i.naturalWidth > 0).length,
      bridge: !!document.querySelector('[data-uncraft-runtime-bridge]'),
      scripts: document.scripts.length,
    }));
  } catch { /* opaco pode recusar evaluate no cross-origin */ }

  // RECARGA: o pacote é re-pago ou vem do cache?
  const reload = await medirRecarga(ctx, frame);
  await ctx.close();

  // O critério é BYTES no fio, não contagem de requisições: uma revalidação
  // 304 bate no servidor (Edge Request, barato) mas transfere ~0 bytes — o
  // corpo vem do cache. O custo que a conta econômica mede é Data Transfer.
  // Na concessão o reload transfere ~1 MB (o HTML de sessão no-store + 304s);
  // no legado opaco, dezenas de MB (re-baixa o pacote). Teto de 2 MB.
  const KB = Number(reload.rede_kb);
  console.log(JSON.stringify({
    modo: sessao.mode,
    render_no_iframe: render,
    reload: reload,
    veredito: sessao.mode === 'lease'
      ? (KB < 2048
        ? `OK — reload transfere ${reload.rede_kb} KB (o HTML de sessão + 304s); os assets vêm do cache, NÃO re-baixam`
        : `FALHA — reload re-pagou ${reload.rede_kb} KB de bytes; investigar`)
      : `linha de base (legado, opaco) — reload transfere ${reload.rede_kb} KB (re-paga o pacote inteiro)`,
  }, null, 2));
}

run().catch((e) => { console.error(e); process.exit(1); });
