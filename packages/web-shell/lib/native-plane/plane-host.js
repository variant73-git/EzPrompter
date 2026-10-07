// HOSPEDEIRO do plano visual nativo (opcao b): monta o nativo-em-modo-plano como camada IRMA da pagina,
// de OUTRA origem (outro processo — na mesma origem o nativo pesado travou a canonica, medido), manda um
// estado por quadro e espera o pronto com limite (sem pronto: a camada SAI). `back` = body isolado + z -1:
// entre o fundo da pagina e o conteudo. SEM aviso de desalinhamento (decisao do Adilson, 2026-10-06: "nao
// precisa avisar nada") — o detector media cada ancora a cada quadro e ninguem o escutava.
// Astra r1: (a) CADA carregamento da camada precisa anunciar pronto de novo — uma navegacao do nativo trocaria
// o plano transparente pela pagina inteira; sem novo anuncio no limite, a camada sai (motivo 'navegou').
export function montarPlano({ doc, src, origemPlano, colocacao = 'front', tempoLimiteMs = 15000 }) {
  const win = doc.defaultView; const estado = (win.__uPlano = { estado: 'montando', motivo: null });
  const f = doc.createElement('iframe');
  f.setAttribute('data-u-plano', ''); f.setAttribute('aria-hidden', 'true'); f.tabIndex = -1; f.src = src;
  f.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;border:0;margin:0;padding:0;background:transparent;pointer-events:none;' + (colocacao === 'back' ? 'z-index:-1' : 'z-index:2147483000');
  if (colocacao === 'back') doc.body.style.isolation = 'isolate';
  doc.body.appendChild(f);
  let seq = 0; let vivo = true; let carregamentos = 0; let espera = null; let resolverPrimeiro = null;
  const pronto = new Promise((ok) => { resolverPrimeiro = ok; });
  const fimDoPrimeiro = (r) => { if (resolverPrimeiro) { resolverPrimeiro(r); resolverPrimeiro = null; } };
  const desmontar = (motivo) => {
    vivo = false; win.removeEventListener('message', ouvir); if (espera) win.clearTimeout(espera);
    if (f.parentNode) f.parentNode.removeChild(f); if (colocacao === 'back') doc.body.style.isolation = '';
    if (motivo) { estado.estado = 'sem-plano'; estado.motivo = motivo; fimDoPrimeiro({ pronto: false, motivo }); }
  };
  const aguardar = (motivo) => { if (espera) win.clearTimeout(espera); espera = win.setTimeout(() => desmontar(motivo), tempoLimiteMs); };
  const assentarEPublicar = () => {
    const fontes = doc.fonts && doc.fonts.ready ? doc.fonts.ready : Promise.resolve();
    fontes.then(() => win.requestAnimationFrame(() => win.requestAnimationFrame(() => {
      if (!vivo) return;
      estado.estado = 'pronto'; estado.motivo = null; fimDoPrimeiro({ pronto: true });
    })));
  };
  function ouvir(e) {
    if (e.source !== f.contentWindow || e.origin !== origemPlano || !e.data || e.data.tipo !== 'u-plano-pronto') return;
    if (espera) { win.clearTimeout(espera); espera = null; }
    assentarEPublicar();
  }
  win.addEventListener('message', ouvir);
  f.addEventListener('load', () => {
    carregamentos += 1;
    if (carregamentos > 1 && vivo) { estado.estado = 'montando'; aguardar('navegou'); }
  });
  aguardar('tempo');
  const laco = () => {
    if (!vivo) return;
    try { f.contentWindow.postMessage({ tipo: 'u-plano-estado', seq: ++seq, y: win.scrollY }, origemPlano); } catch (e) { /* plano ainda carregando */ }
    win.requestAnimationFrame(laco);
  };
  win.requestAnimationFrame(laco);
  return { pronto, desmontar: () => desmontar(null) };
}

// fonte para injecao: le a configuracao de <script type="application/json" data-u-plano-config>
export function fonteDoHost() {
  return `(${montarPlano.toString()})(Object.assign({ doc: document }, JSON.parse(document.querySelector('script[data-u-plano-config]').textContent)));`;
}
