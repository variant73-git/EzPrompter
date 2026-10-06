// A trava de layout vive em DOIS lugares que nao compartilham codigo (o editor-core e um script solto; a
// ponte e uma funcao serializada para dentro do clone). A lista do que PODE na caixa travada, a do que prende
// a ancora fixa e os seletores tem que ser IGUAIS — senao um caminho recusa o que o outro deixa passar.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { getRuntimeBridgeSource } from '../motion-editor/runtime-bridge-source.js';

const editor = readFileSync(path.resolve(process.cwd(), '../editor-core/src/editor.js'), 'utf8');
const ponte = getRuntimeBridgeSource();
// a regex do que PODE na caixa travada, como texto (o transformador nao mexe em literal de regex)
const livres = (fonte) => (fonte.match(/PROPS_LIVRES_NA_TRAVA = (\/\^[^\n]*\$\/);/) || [])[1] || null;

describe('trava de layout: editor-core e ponte usam a MESMA regra', () => {
  it('mesma lista do que PODE na caixa travada', () => {
    expect(livres(editor)).not.toBeNull();
    expect(livres(ponte)).toBe(livres(editor));
  });
  it('mesma lista do que vira bloco de contencao da ancora', () => {
    const fixa = (fonte) => { const m = fonte.match(/PROPS_DE_CONTENCAO = new Set\(\[([\s\S]*?)\]\)/); return m ? [...m[1].matchAll(/['"]([a-z-]+)['"]/g)].map((x) => x[1]).sort() : null; };
    expect(fixa(editor)).toContain('transform');
    expect(fixa(ponte)).toEqual(fixa(editor));
  });
  it('mesmo seletor de quem prende o pai (a ancora fixa nao prende)', () => {
    // o transformador pode reescrever 'a"b' como "a\"b" — desfaz o escape antes de comparar
    const sel = (f) => ((f.match(/TRAVA_QUE_PRENDE_O_PAI = (['"])(.*?)\1;/) || [])[2] || '').replace(/\\"/g, '"');
    expect(sel(editor)).toBe('[data-u-trava="layout"],[data-u-trava="regiao"]');
    expect(sel(ponte)).toBe(sel(editor));
  });
  it('mesmo seletor da marca', () => {
    // o transformador do teste/build pode trocar o tipo de aspas da fonte serializada
    expect(editor).toMatch(/TRAVA_SEL = ['"]\[data-u-trava\]['"]/);
    expect(ponte).toMatch(/TRAVA_SEL = ['"]\[data-u-trava\]['"]/);
  });
});
