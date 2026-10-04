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
import { lerGsapNaPagina, fichasDoGsap, CONTROLE_GSAP } from './ler-gsap.mjs';

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
export function normalizar(opcoes = {}) {
  const remotas = (opcoes && opcoes.remotas) || {};
  // DUAS sentinelas (Astra r2: com uma so, um elemento que ja tivesse aquela cor "provava" dependencia)
  // Transicoes desligadas durante a sondagem (Astra r3: com `transition: color` o valor lido logo apos a troca
  // ainda e o antigo, e a dependencia real saia gravada como cor fixa); a cor e restaurada AINDA sem transicao.
  const restaurar = (el, prop, valor, prio) => { if (valor) el.style.setProperty(prop, valor, prio); else el.style.removeProperty(prop); };
  // Transicao EM ANDAMENTO no elemento (Astra r4): desligar as transicoes a cancelaria e mudaria a pagina capturada
  // — entao nao se sonda e a cor fica gravada como esta (o comportamento conservador de antes).
  const transicaoEmAndamento = (el) => {
    try { return typeof CSSTransition !== 'undefined' && el.getAnimations().some((a) => a instanceof CSSTransition && a.playState !== 'finished' && a.playState !== 'idle'); } catch (e) { return true; }
  };
  const segueCor = (el, p, pseudo = null) => {
    if (transicaoEmAndamento(el)) return false;
    const prev = el.style.getPropertyValue('color'); const prio = el.style.getPropertyPriority('color');
    const prevT = el.style.getPropertyValue('transition'); const prioT = el.style.getPropertyPriority('transition');
    el.style.setProperty('transition', 'none', 'important'); getComputedStyle(el).color;
    try {
      return ['rgb(1, 2, 3)', 'rgb(4, 5, 6)'].every((c) => { el.style.setProperty('color', c, 'important'); return getComputedStyle(el, pseudo).getPropertyValue(p) === c; });
    } finally { restaurar(el, 'color', prev, prio); getComputedStyle(el).color; restaurar(el, 'transition', prevT, prioT); }
  };
  const SONDA_HERANCA = { color: ['rgb(1, 2, 3)', 'rgb(4, 5, 6)'], 'font-family': ['u-a', 'u-b'], 'font-size': ['13px', '17px'], 'font-weight': ['300', '500'], 'font-style': ['oblique 7deg', 'oblique 9deg'], 'line-height': ['17px', '19px'], 'letter-spacing': ['1px', '2px'], 'text-align': ['right', 'center'], 'text-transform': ['lowercase', 'uppercase'], 'white-space': ['pre-line', 'nowrap'], 'word-break': ['break-all', 'keep-all'], 'list-style-type': ['square', 'circle'], cursor: ['crosshair', 'wait'], 'text-indent': ['3px', '5px'], 'word-spacing': ['2px', '4px'], fill: ['rgb(1, 2, 3)', 'rgb(4, 5, 6)'], stroke: ['rgb(1, 2, 3)', 'rgb(4, 5, 6)'], 'stroke-width': ['3px', '5px'] };
  const segueOPai = (el, pai, p) => {
    const vals = SONDA_HERANCA[p]; if (!vals || !pai || transicaoEmAndamento(el) || transicaoEmAndamento(pai)) return false;
    const tr = [pai, el].map((e) => [e.style.getPropertyValue('transition'), e.style.getPropertyPriority('transition')]);
    const prev = pai.style.getPropertyValue(p); const prio = pai.style.getPropertyPriority(p);
    for (const e of [pai, el]) e.style.setProperty('transition', 'none', 'important'); getComputedStyle(el).getPropertyValue(p);
    try { return vals.every((x) => { pai.style.setProperty(p, x, 'important'); return getComputedStyle(el).getPropertyValue(p) === getComputedStyle(pai).getPropertyValue(p); }); }
    finally { restaurar(pai, p, prev, prio); getComputedStyle(el).getPropertyValue(p); [pai, el].forEach((e, i) => restaurar(e, 'transition', tr[i][0], tr[i][1])); }
  };
  const AUTO_POSSIVEL = new Set(['top', 'right', 'bottom', 'left', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left']);
  const SEGUEM_COR = new Set(['-webkit-text-fill-color', '-webkit-text-stroke-color', 'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color', 'outline-color', 'text-decoration-color', 'text-emphasis-color', 'caret-color', 'column-rule-color']);
  const HERDAVEIS = new Set(['color', 'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing', 'text-align', 'text-transform', 'white-space', 'word-break', 'list-style-type', 'cursor', 'visibility', 'text-indent', 'word-spacing', 'fill', 'stroke', 'stroke-width']);
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
    'text-indent', 'word-spacing', 'white-space', 'word-break', 'color', 'list-style-type', 'cursor', 'content', 'transform', 'transform-origin', 'opacity', 'clip-path', 'filter', 'visibility', 'translate', 'rotate', 'scale', 'backdrop-filter', 'text-overflow', '-webkit-text-fill-color', '-webkit-background-clip', '-webkit-text-stroke-color', '-webkit-text-stroke-width', 'caret-color', 'column-rule-color', 'text-emphasis-color', 'fill', 'stroke', 'stroke-width', 'appearance',
    // mascara: o Framer desenha logo/icone como bloco colorido recortado por um SVG (teste as cegas, 2026-10-04)
    'mask-image', 'mask-size', 'mask-position', 'mask-repeat', 'mask-mode', 'mask-composite', 'mask-clip', 'mask-origin'];
  const PULAR = /^(SCRIPT|NOSCRIPT|STYLE|LINK|TEMPLATE|META|BASE|IFRAME)$/;
  const MIDIA = /^(IMG|VIDEO|CANVAS|PICTURE|SOURCE|svg)$/i;
  // padrao de cada tag, num documento limpo
  const ifr = document.createElement('iframe'); ifr.style.cssText = 'position:absolute;width:0;height:0;border:0;visibility:hidden'; document.body.appendChild(ifr);
  const ddoc = ifr.contentDocument; ddoc.open(); ddoc.write('<!doctype html><html><head></head><body></body></html>'); ddoc.close();
  const padroes = {};
  // O padrao do navegador depende de ATRIBUTOS: <a> so e azul e sublinhado COM endereco, e o campo muda
  // com o tipo (teste as cegas no Framer, 2026-10-04: o padrao medido num <a> sem href deixava o link
  // da canonica azul e sublinhado). E uma propriedade herdavel que o navegador NAO herda naquela tag
  // (cor do link, tamanho do h1, peso do <b>, italico do <em>) nao pode ser pulada por "igual ao pai":
  // a canonica nao tem o CSS do site, entao o padrao do navegador voltaria. Medido com sentinelas no pai.
  const SENTINELA = { color: 'rgb(1, 2, 3)', 'font-family': 'u-sentinela', 'font-size': '13px', 'font-weight': '300', 'font-style': 'oblique 7deg', 'line-height': '17px', 'letter-spacing': '1px', 'text-align': 'right', 'text-transform': 'lowercase', 'white-space': 'pre-line', 'word-break': 'break-all', 'list-style-type': 'square', cursor: 'crosshair', 'text-indent': '3px', 'word-spacing': '2px', fill: 'rgb(1, 2, 3)', stroke: 'rgb(1, 2, 3)', 'stroke-width': '3px' };
  const chaveDaTag = (el) => { const t = el.tagName.toLowerCase(); if ((t === 'a' || t === 'area') && el.hasAttribute('href')) return `${t}[href]`; if (t === 'input' || t === 'button') return `${t}[type=${(el.getAttribute('type') || '').toLowerCase()}]`; return t; };
  const padraoDe = (chave) => {
    if (padroes[chave]) return padroes[chave];
    const m = /^([a-z0-9-]+)(?:\[(href|type)(?:=(.*))?\])?$/i.exec(chave) || [null, chave];
    const criar = () => { const e = ddoc.createElement(m[1]); if (m[2] === 'href') e.setAttribute('href', '#'); if (m[2] === 'type' && m[3]) e.setAttribute('type', m[3]); return e; };
    const e = criar(); ddoc.body.appendChild(e); const cs = getComputedStyle(e); const o = {}; for (const p of PROPS) o[p] = cs.getPropertyValue(p); e.remove();
    const caixa = ddoc.createElement('div'); for (const [p, v] of Object.entries(SENTINELA)) caixa.style.setProperty(p, v); ddoc.body.appendChild(caixa);
    const f = criar(); caixa.appendChild(f); const ccs = getComputedStyle(caixa); const fcs = getComputedStyle(f); const herda = {};
    for (const p of HERDAVEIS) herda[p] = !(p in SENTINELA) || fcs.getPropertyValue(p) === ccs.getPropertyValue(p);
    caixa.remove(); o.__herda = herda; padroes[chave] = o; return o;
  };
  // padrao de um ::before/::after (as propriedades NAO herdaveis partem do valor inicial, nao do elemento)
  const pseudoPadrao = (() => { const st = ddoc.createElement('style'); st.textContent = '#u-pp::after{content:""}'; ddoc.head.appendChild(st); const e = ddoc.createElement('span'); e.id = 'u-pp'; ddoc.body.appendChild(e); const cs = getComputedStyle(e, '::after'); const o = {}; for (const p of PROPS) o[p] = cs.getPropertyValue(p); e.remove(); st.remove(); return o; })();
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
    const pad = padraoDe(chaveDaTag(el)); const pcs = pai ? getComputedStyle(pai) : null; const out = [];
    // `auto` DECLARADO (posicao estatica de um absoluto, margem que centraliza): getComputedStyle devolve
    // o numero CALCULADO e gravar o numero congela a posicao — a folha do farmminerals ficou 80 px abaixo
    // quando cresceu (2026-10-04). O mapa de estilo computado preserva a palavra `auto`.
    const mapa = el.computedStyleMap ? (() => { try { return el.computedStyleMap(); } catch (e) { return null; } })() : null;
    const ehAuto = (p) => { try { const x = mapa && mapa.get(p); return Boolean(x) && String(x) === 'auto'; } catch (e) { return false; } };
    for (const p of PROPS) {
      let v = cs.getPropertyValue(p);
      if (p === 'content') continue;
      if (AUTO_POSSIVEL.has(p) && ehAuto(p)) { if (pad[p] !== 'auto' && !/^(top|right|bottom|left)$/.test(p)) out.push(`${p}:auto`); continue; }
      // cor que SO repete a cor do texto (o padrao e "currentcolor"): gravada como valor fixo, ela parava
      // de seguir `color` — medido no farmminerals, a animacao trocava a cor do letreiro e as letras
      // continuavam pintadas de verde pelo -webkit-text-fill-color assado (2026-10-04)
      // DEPENDENCIA provada (Astra: igual nao e o mesmo que seguir — borda verde num texto verde ficaria
      // vermelha quando o texto mudasse): troca-se `color` por um instante e ve-se se a propriedade vai junto
      // e NUNCA contra o padrao da tag: o "currentcolor" dele foi resolvido com OUTRA cor de texto (preto),
      // entao uma borda preta num texto azul era pulada e a canonica a pintava de azul (nexusmag, 2026-10-04)
      if (SEGUEM_COR.has(p)) { if (v === cs.color && segueCor(el, p)) continue; out.push(`${p}:${v}`); continue; }
      // herdavel que o navegador nao herda naquela tag e IGUAL ao pai: `inherit` (o link continua seguindo
      // uma animacao de cor do pai; um valor fixo o congelaria)
      // (Astra r1: igual nao prova dependencia — so `inherit` se o filho ACOMPANHA uma troca no pai)
      if (HERDAVEIS.has(p)) { if (pad.__herda[p]) { if (pcs && pcs.getPropertyValue(p) === v) continue; if (!pcs && pad[p] === v) continue; } else if (pcs && pcs.getPropertyValue(p) === v && segueOPai(el, pai, p)) { out.push(`${p}:inherit`); continue; } }
      else if (pad[p] === v) continue;
      if ((p === 'background-image' || p === 'mask-image') && v !== 'none') v = v.replace(/url\("?(.*?)"?\)/g, (m, u) => { try { const x = new URL(u, location.href); if (x.origin === location.origin) return `url("${decodeURI(x.pathname).replace(/^\//, '')}${x.hash}")`; const l = remotas[x.href] || remotas[u]; if (l) { arquivos.add(l); return `url("${l}${x.hash}")`; } return m; } catch { return m; } });
      out.push(`${p}:${v}`);
    }
    // tamanho DEFINIDO pelo site: so entra se mudaria com auto. Conteiner que sai VAZIO (Lottie)
    // leva o tamanho sempre: o auto dele era o do desenho que ficou para tras, e vazio o tocador
    // desenharia no tamanho padrao da Lottie (medido: o icone de 12 px do menu virou 300 px).
    // Elemento SUBSTITUIDO (img/video/canvas/svg...) tambem: o auto dele e o tamanho NATURAL do
    // recurso, que muda com a variante que o navegador escolhe do srcset (medido: a imagem do CTA
    // tinha 1440 px no site, contida por max-width:100%, e 1200 px na canonica com outra variante).
    // ⚠️ mas a ALTURA de imagem/video so quando o site a impoe (2026-10-04): gravada sempre, ela ficava
    // presa enquanto a largura animava — a folha do farmminerals saiu 476 x 84 em vez de 476 x 290 (a
    // altura acompanha a largura pela proporcao da imagem). A largura segue sempre (variante do srcset).
    const substituido = /^(IMG|VIDEO|CANVAS|SVG|IFRAME|OBJECT|EMBED|PICTURE)$/i.test(el.tagName);
    if (esvaziado) { out.push(`width:${cs.width}`, `height:${cs.height}`); rel.tamanhosDoSite += 2; }
    else if (substituido) {
      out.push(`width:${cs.width}`); rel.tamanhosDoSite += 1;
      const antes = el.getBoundingClientRect().height; const prev = el.style.getPropertyValue('height'); const prio = el.style.getPropertyPriority('height');
      // a referencia e o que a CANONICA aplicaria sem o CSS do site: o atributo height (dica de apresentacao)
      // quando existe, senao auto (nexusmag, 2026-10-04: height="800" com CSS 100% num quadro de 215 — o teste
      // com auto dava 215 pela proporcao dos atributos, a altura nao era gravada e a canonica mostrava 800)
      const hAttr = el.getAttribute('height'); const refAltura = hAttr && /^\d+(\.\d+)?$/.test(hAttr.trim()) ? `${hAttr.trim()}px` : 'auto';
      el.style.setProperty('height', refAltura, 'important'); const depois = el.getBoundingClientRect().height;
      if (prev) el.style.setProperty('height', prev, prio); else el.style.removeProperty('height');
      if (Math.abs(antes - depois) > 0.5 || !/^(IMG|VIDEO|PICTURE)$/i.test(el.tagName)) { out.push(`height:${cs.height}`); rel.tamanhosDoSite += 1; }
    }
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
  const esc = (t) => t.replace(/[\u0001-\u0003]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const escA = (t) => String(t).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  const ATTRS = new Set(['src', 'srcset', 'sizes', 'alt', 'href', 'poster', 'muted', 'loop', 'autoplay', 'playsinline', 'preload', 'controls', 'data-src', 'aria-label', 'role', 'type', 'width', 'height', 'target', 'rel', 'name', 'value', 'placeholder', 'for', 'title', 'colspan', 'rowspan', 'datetime', 'lang', 'dir', 'tabindex']);
  const arquivos = new Set();
  // id ORIGINAL -> nosso id. Cada elemento ganha um id descritivo nosso e o original sai; quem apontava
  // para o original (icone por <use href="#x">, ancora <a href="#secao">, rotulo for=, url(#x)) passa a
  // apontar para o nosso (teste as cegas no Framer: os icones somem e as ancoras internas quebram).
  const idsOriginais = new Map();
  // A referencia e MARCADA no atributo na hora de copiar (\u0001 = "#id", \u0003 = "id" sem #) e resolvida no
  // fim, quando todos os ids ja existem (o alvo pode vir depois). O texto visivel nunca tem as marcas (esc as tira).
  const marcaRef = (k) => `\u0001${encodeURIComponent(k)}\u0002`;
  const marcaFor = (k) => `\u0003${encodeURIComponent(k)}\u0002`;
  const marcarUrls = (v) => v.replace(/url\((["']?)#([^"')]+)\1\)/g, (m, q, k) => `url(${q}${marcaRef(k)}${q})`);
  const resolver = (k) => { const d = decodeURIComponent(k); return idsOriginais.has(d) ? idsOriginais.get(d) : d; };
  const religar = (t) => t.replace(/\u0001([^\u0002]*)\u0002/g, (m, k) => `#${escA(resolver(k))}`).replace(/\u0003([^\u0002]*)\u0002/g, (m, k) => escA(resolver(k)));
  const religarCss = (t) => t.replace(/url\((["']?)#([^"')]+)\1\)/g, (m, q, k) => (idsOriginais.has(k) ? `url(${q}#${idsOriginais.get(k)}${q})` : m));
  const local = (u) => { try { const x = new URL(u, location.href); if (x.origin !== location.origin) { const l = remotas[x.href] || remotas[u]; if (l) { arquivos.add(l); return l + x.hash; } return u; } const p = decodeURI(x.pathname).replace(/^\//, ''); arquivos.add(p); return p.split('/').map(encodeURIComponent).join('/') + x.hash; } catch { return u; } };
  const serializar = (el, pai, profundidade) => {
    if (PULAR.test(el.tagName)) return '';
    if (el === ifr) return '';
    const cs = getComputedStyle(el);
    if (cs.display === 'none' && !el.hasAttribute('data-u-chave')) return '';
    // SVG: copiado inteiro (desenho), com id proprio
    if (el.tagName.toLowerCase() === 'svg') {
      const id = idPara(el); el.setAttribute('data-u-id', id); if (el.id && !idsOriginais.has(el.id)) idsOriginais.set(el.id, id); const clone = el.cloneNode(true); clone.removeAttribute('id'); clone.removeAttribute('class'); clone.removeAttribute('style'); clone.removeAttribute('data-u-id'); clone.removeAttribute('data-u-rec'); clone.querySelectorAll('[data-u-rec]').forEach((x) => x.removeAttribute('data-u-rec'));
      clone.querySelectorAll('script').forEach((s) => s.remove());
      for (const n of [clone, ...clone.querySelectorAll('*')]) for (const a of Array.from(n.attributes)) {
        if ((a.name === 'href' || a.name === 'xlink:href') && a.value.length > 1 && a.value.startsWith('#')) n.setAttribute(a.name, marcaRef(a.value.slice(1)));
        else if (a.name === 'href' || a.name === 'xlink:href') n.setAttribute(a.name, local(a.value));
        else if (a.value.includes('url(#')) n.setAttribute(a.name, marcarUrls(a.value));
      }
      const d = declaracoes(el, cs, pai); regras.push(`#${id}{${d.join(';')}}`); rel.elementos += 1;
      return clone.outerHTML.replace(/^<svg/, `<svg id="${id}"`);
    }
    if (desfazivel(el)) {
      rel.embrulhosDesfeitos += 1; const filho = el.children[0]; const html = serializar(filho, pai, profundidade);
      const sobra = filho.getAttribute('data-u-id') || (filho.querySelector('[data-u-id]') || { getAttribute: () => null }).getAttribute('data-u-id');
      if (el.id && sobra && !idsOriginais.has(el.id)) idsOriginais.set(el.id, sobra);
      return html;
    }
    const id = idPara(el); rel.elementos += 1; el.setAttribute('data-u-id', id);
    if (el.id && !idsOriginais.has(el.id)) idsOriginais.set(el.id, id);
    const tag = el.tagName.toLowerCase();
    let at = ` id="${id}"`;
    for (const a of Array.from(el.attributes)) {
      if (!ATTRS.has(a.name)) continue;
      let v = a.value;
      if (a.name === 'href' && v.length > 1 && v.startsWith('#')) { at += ` href="${marcaRef(v.slice(1))}"`; continue; }
      if (a.name === 'for' && v) { at += ` for="${marcaFor(v)}"`; continue; }
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
      const pd = []; for (const p of PROPS) { if (p === 'content') continue; const v = pcs.getPropertyValue(p); if (SEGUEM_COR.has(p)) { if (v === pcs.color && segueCor(el, p, pseudo)) continue; pd.push(`${p}:${v}`); continue; } const base = HERDAVEIS.has(p) ? cs.getPropertyValue(p) : pseudoPadrao[p]; if (v && v !== base || ['display', 'position', 'width', 'height', 'top', 'left', 'right', 'bottom', 'background-color', 'background-image'].includes(p)) pd.push(`${p}:${v}`); }
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
  const corpo = religar(serializar(document.body, null, 0).replace(/^<body[^>]*>/, '').replace(/<\/body>$/, ''));
  // fontes: as regras @font-face do site (declaram arquivos, nao sao seletores)
  const fontes = [];
  const visitar = (rs, base) => { for (const r of Array.from(rs || [])) { if (r.type === 3 && r.styleSheet) { let x; try { x = r.styleSheet.cssRules; } catch { x = null; } visitar(x, r.styleSheet.href || base); continue; } if (r.cssRules && r.type !== 5) { visitar(r.cssRules, base); continue; } if (r.type === 5) fontes.push(r.cssText.replace(/url\("?(.*?)"?\)/g, (m, u) => `url("${local(new URL(u, base).href)}")`)); } };
  for (const s of Array.from(document.styleSheets)) { let rs; try { rs = s.cssRules; } catch { continue; } visitar(rs, s.href || location.href); }
  const bodyCs = getComputedStyle(document.body);
  regras.unshift(`html{background-color:${getComputedStyle(document.documentElement).backgroundColor}}`, `body{margin:0;${['background-color', 'color', 'font-family', 'font-size', 'line-height', 'font-weight'].map((p) => `${p}:${bodyCs.getPropertyValue(p)}`).join(';')}}`);
  ifr.remove();
  return { corpo, css: religarCss(regras.join('\n')), fontes: fontes.join('\n'), arquivos: Array.from(arquivos), relatorio: rel, titulo: document.title, lang: document.documentElement.lang };
}

// Imagem cujo endereco o codigo do SITE monta enquanto a pagina roda (Framer: servidor de imagens com
// largura/altura na query) fica REMOTA, embora a captura tenha guardado o arquivo — e offline quebra
// (teste as cegas no Framer, 2026-10-04: 15 de 33 imagens no revena; no nexusmag o proprio Framer troca a
// imagem que falhou por um aviso "Failed to load image").
// A identidade vem do MAPA que o produtor gravou (caminho emitido -> URL original, ja com os desempates de
// nome que ele faz quando dois enderecos colidem), embutido na pagina nativa. Nunca se recalcula o nome e se
// toma "o arquivo existe" como prova (Astra r2: `a%20b.png` e `a_20b.png` dao o mesmo nome; o segundo fica
// com sufixo, e o recalculo serviria os bytes do primeiro). Sem o mapa: nada e trocado.
export function mapaDaCaptura(htmlNativo) {
  const porUrl = Object.create(null);   // sem prototipo: uma URL nunca cai num setter herdado
  const m = /var ALHEIOS = JSON\.parse\(("(?:[^"\\]|\\.)*")\)/.exec(htmlNativo || '');
  if (!m) return porUrl;
  try { for (const [c, u] of Object.entries(JSON.parse(JSON.parse(m[1])))) if (typeof u === 'string' && !(u in porUrl)) porUrl[u] = c; } catch { return Object.create(null); }
  return porUrl;
}
export function arquivoCapturado(porUrl, url) { const u = String(url).split('#')[0]; return Object.prototype.hasOwnProperty.call(porUrl, u) ? porUrl[u] : null; }
export function mapaDeRemotas(urls, porUrl) {
  const m = {}; for (const u of new Set(urls)) { const l = arquivoCapturado(porUrl, u); if (l) m[u] = l; } return m;
}
// enderecos remotos que o normalizar vai encontrar (atributos, imagem escolhida do srcset, fundo calculado)
export function remotasNaPagina() {
  const out = new Set(); const add = (u) => { try { const x = new URL(u, location.href); if (/^https?:$/.test(x.protocol) && x.origin !== location.origin) out.add(x.href); } catch { /* nada */ } };
  for (const el of document.querySelectorAll('*')) {
    for (const a of ['src', 'href', 'poster', 'data-src', 'xlink:href']) { const v = el.getAttribute(a); if (v && !v.startsWith('#')) add(v); }
    const ss = el.getAttribute('srcset'); if (ss) for (const c of ss.split(',')) add(c.trim().split(/\s+/)[0]);
    if (el.currentSrc) add(el.currentSrc);
    const cs = getComputedStyle(el); for (const bg of [cs.backgroundImage, cs.maskImage]) if (bg && bg !== 'none') for (const m of bg.matchAll(/url\("?(.*?)"?\)/g)) add(m[1]);   // mascara tambem (Astra r5)
  }
  return Array.from(out);
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
    const porUrl = mapaDaCaptura(await readFile(path.join(captura, 'index.html'), 'utf8').catch(() => ''));
    // sem rede, MAS o que a captura guardou e servido: o site que monta o endereco da imagem enquanto roda
    // acha o arquivo (sem isso o Framer troca a imagem por um aviso de erro e o aviso entra no esqueleto)
    await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, async (r) => {
      const l = arquivoCapturado(porUrl, r.request().url()); if (!l || !existsSync(path.join(captura, l))) return r.abort();
      let contentType; try { contentType = JSON.parse(await readFile(path.join(captura, `${l}.uncraft-meta.json`), 'utf8')).contentType; } catch { contentType = undefined; }
      return r.fulfill({ path: path.join(captura, l), contentType });
    });
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
    const remotas = mapaDeRemotas(await page.evaluate(remotasNaPagina), porUrl);
    const r = await page.evaluate(normalizar, { remotas });
    r.relatorio.remotasLocalizadas = Object.keys(remotas).length;
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
      if (modo.includes('ix3') || modo.includes('decl') || modo === 'todos') {   // Astra: `decl` chamado sozinho nao lia o IX3
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
      // caminho 2 para GSAP: as animacoes VIVAS do site (sem gsap na pagina = nada)
      let gs = null; let relGs = null;
      if (modo.includes('gsap') || modo.includes('decl') || modo === 'todos') {
        const lido = await page.evaluate(lerGsapNaPagina, { mapaPartes, controle: CONTROLE_GSAP });
        if (lido.erro) relGs = { erro: lido.erro }; else { gs = fichasDoGsap(lido); relGs = gs.relatorio; }
      }
      const seq = fichasDeSequencia({ ...gravacao, mapa, origem });
      for (const a of seq.arquivos) { const de = path.join(captura, a); if (!existsSync(de)) { seq.relatorio.quadrosFaltando += 1; continue; } const para = path.join(saida, a); await mkdir(path.dirname(para), { recursive: true }); await copyFile(de, para); }
      // Lottie: o conteiner canonico sai vazio; o tocador desenha (src ja reescrito para o pacote)
      const lot = [...html.matchAll(/<[a-z]+ id="([^"]+)"[^>]*\sdata-src="([^"]+\.json)"/gi)].map((m) => ({ id: m[1], src: m[2] }));
      const lottie = lot.map((l) => ({ id: `m-lottie-${l.id}`, tipo: 'lottie', alvo: '#' + l.id, src: l.src, motor: { tipo: 'tempo' } }));
      // declarativo = o que o site DECLARA (IX3 do Webflow) ou executa como dado vivo (GSAP)
      const declarativas = (m) => [...((m.includes('ix3') || m.includes('decl')) && ix ? ix.fichas : []), ...((m.includes('gsap') || m.includes('decl')) && gs ? gs.fichas : [])];
      const programa = (m) => {
        const fs = [...declarativas(m)];
        let retiradas = 0;
        if (m.includes('leitura')) {
          const doIx = new Set(declarativas(m).flatMap((f) => [].concat(f.alvo)));
          const ficam = leit.fichas.filter((f) => ![].concat(f.alvo).some((a) => doIx.has(a)));
          retiradas = leit.fichas.length - ficam.length; fs.push(...ficam);
        }
        fs.push(...seq.fichas, ...lottie);
        return { fichas: fs, retiradas };
      };
      const modos = modo === 'todos' ? ['leitura', 'ix3', 'gsap', 'decl', 'decl+leitura'] : [modo];
      const porModo = {};
      for (const m of modos) {
        const p = programa(m); porModo[m] = { fichas: p.fichas.length, retiradasDaLeituraPorIx3: p.retiradas };
        await writeFile(path.join(saida, modo === 'todos' ? `motion.${m}.json` : 'motion.json'), JSON.stringify({ versao: 0, fichas: p.fichas }, null, 1));
        if (modo === 'todos' && m === 'leitura') await writeFile(path.join(saida, 'motion.json'), JSON.stringify({ versao: 0, fichas: p.fichas }, null, 1));
      }
      const rm = { modo, porModo, leitura: leit.relatorio, ...(relIx ? { ix3: relIx } : {}), ...(relGs ? { gsap: relGs } : {}), sequencias: seq.relatorio };
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
