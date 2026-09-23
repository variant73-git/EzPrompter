import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Bug 2026-09-22: a mascara de "generating" (.cnode-gen-overlay) nao cobria o
// node inteiro — comecava em `top: calc(36px / --tbh)` para ficar abaixo da
// topbar, mas a topbar do node e' `display: none` (chrome virou float-tag).
// O offset deixava o header do site descoberto no topo. Deve cobrir de top: 0.
describe('.cnode-gen-overlay cobre o node inteiro (topbar escondida)', () => {
  const css = readFileSync(join(process.cwd(), 'app', 'globals.css'), 'utf8');
  const block = css.slice(css.indexOf('.cnode-gen-overlay {'), css.indexOf('}', css.indexOf('.cnode-gen-overlay {')));

  it('a topbar do node esta escondida (a premissa do fix)', () => {
    expect(css).toContain('.cnode-topbar { display: none !important; }');
  });

  it('o overlay comeca em top: 0 e NAO reintroduz o offset da topbar', () => {
    expect(block).toMatch(/top:\s*0\s*;/);
    expect(block).not.toMatch(/top:\s*calc\(36px/);
  });
});
