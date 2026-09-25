import { describe, it, expect } from 'vitest';
import { translateRuntimeOrigins, translateRuntimeOriginsInHtml, translateRuntimeOriginsInJson, origensDoBundle } from './translate-runtime-origins.js';

// Índice de verdade: o bundle tem estes arquivos, e nenhum outro.
const HOSTS = origensDoBundle([
  { path: '_ext/cdn.test/x.png' },
  { path: '_ext/cdn.test/f/1.png' },
  { path: '_ext/cdn.test/22222.png' },
  { path: '_ext/cdn.test/3.png' },
  { path: '_ext/cdn.test/1.png' },
  { path: '_ext/cdn.test/2.png' },
]);
const BASE = '/api/runtime/tok';
const t = (js, hosts = HOSTS) => translateRuntimeOrigins(js, { hosts, runtimeBase: BASE });

describe('origens do bundle', () => {
  it('le os hosts do indice de assets', () => {
    const hosts = origensDoBundle([
      { path: '_ext/cdn.test/a.png' }, { path: '_ext/CDN.TEST/b.png' },
      { path: '_ext/outro.test/c.png' }, { path: 'index.html' },
    ]);
    expect([...hosts].sort()).toEqual(['cdn.test', 'outro.test']);
  });
});

describe('traduzir a origem que o site monta em runtime', () => {
  // O caso real: o JS guarda a base e concatena o nome do frame depois.
  it('traduz a base guardada numa variavel', () => {
    const r = t('var base = "https://cdn.test/f/"; img.src = base + n + ".avif";');
    expect(r.texto).toContain('"/api/runtime/tok/_ext/cdn.test/f/"');
    expect(r.traduzidas).toBe(1);
  });

  it('traduz URL inteira e protocolo-relativa', () => {
    expect(t('a("https://cdn.test/x.png")').texto).toContain('"/api/runtime/tok/_ext/cdn.test/x.png"');
    expect(t("a('//cdn.test/x.png')").texto).toContain("'/api/runtime/tok/_ext/cdn.test/x.png'");
  });

  // ⚠️ So' origem que o bundle CONTEM. Uma nao capturada continua externa: um
  // pedido bloqueado aparece; um caminho local que devolve 404 some calado.
  it('nao traduz origem que o bundle nao tem', () => {
    const js = 'a("https://outro.test/x.png")';
    expect(t(js).texto).toBe(js);
    expect(t(js).traduzidas).toBe(0);
  });

  // A origem tem que comecar no PRIMEIRO caractere do valor.
  it('nao traduz URL no meio de uma frase', () => {
    const js = 'msg("acesse https://cdn.test/x.png para ver")';
    expect(t(js).texto).toBe(js);
  });

  it('nao toca em comentario nem em expressao regular', () => {
    const js = '// https://cdn.test/a.png\nvar re = /https:\\/\\/cdn.test\\/b.png/;';
    expect(t(js).texto).toBe(js);
  });

  it('nao toca em template literal', () => {
    const js = 'var u = `https://cdn.test/${n}.png`;';
    expect(t(js).texto).toBe(js);
  });

  // Leitura insegura = arquivo INTOCADO. Corromper o script que faz o site se
  // mexer e' pior que deixar um pedido bloqueado.
  it('deixa o arquivo intocado quando o parse falha, e DIZ', () => {
    const js = 'var u = "https://cdn.test/x.png"; function {{{';
    const r = t(js);
    expect(r.texto).toBe(js);
    expect(r.completo).toBe(false);
    expect(r.motivo).toMatch(/^parse_falhou/);
    expect(r.traduzidas).toBe(0);
  });

  // ⭐ So' o host nao basta: traduzir um caminho que o bundle NAO tem
  // transforma um pedido externo explicito num 404 local (Sol).
  it('nao traduz caminho que o bundle nao contem', () => {
    const js = 'a("https://cdn.test/inexistente.png")';
    expect(t(js).texto).toBe(js);
    expect(t(js).traduzidas).toBe(0);
  });

  // A BASE nao tem sufixo para conferir — o gateway confere o caminho resolvido.
  it('traduz a base, que e o caso da sequencia de frames', () => {
    expect(t('var b = "https://cdn.test/f/";').traduzidas).toBe(1);
    expect(t('var b = "https://cdn.test";').traduzidas).toBe(1);
  });

  // ⭐ A chave sai da MESMA funcao que a captura usa para nomear o arquivo.
  // Derivar por conta propria era erro medido: a captura saneia o nome (espaco
  // e parentese viram `_`), entao `field%20img%20(1).avif` vira
  // `field_20img_20_1_.avif` — o arquivo existia e a traducao dizia que nao.
  it('acha o arquivo mesmo com nome saneado pela captura', () => {
    const idx = origensDoBundle([{ path: '_ext/cdn.test/field_20img_20_1_.avif' }]);
    const r = translateRuntimeOrigins('a("https://cdn.test/field%20img%20(1).avif")', { hosts: idx, runtimeBase: BASE });
    expect(r.traduzidas).toBe(1);
    expect(r.texto).toContain('/_ext/cdn.test/field%20img%20(1).avif');
  });

  // A query faz parte da identidade do recurso e a captura a embute no nome —
  // ignora-la faria duas versoes colidirem.
  it('a query participa da chave, como no indice', () => {
    const idx = origensDoBundle([{ path: '_ext/cdn.test/x.png' }]);
    expect(translateRuntimeOrigins('a("https://cdn.test/x.png")', { hosts: idx, runtimeBase: BASE }).traduzidas).toBe(1);
    // com query, a captura nomeia diferente — sem esse arquivo, nao traduz
    expect(translateRuntimeOrigins('a("https://cdn.test/x.png?v=2")', { hosts: idx, runtimeBase: BASE }).traduzidas).toBe(0);
  });

  it('traduz varias no mesmo arquivo sem embaralhar os offsets', () => {
    const r = t('a("https://cdn.test/1.png"); b("https://cdn.test/22222.png"); c("https://cdn.test/3.png");');
    expect(r.traduzidas).toBe(3);
    expect(r.texto).toContain('/_ext/cdn.test/1.png');
    expect(r.texto).toContain('/_ext/cdn.test/22222.png');
    expect(r.texto).toContain('/_ext/cdn.test/3.png');
  });

  it('sem hosts no bundle, nao faz nada', () => {
    const js = 'a("https://cdn.test/x.png")';
    expect(translateRuntimeOrigins(js, { hosts: new Set(), runtimeBase: BASE }).texto).toBe(js);
  });

  it('exige base de runtime', () => {
    expect(() => translateRuntimeOrigins('x', { hosts: HOSTS })).toThrow(/runtime base/);
  });
});

describe('dentro dos script inline de um html', () => {
  const t = (html) => translateRuntimeOriginsInHtml(html, { hosts: HOSTS, runtimeBase: BASE });

  // O caso real: o DOM tem 4 atributos ao CDN e o documento tem 164 ocorrencias
  // — o resto vive em script embutido que monta a sequencia de frames.
  it('traduz a origem dentro do corpo do script', () => {
    const r = t('<html><body><script>var b="https://cdn.test/f/";</script></body></html>');
    expect(r.texto).toContain('"/api/runtime/tok/_ext/cdn.test/f/"');
    expect(r.traduzidas).toBe(1);
    expect(r.blocos).toBe(1);
  });

  it('nao toca em script com src, nem em bloco de dados', () => {
    const comSrc = '<script src="a.js"></script>';
    expect(t(comSrc).texto).toBe(comSrc);
    const jsonLd = '<script type="application/ld+json">{"u":"https://cdn.test/x.png"}</script>';
    expect(t(jsonLd).texto).toBe(jsonLd);
    expect(t(jsonLd).blocos).toBe(0);
  });

  it('nao toca no HTML fora dos scripts', () => {
    const html = '<img src="https://cdn.test/x.png"><script>var a=1;</script>';
    expect(t(html).texto).toContain('<img src="https://cdn.test/x.png">');
  });

  // Um bloco inseguro fica intocado e CONTA — o resto do documento segue.
  it('bloco inseguro fica intocado e e contado', () => {
    const html = '<script>var u="https://cdn.test/1.png"; function {{{</script>'
      + '<script>var v="https://cdn.test/2.png";</script>';
    const r = t(html);
    expect(r.incompletos).toBe(1);
    expect(r.traduzidas).toBe(1);
    expect(r.texto).toContain('"https://cdn.test/1.png"');
    expect(r.texto).toContain('/_ext/cdn.test/2.png');
  });

  it('module conta como javascript', () => {
    const r = t('<script type="module">var b="https://cdn.test/f/";</script>');
    expect(r.traduzidas).toBe(1);
  });
});

// Numa string de substituicao o cifrao tem significado (`$&`, `$'`): um script
// traduzido que contenha isso sairia corrompido, sem erro, so' quebrado.
it('nao deixa o cifrao virar padrao de substituicao', () => {
  const html = `<script>var a="https://cdn.test/x.png"; var b="preco: $' e $& e $\`";</script>`;
  const r = translateRuntimeOriginsInHtml(html, { hosts: HOSTS, runtimeBase: BASE });
  expect(r.texto).toContain(`var b="preco: $' e $& e $\``);
  expect(r.texto).toContain('/_ext/cdn.test/x.png');
});

// ⚠️ Um `<script>` dentro de `<textarea>` e' TEXTO para o navegador; uma regex
// o trataria como codigo. E um `>` dentro de atributo com aspas encerra o
// casamento cedo demais, deslocando os limites do corpo (Sol).
describe('o HTML e lido por tokenizer, nao por expressao regular', () => {
  const t = (html) => translateRuntimeOriginsInHtml(html, { hosts: HOSTS, runtimeBase: BASE });

  it('nao toca em script dentro de textarea', () => {
    const html = '<textarea><script>var u="https://cdn.test/x.png"</script></textarea>';
    const r = t(html);
    expect(r.texto).toBe(html);
    expect(r.blocos).toBe(0);
  });

  it('atravessa atributo com > dentro de aspas', () => {
    const html = '<script data-nota="a > b">var u="https://cdn.test/x.png";</script>';
    const r = t(html);
    expect(r.blocos).toBe(1);
    expect(r.texto).toContain('data-nota="a > b"');
    expect(r.texto).toContain('/_ext/cdn.test/x.png');
  });

  it('nao toca em noscript', () => {
    const html = '<noscript><script>var u="https://cdn.test/x.png"</script></noscript>';
    expect(t(html).blocos).toBe(0);
  });
});

// So' o HOST e' insensivel a maiusculas. Caminho de URL nao e': baixar
// `foo.png` nao autoriza `FOO.png`, e traduzir assim mandaria o gateway
// procurar um arquivo inexistente — 404 local no lugar de um pedido externo
// honesto (Sol).
describe('a conferencia de caminho respeita maiusculas', () => {
  const idx = origensDoBundle([{ path: '_ext/cdn.test/Foo.png' }]);
  const t = (js) => translateRuntimeOrigins(js, { hosts: idx, runtimeBase: BASE });

  it('traduz com a capitalizacao exata', () => {
    expect(t('a("https://cdn.test/Foo.png")').traduzidas).toBe(1);
  });

  it('NAO traduz com capitalizacao diferente', () => {
    expect(t('a("https://cdn.test/foo.png")').traduzidas).toBe(0);
    expect(t('a("https://cdn.test/FOO.PNG")').traduzidas).toBe(0);
  });

  it('mas o host segue insensivel', () => {
    expect(t('a("https://CDN.TEST/Foo.png")').traduzidas).toBe(1);
  });
});

// Lottie e manifestos de midia guardam URL absoluta e o codigo do site as usa
// direto. Medido: um SVG que EXISTE no bundle continuava sendo pedido ao CDN
// porque vinha de um Lottie, e JSON nao passava por traducao nenhuma.
describe('dentro de um json', () => {
  const idx = origensDoBundle([{ path: '_ext/cdn.test/logo_20icon.svg' }, { path: '_ext/cdn.test/f/1.png' }]);
  const t = (json) => translateRuntimeOriginsInJson(json, { hosts: idx, runtimeBase: BASE });

  it('traduz url aninhada em objeto e em lista', () => {
    const r = t(JSON.stringify({ assets: [{ u: 'https://cdn.test/logo%20icon.svg' }], base: 'https://cdn.test/f/' }));
    expect(r.traduzidas).toBe(2);
    expect(r.texto).toContain('/api/runtime/tok/_ext/cdn.test/logo%20icon.svg');
    expect(r.texto).toContain('/api/runtime/tok/_ext/cdn.test/f/');
  });

  it('nao traduz caminho que o bundle nao tem', () => {
    const json = JSON.stringify({ u: 'https://cdn.test/inexistente.png' });
    expect(t(json).texto).toBe(json);
  });

  it('json invalido fica INTOCADO e DIZ', () => {
    const r = t('{ isto nao e json');
    expect(r.texto).toBe('{ isto nao e json');
    expect(r.completo).toBe(false);
    expect(r.motivo).toBe('json_invalido');
  });

  // Sem nada para traduzir, devolve o texto ORIGINAL — reserializar mudaria os
  // bytes de todo JSON do bundle sem motivo.
  it('sem traducao, nao reserializa', () => {
    const json = '{\n  "a": 1\n}';
    expect(t(json).texto).toBe(json);
  });
});
