/**
 * PEDIDOS QUE FALHAM — o contrato de 2026-09-28, com o produtor REAL contra um
 * servidor local.
 *
 * Origem: no farmminerals dois `<script>` do Webflow com separador
 * percent-encoded são recusados pelo Chrome por ORB — NA PÁGINA VIVA TAMBÉM.
 * A captura só escutava `response`, então eles eram invisíveis: nada gravado,
 * nenhum descarte nomeado, e a referência ficava absoluta no HTML.
 *
 * Duas garantias, e a segunda é uma GUARDA DE REGRESSÃO. Uma primeira versão
 * gravava um arquivo VAZIO no caminho do recurso recusado; a auditoria derrubou
 * (um 200 vazio faz o script disparar `load` onde ao vivo dispara `error`, e um
 * documento de entrada recusado sairia como `index.html` de zero byte que
 * PASSA). Se alguém reintroduzir a neutralização, o teste 2 fica vermelho.
 */
import { createServer } from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// O servidor local vive em 127.0.0.1, que a guarda de SSRF recusa com razão.
// Mesma dobra dos outros testes de integração: resolve-se para um endereço
// público de mentira, e o que se exercita é o produtor, não a guarda.
vi.mock('node:dns/promises', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    default: { ...(actual.default || {}), lookup: async () => [{ address: '93.184.216.34', family: 4 }] },
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
  };
});

const { captureNativeBundle } = await import('./capture-bundle.js');

let server;
let origin;
const hits = { morto: 0 };

// O script é pedido DEPOIS do `load`: no markup ele seguraria o evento de load
// e terminaria antes da coleta (a lição do teste de hazards).
const SITE = `<!doctype html>
<html><head><meta charset="utf-8"><title>pedido que falha</title></head>
<body><h1>Uma página real cujo script tem o socket derrubado sem resposta alguma</h1>
<p>Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor.</p>
<script>addEventListener('load', function () {
  var s = document.createElement('script'); s.src = '/morto.js'; document.head.appendChild(s);
});</script>
</body></html>`;

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === '/morto.js') {
      hits.morto += 1;
      // Nenhuma resposta: o socket morre antes de qualquer byte de cabeçalho.
      // O navegador emite `requestfailed` e NUNCA `response` — é a forma local
      // da classe que o ORB produz no site real.
      res.socket.destroy();
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(SITE);
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  origin = `http://localhost:${server.address().port}`;   // literal de IP a guarda recusa direto; o NOME passa pelo DNS dublado
}, 30000);

afterAll(async () => { if (server) await new Promise((d) => server.close(d)); });

describe('pedidos que falham', () => {
  it('nomeia o recusado no relatório, e o separa de falha nossa', async () => {
    const r = await captureNativeBundle(`${origin}/`, { viewport: { width: 800, height: 600 } });
    const f = r.relatorio.pedidosQueFalharam;

    expect(hits.morto).toBeGreaterThan(0);          // o cenário EXERCITOU o caminho
    expect(f.total).toBeGreaterThan(0);

    // Nunca houve resposta -> recusa da rede/navegador, com NOME.
    const nomes = f.recusadosPelaRedeOuNavegador.amostra.map((x) => x.u);
    expect(nomes.some((u) => u.endsWith('/morto.js'))).toBe(true);
    expect(f.recusadosPelaRedeOuNavegador.amostra[0].erro).toBeTruthy();

    // E NÃO é classificado como falha nossa: a separação por `geracao` existe
    // porque o purge de entradas sem corpo roda antes e apagaria a evidência.
    expect(f.houveRespostaMasNaoEntrou.amostra.map((x) => x.u))
      .not.toContain(nomes.find((u) => u.endsWith('/morto.js')));
  }, 120000);

  it('NÃO fabrica arquivo vazio para o recusado (guarda de regressão)', async () => {
    const r = await captureNativeBundle(`${origin}/`, { viewport: { width: 800, height: 600 } });
    const morto = r.bundle.assets.filter((a) => a.path.endsWith('morto.js'));
    expect(morto).toEqual([]);
    // E nenhum asset de zero byte entrou no pacote por este caminho.
    expect(r.bundle.assets.filter((a) => a.body.byteLength === 0)).toEqual([]);
  }, 120000);
});
