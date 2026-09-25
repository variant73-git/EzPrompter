import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import nextConfig from './next.config.js';

// Guarda da CLASSE (achado ao vivo 2026-09-06): o `headers()` global aplica o
// CSP do APP (frame-ancestors 'self', X-Frame-Options SAMEORIGIN) a tudo que
// não estiver na exclusão. Uma rota que SERVE O RUNTIME e não está excluída
// tem o próprio CSP sobrescrito pelo Next → o app nunca emolda o iframe. Este
// teste deriva do filesystem quem serve o runtime (importa o core do gateway)
// e exige cada prefixo dentro da exclusão — esquecer uma rota nova falha aqui.

function routeFilesUnder(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...routeFilesUnder(full));
    else if (name === 'route.js') out.push(full);
  }
  return out;
}

function runtimeRoutePrefixes() {
  const apiDir = join(process.cwd(), 'app', 'api');
  return routeFilesUnder(apiDir)
    .filter((file) => readFileSync(file, 'utf8').includes('runtime-gateway-core.js'))
    .map((file) => {
      // app/api/rt/[sessionId]/[...path]/route.js -> api/rt (segmentos até o 1º dinâmico)
      const segments = relative(join(process.cwd(), 'app'), file).split('/');
      const fixed = [];
      for (const seg of segments) {
        if (seg === 'route.js' || seg.startsWith('[')) break;
        fixed.push(seg);
      }
      return fixed.join('/');
    });
}

describe('next.config headers(): every runtime-serving route is excluded from the app CSP', () => {
  it('finds the runtime routes on disk (sanity: at least legacy + lease)', () => {
    const prefixes = runtimeRoutePrefixes();
    expect(prefixes).toEqual(expect.arrayContaining(['api/runtime', 'api/rt', 'api/runtime-bootstrap']));
  });

  it('each runtime route prefix appears inside the negative-lookahead exclusion', async () => {
    const rules = await nextConfig.headers();
    const rule = rules.find((r) => Array.isArray(r.headers) && r.headers.some((h) => h.key === 'Content-Security-Policy'));
    expect(rule, 'a global CSP rule must exist').toBeTruthy();
    const lookahead = rule.source.match(/\(\?!(.*)\)\.\*\)/)?.[1] || '';
    for (const prefix of runtimeRoutePrefixes()) {
      expect(lookahead, `${prefix} must be excluded from the app CSP`).toContain(`${prefix}(?:/|$)`);
    }
  });
});
