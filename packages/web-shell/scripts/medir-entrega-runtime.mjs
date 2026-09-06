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

// 3) Mede bytes de rede (encodedDataLength via CDP) num intervalo nomeado.
async function medir(page, cdp, rotulo, fase) {
  const antes = fase.total;
  await rotulo();
  await page.waitForTimeout(2500);
  return fase.total - antes;
}

async function run() {
  const sessao = await abrirSessao();

  const perfil = mkdtempSync(join(tmpdir(), 'aceite-lease-'));
  const ctx = await chromium.launchPersistentContext(perfil, { headless: true, channel: 'chrome' });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  const fase = { total: 0 };
  cdp.on('Network.loadingFinished', (e) => { fase.total += e.encodedDataLength || 0; });

  const abrir = () => page.goto(paginaPaiUrl(sessao.url, sessao.mode), { waitUntil: 'load' });
  const rolar = async () => {
    const f = page.frameLocator('#rt');
    await f.locator('body').evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
  };
  const recarregar = () => page.reload({ waitUntil: 'load' });

  const bytesAbrir = await medir(page, cdp, abrir, fase);
  const bytesRolar = await medir(page, cdp, rolar, fase);
  const bytesReload = await medir(page, cdp, recarregar, fase);

  await ctx.close();

  const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
  console.log(JSON.stringify({
    modo: sessao.mode,
    abrir_sem_rolar: kb(bytesAbrir),
    rolar_ate_o_fim: kb(bytesRolar),
    reload: kb(bytesReload),
    veredito_reload: sessao.mode === 'lease'
      ? (bytesReload < bytesAbrir * 0.1 ? 'OK — reload ≈ 0 (cache da origem própria)' : 'FALHA — reload ainda paga; investigar')
      : 'linha de base (legado) — reload deve re-pagar o pacote inteiro',
  }, null, 2));
}

run().catch((e) => { console.error(e); process.exit(1); });
