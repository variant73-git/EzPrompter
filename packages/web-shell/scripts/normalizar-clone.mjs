#!/usr/bin/env node
// NORMALIZADOR DO CLONE CANÔNICO (esquema, regra 7 revista em 2026-10-02 — decisão do Adilson).
//
// Estrutura canônica = o ESQUELETO DO SITE, normalizado de forma determinística, sem agente:
//   - a árvore vem da captura nativa VIVA (depois de rolar a página inteira), sem nenhum código
//     do site (scripts, folhas de estilo, estilos inline e classes saem);
//   - o CSS é NOSSO, gerado do estilo CALCULADO de cada elemento: um bloco por `#id`, sem
//     cascata, sem `!important`; propriedades herdáveis só quando diferem do pai, as outras só
//     quando diferem do padrão da tag; largura/altura só quando o SITE as definiu (o tamanho
//     muda se virar `auto`); `::before`/`::after` viram regras próprias;
//   - opacidade, transformação, recorte e filtro entram no estado CALCULADO no topo da página
//     (translate(-50%) de centralizar é layout); o gravador de movimento mede a diferença dali;
//   - o CSS do site sai inteiro, então animações/transições de CSS somem (um motor só);
//   - embrulhos que não desenham nada e não mudam o layout são desfeitos; texto dividido em
//     partes volta a ser texto simples; cada parte visível ganha id DESCRITIVO e as peças de
//     conteúdo levam `data-u-conteudo` (a mesma chave do inventário).
// v0: layout reproduzido na largura de 1440 px; tablet/celular são etapa seguinte.
// Uso: node scripts/normalizar-clone.mjs --captura <assets-nativa> --saida <pasta-assets-canonica>
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { servir } from './inventario-conteudo.mjs';
import { medirProprio, difere, fichasPorLeitura, PROPS_INLINE, preencherCss } from './gravar-trajetoria.mjs';
import { extrairRegistro, resolverNaPagina, fichasDoIx3 } from './ler-ix3.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };

async function coletarDoExtrator() {
  const src = await readFile(new URL('./inventario-conteudo.mjs', import.meta.url), 'utf8');
  const i = src.indexOf('function coletar(origem) {'); const j = src.indexOf('\nexport async function inventariar');
  let corpo = src.slice(i, j);
  corpo = corpo.replace(/chave: chave\('([a-z])'\)/g, "chave: window.__marca(el, chave('$1'))");
  corpo = corpo.replace(/chave: `l-\$\{String\(out\.lotties\.length \+ 1\)\.padStart\(4, '0'\)\}`/g, "chave: window.__marca(el, `l-${String(out.lotties.length + 1).padStart(4, '0')}`)");
  return corpo;
}

// Roda NO NAVEGADOR. Devolve { html, css, fontes, arquivos, relatorio }.
export function normalizar() {
  const HERDAVEIS = new Set(['color', 'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing', 'text-align', 'text-transform', 'white-space', 'word-break', 'list-style-type', 'cursor', 'visibility', 'text-indent', 'word-spacing']);
  const PROPS = ['display', 'position', 'top', 'right', 'bottom', 'left', 'z-index', 'float', 'clear', 'box-sizing',
    'min-width', 'max-width', 'min-height', 'max-height',
    'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width', 'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style',
    'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
    'border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius',
    'background-color', 'background-image', 'background-size', 'background-position', 'background-repeat', 'background-clip', 'background-attachment',
    'box-shadow', 'outline-style', 'outline-width', 'outline-color', 'overflow-x', 'overflow-y',
    'flex-direction', 'flex-wrap', 'justify-content', 'align-items', 'align-content', 'align-self', 'justify-self', 'justify-items',
    'flex-grow', 'flex-shrink', 'flex-basis', 'order', 'row-gap', 'column-gap',
    'grid-template-columns', 'grid-template-rows', 'grid-column-start', 'grid-column-end', 'grid-row-start', 'grid-row-end', 'grid-auto-flow', 'grid-auto-columns', 'grid-auto-rows',
    'object-fit', 'object-position', 'aspect-ratio', 'vertical-align', 'mix-blend-mode', 'isolation', 'pointer-events', 'user-select',
    'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing', 'text-align', 'text-transform', 'text-decoration-line', 'text-decoration-color',
    'text-indent', 'word-spacing', 'white-space', 'word-break', 'color', 'list-style-type', 'cursor', 'content', 'transform', 'transform-origin', 'opacity', 'clip-path', 'filter', 'visibility', 'translate', 'rotate', 'scale', 'backdrop-filter', 'text-overflow', '-webkit-text-fill-color', '-webkit-background-clip'];
  const PULAR = /^(SCRIPT|NOSCRIPT|STYLE|LINK|TEMPLATE|META|BASE|IFRAME)$/;
  const MIDIA = /^(IMG|VIDEO|CANVAS|PICTURE|SOURCE|svg)$/i;
  // padrao de cada tag, num documento limpo
  const ifr = document.createElement('iframe'); ifr.style.cssText = 'position:absolute;width:0;height:0;border:0;visibility:hidden'; document.body.appendChild(ifr);
  const ddoc = ifr.contentDocument; ddoc.open(); ddoc.write('<!doctype html><html><head></head><body></body></html>'); ddoc.close();
  const padroes = {};
  const padraoDe = (tag) => { if (padroes[tag]) return padroes[tag]; const e = ddoc.createElement(tag); ddoc.body.appendChild(e); const cs = getComputedStyle(e); const o = {}; for (const p of PROPS) o[p] = cs.getPropertyValue(p); e.remove(); padroes[tag] = o; return o; };
  const rel = { elementos: 0, embrulhosDesfeitos: 0, textosJuntados: 0, pseudo: 0, tamanhosDoSite: 0, animacoesDeCssRetiradas: 0, transicoesRetiradas: 0 };
  const visual = (cs) => (cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent') || cs.backgroundImage !== 'none' || parseFloat(cs.borderTopWidth) || parseFloat(cs.borderRightWidth) || parseFloat(cs.borderBottomWidth) || parseFloat(cs.borderLeftWidth) || cs.boxShadow !== 'none' || parseFloat(cs.borderTopLeftRadius) || cs.outlineStyle !== 'none';
  const caixaZero = (cs) => ['margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left'].every((p) => parseFloat(cs.getPropertyValue(p)) === 0);
  const textoDireto = (el) => Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim());
  const ehParteCurta = (c) => (c.tagName === 'SPAN' || (c.tagName === 'DIV' && /inline/.test(getComputedStyle(c).display))) && c.textContent.trim().length <= 24 && !c.querySelector('img,svg,video');
  // texto DIVIDIDO por SplitText (GSAP / IX3 do Webflow / script do site): as partes vem com
  // aria-hidden e o texto inteiro fica em aria-label no elemento. Pega LINHAS (blocos, de qualquer
  // tamanho) e letras aninhadas em div, que a regra das partes curtas inline nao via (revisao Claude #5:
  // as linhas ficavam congeladas na canonica e o tocador animava o titulo inteiro).
  const normT = (t) => (t || '').replace(/[ \t\n\r\f\u00a0]+/g, ' ').trim();
  // assinatura do DIVISOR (r3 #2): o SplitText poe `position:relative; display:block|inline-block`
  // INLINE em toda parte (e a mascara e copia de uma parte). Um rotulo acessivel com um span escondido
  // comum (botao, CTA — r2 #6) nao tem isso; uma linha unica dividida (mascara + linha) tem.
  const parteDoDivisor = (d) => d.style.position === 'relative' && /^(block|inline-block)$/.test(d.style.display);
  const divididoAria = (el) => el.children.length > 0 && el.hasAttribute('aria-label') && !textoDireto(el)
    && Array.from(el.querySelectorAll('*')).every(parteDoDivisor)
    && Array.from(el.querySelectorAll('*')).every((d) => d.getAttribute('aria-hidden') === 'true' && /^(SPAN|DIV)$/.test(d.tagName))
    && normT(el.textContent) && normT(el.textContent).replace(/ /g, '') === normT(el.getAttribute('aria-label')).replace(/ /g, '');
  // regra antiga (partes curtas inline): exige >= 2 partes — um <a> com UM span estilizado (botao) nao
  // e texto dividido, e achata-lo perdia o span e o estilo dele
  const dividido = (el) => divididoAria(el) || (el.children.length >= 2 && !textoDireto(el) && Array.from(el.children).every(ehParteCurta) && el.textContent.trim());
  // embrulho desfazivel: nao desenha, nao tem caixa, bloco simples com UM filho bloco do mesmo tamanho
  const desfazivel = (el) => {
    if (el === document.body || el.hasAttribute('data-u-chave') || el.children.length !== 1 || textoDireto(el)) return false;
    if (!/^(DIV|SPAN)$/.test(el.tagName)) return false;
    const cs = getComputedStyle(el); const f = el.children[0]; const fcs = getComputedStyle(f);
    if (visual(cs) || !caixaZero(cs) || cs.position !== 'static' || cs.display !== 'block' || cs.overflowX !== 'visible' || cs.overflowY !== 'visible') return false;
    // estado VISUAL ou de MOVIMENTO no proprio invólucro (revisao Claude #3): opacidade, transformacao,
    // filtro, recorte, mistura, ou estilo inline (o motor do site escreve em style="" — e alvo dele)
    if (cs.opacity !== '1' || cs.transform !== 'none' || cs.filter !== 'none' || cs.clipPath !== 'none' || cs.mixBlendMode !== 'normal' || (el.getAttribute('style') || '').trim()) return false;
    // r2 #3: transformacoes separadas (translate/rotate/scale — Tailwind v4), vidro, visibilidade
    // propria, e QUALQUER invólucro que se mexeu na gravacao (classe + transition nao deixa rastro inline)
    if ((cs.translate && cs.translate !== 'none') || (cs.rotate && cs.rotate !== 'none') || (cs.scale && cs.scale !== 'none') || (cs.backdropFilter && cs.backdropFilter !== 'none')) return false;
    if (el.parentElement && cs.visibility !== getComputedStyle(el.parentElement).visibility) return false;
    if (window.__uMoveis && window.__uMoveis.has(el.getAttribute('data-u-rec'))) return false;
    if (fcs.display !== 'block' || fcs.position === 'absolute' || fcs.position === 'fixed') return false;
    // o filho herda o CONTEXTO do invólucro: num pai flex/grid ele vira item e passa a se encolher
    // pelo conteudo (medido: titulo de 566 px num invólucro desfeito virou 842 px numa linha so)
    const pai = el.parentElement; if (!pai || !/^(block|flow-root)$/.test(getComputedStyle(pai).display)) return false;
    const a = el.getBoundingClientRect(); const b = f.getBoundingClientRect();
    if (!(Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5 && Math.abs(a.top - b.top) < 0.5)) return false;
    // e o tamanho do invólucro nao pode ser imposto pelo site (largura/altura que mudariam com auto)
    for (const [p, dim] of [['width', 'width'], ['height', 'height']]) {
      const prev = el.style.getPropertyValue(p); const prio = el.style.getPropertyPriority(p);
      el.style.setProperty(p, 'auto', 'important'); const depois = el.getBoundingClientRect()[dim];
      if (prev) el.style.setProperty(p, prev, prio); else el.style.removeProperty(p);
      if (Math.abs(a[dim] - depois) > 0.5) return false;
    }
    return true;
  };
  const usados = new Set();
  const slug = (t) => (t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').split('-').filter((w) => w.length > 1).slice(0, 3).join('-');
  const secoes = Array.from(document.querySelectorAll('section, header, footer, nav')).filter((e) => !e.parentElement.closest('section, header, footer, nav'));
  const idPara = (el) => {
    const si = secoes.findIndex((s) => s === el || s.contains(el)); const sec = si >= 0 ? `s${si}` : 'pg';
    const tag = el.tagName.toLowerCase();
    let nome = '';
    if (el.tagName === 'IMG') nome = slug(el.alt) || slug((el.getAttribute('src') || '').split('/').pop().replace(/\.[a-z0-9]+$/i, '').replace(/^[0-9a-f]{20,}_/, '')) || 'imagem';
    else if (el.tagName === 'VIDEO') nome = 'video';
    else if (textoDireto(el) || dividido(el)) nome = slug(el.textContent) || 'texto';
    else nome = ({ section: 'secao', header: 'cabecalho', footer: 'rodape', nav: 'menu', a: 'link', button: 'botao', ul: 'lista', li: 'item', svg: 'icone', canvas: 'canvas', form: 'formulario' })[tag] || 'bloco';
    let base = `u-${sec}-${tag}-${nome}`.replace(/-+/g, '-'); let id = base; let n = 2;
    while (usados.has(id)) id = `${base}-${n++}`;
    usados.add(id); return id;
  };
  const regras = [];
  const declaracoes = (el, cs, pai, { esvaziado = false } = {}) => {
    const pad = padraoDe(el.tagName.toLowerCase()); const pcs = pai ? getComputedStyle(pai) : null; const out = [];
    for (const p of PROPS) {
      let v = cs.getPropertyValue(p);
      if (p === 'content') continue;
      if (HERDAVEIS.has(p)) { if (pcs && pcs.getPropertyValue(p) === v) continue; if (!pcs && pad[p] === v) continue; }
      else if (pad[p] === v) continue;
      if (p === 'background-image' && v !== 'none') v = v.replace(/url\("?(.*?)"?\)/g, (m, u) => { try { const x = new URL(u, location.href); return x.origin === location.origin ? `url("${decodeURI(x.pathname).replace(/^\//, '')}")` : m; } catch { return m; } });
      out.push(`${p}:${v}`);
    }
    // tamanho DEFINIDO pelo site: so entra se mudaria com auto. Conteiner que sai VAZIO (Lottie)
    // leva o tamanho sempre: o auto dele era o do desenho que ficou para tras, e vazio o tocador
    // desenharia no tamanho padrao da Lottie (medido: o icone de 12 px do menu virou 300 px).
    // Elemento SUBSTITUIDO (img/video/canvas/svg...) tambem: o auto dele e o tamanho NATURAL do
    // recurso, que muda com a variante que o navegador escolhe do srcset (medido: a imagem do CTA
    // tinha 1440 px no site, contida por max-width:100%, e 1200 px na canonica com outra variante).
    if (esvaziado || /^(IMG|VIDEO|CANVAS|SVG|IFRAME|OBJECT|EMBED|PICTURE)$/i.test(el.tagName)) { out.push(`width:${cs.width}`, `height:${cs.height}`); rel.tamanhosDoSite += 2; }
    else for (const [p, dim] of [['width', 'width'], ['height', 'height']]) {
      const antes = el.getBoundingClientRect()[dim]; const prev = el.style.getPropertyValue(p); const prio = el.style.getPropertyPriority(p);
      el.style.setProperty(p, 'auto', 'important'); const depois = el.getBoundingClientRect()[dim];
      if (prev) el.style.setProperty(p, prev, prio); else el.style.removeProperty(p);
      if (Math.abs(antes - depois) > 0.5) { out.push(`${p}:${cs.getPropertyValue(p)}`); rel.tamanhosDoSite += 1; }
    }
    if (cs.animationName && cs.animationName !== 'none') rel.animacoesDeCssRetiradas += 1;
    if (cs.transitionDuration && cs.transitionDuration.split(',').some((d) => parseFloat(d) > 0)) rel.transicoesRetiradas += 1;
    return out;
  };
  const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const escA = (t) => String(t).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  const ATTRS = new Set(['src', 'srcset', 'sizes', 'alt', 'href', 'poster', 'muted', 'loop', 'autoplay', 'playsinline', 'preload', 'controls', 'data-src', 'aria-label', 'role', 'type', 'width', 'height', 'target', 'rel', 'name', 'value', 'placeholder', 'for', 'title', 'colspan', 'rowspan', 'datetime', 'lang', 'dir', 'tabindex']);
  const arquivos = new Set();
  const local = (u) => { try { const x = new URL(u, location.href); if (x.origin !== location.origin) return u; const p = decodeURI(x.pathname).replace(/^\//, ''); arquivos.add(p); return p.split('/').map(encodeURIComponent).join('/'); } catch { return u; } };
  const serializar = (el, pai, profundidade) => {
    if (PULAR.test(el.tagName)) return '';
    if (el === ifr) return '';
    const cs = getComputedStyle(el);
    if (cs.display === 'none' && !el.hasAttribute('data-u-chave')) return '';
    // SVG: copiado inteiro (desenho), com id proprio
    if (el.tagName.toLowerCase() === 'svg') {
      const id = idPara(el); el.setAttribute('data-u-id', id); const clone = el.cloneNode(true); clone.removeAttribute('class'); clone.removeAttribute('style'); clone.removeAttribute('data-u-id'); clone.removeAttribute('data-u-rec'); clone.querySelectorAll('[data-u-rec]').forEach((x) => x.removeAttribute('data-u-rec'));
      clone.querySelectorAll('script').forEach((s) => s.remove());
      const d = declaracoes(el, cs, pai); regras.push(`#${id}{${d.join(';')}}`); rel.elementos += 1;
      return clone.outerHTML.replace(/^<svg/, `<svg id="${id}"`);
    }
    if (desfazivel(el)) { rel.embrulhosDesfeitos += 1; return serializar(el.children[0], pai, profundidade); }
    const id = idPara(el); rel.elementos += 1; el.setAttribute('data-u-id', id);
    const tag = el.tagName.toLowerCase();
    let at = ` id="${id}"`;
    for (const a of Array.from(el.attributes)) {
      if (!ATTRS.has(a.name)) continue;
      let v = a.value;
      if (['src', 'href', 'poster', 'data-src'].includes(a.name) && v && !v.startsWith('#') && !/^(mailto|tel|javascript):/i.test(v)) v = local(v);
      if (a.name === 'srcset') v = v.split(',').map((c) => { const [u, ...r] = c.trim().split(/\s+/); return [local(u), ...r].join(' '); }).join(', ');
      at += ` ${a.name}="${escA(v)}"`;
    }
    if (tag === 'img' && el.currentSrc && !el.getAttribute('src')) at += ` src="${escA(local(el.currentSrc))}"`;
    if (el.hasAttribute('data-u-chave')) at += ` data-u-conteudo="${escA(el.getAttribute('data-u-chave'))}"`;
    const ehLottie = (el.getAttribute('data-u-chave') || '').startsWith('l-') || /\.json(\?|$)/i.test(el.getAttribute('data-src') || '');
    const d = declaracoes(el, cs, pai, { esvaziado: ehLottie });
    regras.push(`#${id}{${d.join(';')}}`);
    for (const pseudo of ['::before', '::after']) {
      const pcs = getComputedStyle(el, pseudo); const c = pcs.content;
      if (!c || c === 'none' || c === 'normal') continue;
      const pd = []; for (const p of PROPS) { if (p === 'content') continue; const v = pcs.getPropertyValue(p); if (v && v !== cs.getPropertyValue(p) || ['display', 'position', 'width', 'height', 'top', 'left', 'right', 'bottom', 'background-color', 'background-image'].includes(p)) pd.push(`${p}:${v}`); }
      pd.push(`width:${pcs.width}`, `height:${pcs.height}`);
      regras.push(`#${id}${pseudo}{content:${c};${pd.join(';')}}`); rel.pseudo += 1;
    }
    // Lottie: o conteiner sai VAZIO (com data-src) — o desenho que o site deixou la (SVG com
    // centenas de imagens embutidas) e refeito pelo tocador.
    if (ehLottie) return `<${tag}${at}></${tag}>`;
    const vazio = /^(img|br|hr|input|source|wbr|area|col|embed|track)$/.test(tag);
    if (vazio) return `<${tag}${at}>`;
    let dentro = '';
    // o texto juntado vem do aria-label quando o divisor o deixou: as partes de letra perdem os
    // espacos entre palavras (cada palavra e um bloco inline) e o textContent sairia colado
    if (dividido(el)) { el.setAttribute('data-u-junto', '1'); dentro = esc(divididoAria(el) ? normT(el.getAttribute('aria-label')) : el.textContent.replace(/[ \t\n\r\f]+/g, ' ').trim()); rel.textosJuntados += 1; }
    else for (const n of el.childNodes) {
      if (n.nodeType === 3) dentro += esc(n.textContent);
      else if (n.nodeType === 1) dentro += serializar(n, el, profundidade + 1);
    }
    return `<${tag}${at}>${dentro}</${tag}>`;
  };
  const corpo = serializar(document.body, null, 0).replace(/^<body[^>]*>/, '').replace(/<\/body>$/, '');
  // fontes: as regras @font-face do site (declaram arquivos, nao sao seletores)
  const fontes = [];
  const visitar = (rs, base) => { for (const r of Array.from(rs || [])) { if (r.type === 3 && r.styleSheet) { let x; try { x = r.styleSheet.cssRules; } catch { x = null; } visitar(x, r.styleSheet.href || base); continue; } if (r.cssRules && r.type !== 5) { visitar(r.cssRules, base); continue; } if (r.type === 5) fontes.push(r.cssText.replace(/url\("?(.*?)"?\)/g, (m, u) => `url("${local(new URL(u, base).href)}")`)); } };
  for (const s of Array.from(document.styleSheets)) { let rs; try { rs = s.cssRules; } catch { continue; } visitar(rs, s.href || location.href); }
  const bodyCs = getComputedStyle(document.body);
  regras.unshift(`html{background-color:${getComputedStyle(document.documentElement).backgroundColor}}`, `body{margin:0;${['background-color', 'color', 'font-family', 'font-size', 'line-height', 'font-weight'].map((p) => `${p}:${bodyCs.getPropertyValue(p)}`).join(';')}}`);
  ifr.remove();
  return { corpo, css: regras.join('\n'), fontes: fontes.join('\n'), arquivos: Array.from(arquivos), relatorio: rel, titulo: document.title, lang: document.documentElement.lang };
}

// Grava o site VIVO numa carga fresca (antes de qualquer revelacao tocar): cada elemento leva uma
// etiqueta `data-u-rec` (os que chegam depois, preguicosos, ganham a sua na amostra seguinte);
// a cada `passo` px duas leituras (300 ms e 1100 ms). Depois, quem mudou entre leituras em varias
// paradas e testado com a pagina PARADA: se continua mudando sem rolagem, e laco de tempo.
// CAMINHO 3 — sequencia de quadros: um canvas que desenhou >= 2 imagens diferentes vira ficha
// `sequencia`. Quadros: tudo o que ele desenhou, na ordem do numero do arquivo quando todos tem
// um (sequencias exportadas sao numeradas), senao na ordem em que apareceram. Rolagem -> quadro:
// o que estava na tela em cada parada (os PONTOS medidos, nao uma reta suposta).
export function fichasDeSequencia({ amostras, sequencias, mapa, origem }) {
  const fichas = []; const arquivos = new Set(); const relatorio = { telas: sequencias.length, sequencias: 0, quadros: 0, quadrosFaltando: 0, semId: 0, paradas: 0, outrosDesenhos: 0 };
  const caminho = (u) => { try { const x = new URL(u); return x.origin === origem ? decodeURI(x.pathname).replace(/^\//, '') : null; } catch { return null; } };
  for (const s of sequencias) {
    relatorio.outrosDesenhos += s.outros;
    if (!s.ordem.length) continue;
    const id = mapa[s.rec]; if (!id) { relatorio.semId += 1; continue; }
    if (s.ordem.length === 1) {
      // QUADRO FIXO: o site desenhou uma imagem so (a planta do farmminerals so muda por clique);
      // sem ficha o canvas canonico fica em branco e a secao inteira perde o fundo
      const c = caminho(s.ordem[0]); if (!c) { relatorio.semId += 1; continue; }
      arquivos.add(c); fichas.push({ id: `m-seq-${id}`, tipo: 'sequencia', alvo: '#' + id, imagens: [c.split('/').map(encodeURIComponent).join('/')], ajuste: s.ultimo && (s.ultimo.dw < s.ultimo.cw - 1 || s.ultimo.dh < s.ultimo.ch - 1) ? 'conter' : 'cobrir', motor: { tipo: 'carga' } });
      relatorio.paradas += 1; continue;
    }
    const num = (u) => { const m = /(\d+)\.[a-z0-9]+(?:[?#].*)?$/i.exec(u); return m ? Number(m[1]) : null; };
    const ordem = s.ordem.every((u) => num(u) !== null) ? [...s.ordem].sort((a, b) => num(a) - num(b)) : s.ordem;
    const locais = ordem.map(caminho); if (locais.some((c) => !c)) { relatorio.semId += 1; continue; }
    const idx = amostras.map((a) => (a.telas && a.telas[s.rec] ? ordem.indexOf(a.telas[s.rec]) : -1));
    const val = idx.map((v, i) => (v >= 0 ? i : -1)).filter((i) => i >= 0);
    const muda = val.filter((i, j) => j && idx[i] !== idx[val[j - 1]]);
    if (!muda.length) { relatorio.paradas += 1; continue; }
    const i0 = val[val.indexOf(muda[0]) - 1]; const i1 = muda[muda.length - 1];
    const y0 = amostras[i0].y; const y1 = amostras[i1].y;
    const pontos = val.filter((i) => i >= i0 && i <= i1).map((i) => [Math.round(((amostras[i].y - y0) / (y1 - y0)) * 10000) / 10000, idx[i]]);
    // atraso entre as duas leituras = o site suaviza (scrub numerico); sem atraso, segue a rolagem seca
    const suave = amostras.some((a) => a.telasA && a.telas && a.telasA[s.rec] && a.telas[s.rec] && a.telasA[s.rec] !== a.telas[s.rec]);
    const u = s.ultimo; const ajuste = u && (u.dw < u.cw - 1 || u.dh < u.ch - 1) ? 'conter' : 'cobrir';
    locais.forEach((c) => arquivos.add(c));
    fichas.push({ id: `m-seq-${id}`, tipo: 'sequencia', alvo: '#' + id, imagens: locais.map((c) => c.split('/').map(encodeURIComponent).join('/')), ajuste, pontos, motor: { tipo: 'rolagem', inicio: y0, fim: y1, arrasto: suave ? 1 : true } });
    relatorio.sequencias += 1; relatorio.quadros += locais.length;
  }
  return { fichas, arquivos: [...arquivos], relatorio };
}

async function gravarLeitura(page, passo, deslocamento = 0) {
  const t0 = Date.now();
  await page.evaluate((pi) => { window.__uPropsInline = pi; }, PROPS_INLINE);
  await page.evaluate(() => { let n = 0; window.__urec = () => { for (const el of document.body.querySelectorAll('*:not([data-u-rec])')) { if (/^(SCRIPT|STYLE|LINK|NOSCRIPT|TEMPLATE|META)$/.test(el.tagName)) continue; el.setAttribute('data-u-rec', String(++n)); } }; window.__urec(); });
  const amostras = [];
  // deslocamento: grade alternativa (y = d, d+passo, ...) para gravar uma REFERENCIA independente da
  // que gera o caminho 1 — a regua de trajetoria corrige nela (regua-trajetoria.mjs)
  // a 1a amostra e SEMPRE y=0, fresca (r3 #4): o "topo" e o mesmo em qualquer grade, e quem se mexe
  // logo no 1o pixel conta como movel nas duas — senao a estrutura (e os ids) mudava entre gravacoes
  const ys = (max) => { const l = [0]; for (let y = deslocamento || passo; y <= max; y += passo) l.push(y); return l; };
  for (let i = 0, y = 0; ; i += 1) {
    const max0 = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
    const lista = ys(max0); if (i >= lista.length) break; y = lista[i];
    await page.evaluate((v) => { window.scrollTo(0, v); window.__urec(); }, y);
    const lerTelas = () => page.evaluate(() => Object.fromEntries(Array.from(document.querySelectorAll('canvas[data-u-rec]')).map((c) => { const r = window.__uDes && window.__uDes.get(c); return [c.getAttribute('data-u-rec'), r && r.ultimo ? r.ultimo.src : null]; })));
    await page.waitForTimeout(300); const a = await page.evaluate(medirProprio, 'data-u-rec'); const telasA = await lerTelas();
    await page.waitForTimeout(800); const b = await page.evaluate(medirProprio, 'data-u-rec'); const telas = await lerTelas();
    amostras.push({ y, a, b, telasA, telas });
  }
  const suspeitos = new Map();   // y da parada do meio -> etiquetas
  const chaves = new Set(); amostras.forEach((s) => Object.keys(s.b).forEach((k) => chaves.add(k)));
  for (const k of chaves) {
    const t = amostras.map((s, i) => (s.a[k] && s.b[k] && difere(s.a[k], s.b[k]) ? i : -1)).filter((i) => i >= 0);
    if (t.length < 3) continue;
    const y = amostras[t[Math.floor(t.length / 2)]].y; if (!suspeitos.has(y)) suspeitos.set(y, []); suspeitos.get(y).push(k);
  }
  const lacos = new Set();
  for (const [y, ks] of suspeitos) {
    await page.evaluate((v) => window.scrollTo(0, v), y); await page.waitForTimeout(2500);
    const r1 = await page.evaluate(medirProprio, 'data-u-rec'); await page.waitForTimeout(700); const r2 = await page.evaluate(medirProprio, 'data-u-rec');
    for (const k of ks) if (difere(r1[k], r2[k])) lacos.add(k);
  }
  const sequencias = await page.evaluate(() => Array.from(document.querySelectorAll('canvas[data-u-rec]')).map((c) => { const r = window.__uDes && window.__uDes.get(c); return r ? { rec: c.getAttribute('data-u-rec'), ordem: r.ordem, outros: r.outros, ultimo: r.ultimo } : null; }).filter(Boolean));
  return { amostras, lacos, sequencias, segundos: Math.round((Date.now() - t0) / 1000) };
}

// etiqueta da gravacao -> id canonico (mesma pagina, mesmo objeto); as PARTES de um texto que o
// normalizador juntou (folhas aria-hidden, em ordem) -> `${id}--${n}`, a mesma etiqueta que o tocador
// poe nas partes que ele corta (r2 #4: sem isso a regua nao via nenhuma revelacao de texto dividido)
export async function mapasDaPagina(page) {
  return page.evaluate(() => {
    const mapa = Object.fromEntries(Array.from(document.querySelectorAll('[data-u-rec][data-u-id]')).map((e) => [e.getAttribute('data-u-rec'), e.getAttribute('data-u-id')]));
    const mapaPartes = {};
    // NIVEL de cada parte (r3 #3): linhas, palavras e letras do mesmo texto coexistem quando o site
    // divide em mais de um tipo; a chave leva o nivel (l/w/c) e a ordem DENTRO dele — o tocador
    // etiqueta as suas partes do mesmo jeito. Mascara (copia que so recorta) nao e parte.
    const mascara = (d) => /mask/i.test(typeof d.className === 'string' ? d.className : '') || (d.children.length === 1 && /clip|hidden/.test(d.style.overflow) && !Array.from(d.childNodes).some((x) => x.nodeType === 3 && x.textContent.trim()));
    const filhosParte = (d) => Array.from(d.children).flatMap((c) => (mascara(c) ? filhosParte(c) : [c]));
    const nivel = (d) => {
      const c = typeof d.className === 'string' ? d.className : '';
      if (/line/i.test(c)) return 'l'; if (/letter|char/i.test(c)) return 'c'; if (/word/i.test(c)) return 'w';
      const ks = filhosParte(d);
      if (!ks.length) { const t = d.textContent.trim(); return Array.from(t).length <= 1 ? 'c' : /\s/.test(t) ? 'l' : 'w'; }
      return nivel(ks[0]) === 'c' ? 'w' : 'l';
    };
    for (const el of document.querySelectorAll('[data-u-junto][data-u-id]')) {
      const id = el.getAttribute('data-u-id'); const cont = { l: 0, w: 0, c: 0 };
      const visitar = (d) => { for (const k of filhosParte(d)) { if (!k.textContent.trim()) continue; const nv = nivel(k); if (k.hasAttribute('data-u-rec')) mapaPartes[k.getAttribute('data-u-rec')] = `${id}--${nv}${cont[nv]++}`; visitar(k); } };
      visitar(el);
    }
    // so DESCENDENTES do corpo (r4): o <body> ganha id na normalizacao mas a canonica e escrita com um
    // <body> nu — com ele na lista a regua recusava toda comparacao
    const ids = Array.from(document.body.querySelectorAll('[data-u-id]')).map((e) => [e.getAttribute('data-u-id'), e.tagName.toLowerCase()]);
    return { mapa, mapaPartes, ids };
  });
}
// mesmo FORMATO na gravacao principal e na referencia (r3 #5): o canal CSS de cada elemento e
// preenchido para tras antes de escrever (o caminho 1 ja preenchia a principal ao gerar as fichas)
function gravacaoPorId(gravacao, mapa) {
  const ks = new Set(); gravacao.amostras.forEach((x) => Object.keys(x.b).forEach((k) => ks.add(k)));
  for (const k of ks) if (mapa[k]) preencherCss(gravacao.amostras.map((x) => x.b[k]));
  // null = display:none (um estado, nao ausencia — Astra r1 #2: `none -> block` sumia da regua); o
  // quadro que cada canvas mostrava entra como `quadro` (nome do arquivo)
  const nome = (u) => { try { return decodeURIComponent(String(u).split(/[?#]/)[0].split('/').pop()); } catch { return String(u); } };
  const porId = (m, telas) => { const o = {}; for (const [k, v] of Object.entries(m || {})) if (mapa[k]) o[mapa[k]] = v && telas && telas[k] ? { ...v, quadro: nome(telas[k]) } : v; return o; };
  return gravacao.amostras.map((x) => ({ y: x.y, b: porId(x.b, x.telas) }));
}
// etiquetas que mudaram em alguma leitura (entre paradas, ou entre as duas leituras de uma parada)
export function etiquetasQueSeMexem(amostras) {
  const ks = new Set(); amostras.forEach((s) => Object.keys(s.b).forEach((k) => ks.add(k)));
  const out = [];
  for (const k of ks) {
    let ref; let muda = false;
    for (const s of amostras) { const b = s.b[k]; if (s.a && s.a[k] && b && difere(s.a[k], b)) { muda = true; break; } if (b === undefined) continue; if (ref === undefined) ref = b; else if (difere(ref, b)) { muda = true; break; } }
    if (muda) out.push(k);
  }
  return out;
}

export async function normalizarCaptura({ captura, saida, movimento = false, passo = 100, deslocamento = 0, soGravacao = null }) {
  const corpoColetar = await coletarDoExtrator();
  const { srv, origem } = await servir(path.resolve(captura));
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
    await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
    if (movimento) await page.addInitScript(() => {
      // rolagem exata por posicao para a gravacao (a suave do site interpolaria)
      const Falso = function () { this.on = () => {}; this.raf = () => {}; this.destroy = () => {}; this.start = () => {}; this.stop = () => {}; this.scrollTo = (y) => window.scrollTo(0, typeof y === 'number' ? y : 0); this.resize = () => {}; };
      Object.defineProperty(window, 'Lenis', { configurable: true, get: () => Falso, set: () => {} });
      // CAMINHO 3: o que cada <canvas> desenha (sequencia de quadros comandada pela rolagem, por
      // qualquer codigo do site). So imagens com endereco; o resto (video, outro canvas) e contado.
      const des = (window.__uDes = new WeakMap());
      const orig = CanvasRenderingContext2D.prototype.drawImage;
      CanvasRenderingContext2D.prototype.drawImage = function (img, ...a) {
        try {
          const c = this.canvas; let r = des.get(c); if (!r) des.set(c, (r = { ordem: [], visto: new Set(), outros: 0, ultimo: null }));
          const src = img && img.tagName === 'IMG' ? (img.currentSrc || img.src) : null;
          if (!src) r.outros += 1;
          else {
            if (!r.visto.has(src)) { r.visto.add(src); r.ordem.push(src); }
            const k = this.getTransform().a || 1; const nw = img.naturalWidth; const nh = img.naturalHeight;
            const [dw, dh] = a.length >= 8 ? [a[6], a[7]] : a.length >= 4 ? [a[2], a[3]] : [nw, nh];
            r.ultimo = { src, dw: dw * k, dh: dh * k, cw: c.width, ch: c.height };
          }
        } catch (e) { /* medir nunca derruba o site */ }
        return orig.call(this, img, ...a);
      };
    });
    await page.goto(`${origem}/index.html`, { waitUntil: 'load', timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(3000);
    let gravacao = null;
    if (movimento) gravacao = await gravarLeitura(page, passo, deslocamento);   // a gravacao E a passada que carrega o preguicoso
    else {
      const max = await page.evaluate(() => document.documentElement.scrollHeight);
      for (let y = 0; y < max; y += 900) { await page.evaluate((v) => window.scrollTo(0, v), y); await page.waitForTimeout(250); }
    }
    await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(2000);
    await page.evaluate(`window.__marca = (el, k) => { try { el.setAttribute('data-u-chave', k); } catch (e) {} return k; }; (${corpoColetar})(${JSON.stringify(origem)}); true`);
    // quem se mexeu na gravacao nao pode ter o invólucro desfeito (r2 #3): o movimento dele ficaria sem id
    if (gravacao) await page.evaluate((l) => { window.__uMoveis = new Set(l); }, etiquetasQueSeMexem(gravacao.amostras));
    const r = await page.evaluate(normalizar);
    if (soGravacao) {
      // SO A REFERENCIA (r2 #1): a gravacao do site num arquivo PROPRIO, com a lista de ids para a regua
      // conferir que os gemeos sao os mesmos; o clone (index.html, motion.json) nao e tocado
      const { mapa, mapaPartes, ids } = await mapasDaPagina(page);
      await mkdir(path.dirname(path.resolve(soGravacao)), { recursive: true });
      await writeFile(soGravacao, JSON.stringify({ passo, deslocamento, ids, amostras: gravacaoPorId(gravacao, { ...mapa, ...mapaPartes }) }));
      return { soGravacao, ids: ids.length, partes: Object.keys(mapaPartes).length, amostras: gravacao.amostras.length };
    }
    const html = `<!doctype html>\n<html lang="${r.lang || 'en'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${r.titulo.replace(/</g, '&lt;')}</title>
<style id="u-fontes">${r.fontes}</style>
<style id="u-estilo">${r.css}</style>
</head><body>${r.corpo}
<script src="vendor/gsap.min.js"></script><script src="vendor/ScrollTrigger.min.js"></script><script src="vendor/lenis.min.js"></script><script src="vendor/lottie.min.js"></script><script src="vendor/uncraft-motion.js"></script>
</body></html>`;
    await mkdir(saida, { recursive: true });
    await writeFile(path.join(saida, 'index.html'), html);
    if (!existsSync(path.join(saida, 'motion.json'))) await writeFile(path.join(saida, 'motion.json'), JSON.stringify({ versao: 0, fichas: [] }));
    let copiados = 0; const faltando = [];
    // os arquivos que NOS escrevemos nunca vem da captura: um link do site para "index.html" (o
    // produtor reescreve o link da home assim) copiava a pagina NATIVA por cima da canonica —
    // medido no gsap.com, a rodada inteira mediu o site original achando que era o clone
    const NOSSOS = /^(index\.html|motion(\.[\w+-]+)?\.json|vendor\/)/;
    for (const a of r.arquivos) { if (!a || NOSSOS.test(a)) continue; const de = path.join(captura, a); if (!existsSync(de)) { faltando.push(a); continue; } if ((await stat(de)).isDirectory()) continue; const para = path.join(saida, a); await mkdir(path.dirname(para), { recursive: true }); await copyFile(de, para); copiados += 1; }
    const V = path.resolve('node_modules');
    await mkdir(path.join(saida, 'vendor'), { recursive: true });
    for (const [de, nome] of [['gsap/dist/gsap.min.js', 'gsap.min.js'], ['gsap/dist/ScrollTrigger.min.js', 'ScrollTrigger.min.js'], ['lenis/dist/lenis.min.js', 'lenis.min.js'], ['lottie-web/build/player/lottie.min.js', 'lottie.min.js']]) await copyFile(path.join(V, de), path.join(saida, 'vendor', nome));
    await copyFile(path.resolve('lib/motion-program/uncraft-motion.js'), path.join(saida, 'vendor', 'uncraft-motion.js'));
    // a pagina escrita e a canonica? (rede de seguranca da copia acima)
    if (!(await readFile(path.join(saida, 'index.html'), 'utf8')).includes('<style id="u-estilo">')) throw new Error('index.html da saida nao e a canonica (foi sobrescrito)');
    let mov = null;
    if (movimento) {
      // etiqueta da gravacao -> id que o elemento ganhou na canonica (mesma pagina, mesmo objeto)
      const { mapa, mapaPartes, ids } = await mapasDaPagina(page);
      // modo: 'leitura' (caminho 1), 'ix3' (caminho 2), 'ix3+leitura' (2 onde o site declara, 1 no
      // resto: ficha observada cujo alvo o IX3 ja anima sai, para nao haver dois motores no elemento);
      // 'todos' escreve os tres programas da MESMA gravacao (motion.<modo>.json; motion.json = leitura).
      // As sequencias de quadros (caminho 3) e as Lottie entram em todos.
      const modo = movimento === true ? 'leitura' : String(movimento);
      const leit = fichasPorLeitura({ ...gravacao, mapa }, passo);
      let ix = null; let relIx = null;
      if (modo.includes('ix3') || modo === 'todos') {
        const fontes = await page.evaluate(() => Array.from(document.scripts).map((x) => (x.src ? { src: x.src } : { texto: x.textContent })));
        const reg = { interacoes: [], linhas: [], falhas: [] };
        for (const f of fontes) {
          let js = f.texto || '';
          if (f.src) { try { const u = new URL(f.src); if (u.origin === origem) js = await readFile(path.join(captura, decodeURI(u.pathname)), 'utf8'); } catch { js = ''; } }
          if (!js.includes('.register([')) continue;
          const r = extrairRegistro(js); reg.interacoes.push(...r.interacoes); reg.linhas.push(...r.linhas); reg.falhas.push(...r.falhas);
        }
        const resolvido = await page.evaluate(resolverNaPagina, { interacoes: reg.interacoes, linhas: reg.linhas, largura: 1440 });
        ix = fichasDoIx3(reg, resolvido);
        relIx = { interacoes: reg.interacoes.length, linhasDeclaradas: reg.linhas.length, falhas: reg.falhas, pulos: resolvido.pulos, instancias: resolvido.instancias.length, ...ix.relatorio };
      }
      const seq = fichasDeSequencia({ ...gravacao, mapa, origem });
      for (const a of seq.arquivos) { const de = path.join(captura, a); if (!existsSync(de)) { seq.relatorio.quadrosFaltando += 1; continue; } const para = path.join(saida, a); await mkdir(path.dirname(para), { recursive: true }); await copyFile(de, para); }
      // Lottie: o conteiner canonico sai vazio; o tocador desenha (src ja reescrito para o pacote)
      const lot = [...html.matchAll(/<[a-z]+ id="([^"]+)"[^>]*\sdata-src="([^"]+\.json)"/gi)].map((m) => ({ id: m[1], src: m[2] }));
      const lottie = lot.map((l) => ({ id: `m-lottie-${l.id}`, tipo: 'lottie', alvo: '#' + l.id, src: l.src, motor: { tipo: 'tempo' } }));
      const programa = (m) => {
        const fs = [];
        if (m.includes('ix3') && ix) fs.push(...ix.fichas);
        let retiradas = 0;
        if (m.includes('leitura')) {
          const doIx = new Set(m.includes('ix3') && ix ? ix.fichas.flatMap((f) => [].concat(f.alvo)) : []);
          const ficam = leit.fichas.filter((f) => ![].concat(f.alvo).some((a) => doIx.has(a)));
          retiradas = leit.fichas.length - ficam.length; fs.push(...ficam);
        }
        fs.push(...seq.fichas, ...lottie);
        return { fichas: fs, retiradas };
      };
      const modos = modo === 'todos' ? ['leitura', 'ix3', 'ix3+leitura'] : [modo];
      const porModo = {};
      for (const m of modos) {
        const p = programa(m); porModo[m] = { fichas: p.fichas.length, retiradasDaLeituraPorIx3: p.retiradas };
        await writeFile(path.join(saida, modo === 'todos' ? `motion.${m}.json` : 'motion.json'), JSON.stringify({ versao: 0, fichas: p.fichas }, null, 1));
        if (modo === 'todos' && m === 'leitura') await writeFile(path.join(saida, 'motion.json'), JSON.stringify({ versao: 0, fichas: p.fichas }, null, 1));
      }
      const rm = { modo, porModo, leitura: leit.relatorio, ...(relIx ? { ix3: relIx } : {}), sequencias: seq.relatorio };
      // a gravacao do SITE por id canonico, ao lado do pacote: e a regua de trajetoria (o estado de
      // cada elemento em cada parada) contra a qual qualquer programa de movimento se compara
      await writeFile(path.join(path.dirname(path.resolve(saida)), 'gravacao-nativa.json'), JSON.stringify({ passo, deslocamento, ids, amostras: gravacaoPorId(gravacao, { ...mapa, ...mapaPartes }) }));
      mov = { ...rm, amostras: gravacao.amostras.length, lacosMedidos: gravacao.lacos.size, lotties: lot.length, segundosGravando: gravacao.segundos };
    }
    return { ...r.relatorio, movimento: mov, arquivosCopiados: copiados, arquivosFaltando: faltando.length, amostraFaltando: faltando.slice(0, 10), bytesHtml: html.length, bytesCss: r.css.length };
  } finally { await browser.close(); srv.close(); }
}

if (process.argv[1] && process.argv[1].endsWith('normalizar-clone.mjs')) {
  const mArg = process.argv.find((a) => a === '--movimento' || a.startsWith('--movimento='));
  const r = await normalizarCaptura({ captura: arg('--captura'), saida: arg('--saida'), movimento: mArg ? (mArg.split('=')[1] || 'leitura') : (arg('--so-gravacao') ? 'leitura' : false), passo: Number(arg('--passo', 100)), deslocamento: Number(arg('--deslocamento', 0)), soGravacao: arg('--so-gravacao', null) });
  console.log(JSON.stringify(r, null, 1));
}
