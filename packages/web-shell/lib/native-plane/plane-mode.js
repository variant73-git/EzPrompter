// MODO PLANO (opcao b, 2026-10-05): o clone NATIVO servido como camada visual — so os canvas aparecem,
// a pagina fica transparente, e quem manda na rolagem e o pai. Derivado na ENTREGA: o pacote nativo
// nunca e alterado. Protocolo: u-plano-estado (pai -> plano), u-plano-pronto / u-plano-rolou (plano -> pai).
import { leadingDoctypeEnd } from '../native-clone/doctype-anchor.js';

// ASSINATURA do canvas: caminho ate o <body> (tag + classes + posicao entre irmaos de mesma tag; para no 1o id).
// Estavel entre cargas, ao contrario do indice global na ordem do documento (Astra: canvas criado ANTES do
// excluido deslocava o indice e escondia o errado). A mesma funcao roda na normalizacao e no modo plano.
export function assinaturaDoCanvas(el) {
  const partes = [];
  for (let e = el; e && e.nodeType === 1 && e !== document.body && e !== document.documentElement; e = e.parentElement) {
    const tag = e.tagName.toLowerCase();
    if (e.id) { partes.unshift(`${tag}#${e.id}`); break; }
    const cls = typeof e.className === 'string' ? e.className.trim().split(/\s+/).filter(Boolean).sort().slice(0, 3) : [];
    let k = 1; for (let s = e.previousElementSibling; s; s = s.previousElementSibling) if (s.tagName === e.tagName) k += 1;
    partes.unshift(`${tag}${cls.map((c) => `.${c}`).join('')}:${k}`);
  }
  return partes.join(' > ');
}

export function bootstrapDoPlano({ excluirCanvas = [] } = {}) {
  const fora = JSON.stringify((excluirCanvas || []).filter((x) => typeof x === 'string' && x));
  const css = 'html,body{background:transparent!important}body *{visibility:hidden!important}canvas{visibility:visible!important}canvas[data-u-plano-fora]{visibility:hidden!important}';
  const js = `(function(){
  var FORA = ${fora};
  var assinatura = ${assinaturaDoCanvas.toString()};
  // a assinatura so ENCONTRA o canvas; encontrado, ele fica PRESO a exclusao pela identidade enquanto estiver
  // na pagina — um canvas inserido antes, no mesmo pai, deslocaria a assinatura e roubaria a vaga (Astra r2)
  // LIMITE CONHECIDO (Astra r3): uma assinatura por posicao nao distingue historias de criacao — um canvas
  // igual criado ANTES do alvo, apos o load, pode ocupar a vaga. Mitigacao: antes do load (pagina se montando)
  // a marca segue so a assinatura, sem prender; a vaga so se prende no load. Identificador estavel vindo da
  // captura fecharia de vez.
  var presos = {}; var ligado = false;
  var preso = function (el) { for (var k in presos) if (presos[k] === el) return true; return false; };
  var marcar = function () {
    var cs = document.getElementsByTagName('canvas'), i, a;
    if (!ligado) { for (i = 0; i < cs.length; i++) { if (FORA.indexOf(assinatura(cs[i])) >= 0) cs[i].setAttribute('data-u-plano-fora', ''); else cs[i].removeAttribute('data-u-plano-fora'); } return; }
    for (a in presos) if (presos[a] && !presos[a].isConnected) presos[a] = null;
    for (i = 0; i < cs.length; i++) { a = assinatura(cs[i]); if (FORA.indexOf(a) >= 0 && !presos[a] && !preso(cs[i])) presos[a] = cs[i]; }
    for (i = 0; i < cs.length; i++) { if (preso(cs[i])) cs[i].setAttribute('data-u-plano-fora', ''); else cs[i].removeAttribute('data-u-plano-fora'); }
  };
  var reafirmar = function () { var s = document.querySelector('style[data-u-plano]'); if (s && s.parentNode) s.parentNode.appendChild(s); marcar(); };
  document.addEventListener('DOMContentLoaded', reafirmar); addEventListener('load', function () { ligado = true; reafirmar(); });
  // canvas criado DEPOIS (cena montada pelo codigo do site): marca de novo — o dono pode ser outro
  var pendente = false;
  try { new MutationObserver(function () { if (pendente) return; pendente = true; requestAnimationFrame(function () { pendente = false; marcar(); }); }).observe(document.documentElement, { childList: true, subtree: true }); } catch (e) { /* sem observador: fica o load */ }
  var ultimo = -1;
  addEventListener('message', function (e) {
    if (e.source !== window.parent || !e.data || e.data.tipo !== 'u-plano-estado') return;
    var seq = Number(e.data.seq), y = Number(e.data.y); if (!(seq > ultimo) || !isFinite(y)) return; ultimo = seq;
    if (Math.abs(scrollY - y) > 0.5) window.scrollTo({ top: y, behavior: 'instant' });
    window.parent.postMessage({ tipo: 'u-plano-rolou', seq: seq, y: scrollY }, '*');
  });
  var anunciou = false;
  var anunciar = function () { if (anunciou) return; anunciou = true; reafirmar();
    var vis = 0, cs = document.getElementsByTagName('canvas'); for (var i = 0; i < cs.length; i++) { if (!cs[i].hasAttribute('data-u-plano-fora') && cs[i].getBoundingClientRect().width > 0) vis++; }
    window.parent.postMessage({ tipo: 'u-plano-pronto', canvas: vis }, '*'); };
  addEventListener('load', function () { var f = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
    f.then(function () { requestAnimationFrame(function () { requestAnimationFrame(anunciar); }); }); });
})();`;
  return `<style data-u-plano>${css}</style><script data-u-plano>${js.replace(/<\/script/gi, '<\\/script')}</script>`;
}

export function injetarModoPlano(html, opcoes = {}) {
  const h = String(html);
  if (h.includes('data-u-plano')) return h;
  const at = leadingDoctypeEnd(h);
  return `${h.slice(0, at)}${bootstrapDoPlano(opcoes)}${h.slice(at)}`;
}
