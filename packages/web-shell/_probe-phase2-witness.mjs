// WITNESS fase-2 timeline (step-edit por rawEntryIndex): GSAP 3.15 REAL +
// bridge real, e2e via apply-patch. Design-lock Sol r0–r3.
// Cenários: steps[] com offsets reais (stretch da tl embutida), step edit
// intermediário + rollback verbatim + render (segmento anterior intacto),
// run congelado recusado, endereçamento raw com prop ausente, LIFO
// step×retarget, zero-dur (offsets duplicados + edit limpo), colisão com o
// end isolada pelo índice congelado.
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
import { getRuntimeBridgeSource } from './lib/motion-editor/runtime-bridge-source.js';

const gsapSrc = readFileSync('/Users/adilsonporto/Desktop/IA/Unspirit-Clone-1to1/site/assets/gsap/3.15.0/gsap.min.js', 'utf8');
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const ids = ['st', 'ed', 'hold', 'raw', 'lifo', 'zd', 'col', 'px', 'ap'];
await page.setContent(ids.map((id) => `<div id="${id}" style="width:50px;height:50px"></div>`).join(''));
await page.addScriptTag({ content: gsapSrc });
await page.evaluate(() => {
  /* eslint-disable no-undef */
  gsap.to('#st', { keyframes: [{ x: 100 }, { x: 200 }, { x: 300 }], duration: 300 });
  gsap.to('#ed', { keyframes: [{ x: 100 }, { x: 200 }, { x: 300 }], duration: 300 });
  gsap.to('#hold', { keyframes: [{ x: 100 }, { x: 200 }, { x: 200 }], duration: 300 });
  gsap.to('#raw', { keyframes: [{ x: 100 }, { opacity: 0.5 }, { x: 300 }], duration: 300 });
  gsap.to('#lifo', { keyframes: [{ x: 100 }, { x: 200 }, { x: 300 }], duration: 300 });
  gsap.to('#zd', { keyframes: [{ x: 100, duration: 1 }, { x: 200, duration: 0 }, { x: 300, duration: 1 }] });
  gsap.to('#col', { keyframes: [{ x: 100 }, { x: 200 }, { x: 300 }], duration: 300 });
  gsap.to('#px', { keyframes: [{ x: '100px' }, { x: '200px' }, { x: '300px' }], duration: 300 });
  gsap.to('#ap', { keyframes: [{ x: 100, attr: { parent: 'A' } }, { x: 200 }, { x: 300 }], duration: 300 });
});

const captured = await page.evaluate((src) => {
  /* eslint-disable no-undef */
  const messages = [];
  window.postMessage = (message) => messages.push(message);
  window.eval(src);
  const grab = (domId) => {
    document.getElementById(domId).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    const sel = messages.filter((m) => m.type === 'selection-changed').pop();
    return sel?.payload?.element ? { uncraftId: sel.payload.element.id, motion: sel.payload.element.motion } : { error: 'no selection' };
  };
  const tweenOf = (domId) => gsap.globalTimeline.getChildren(true, true, true)
    .find((t) => t.targets?.().includes(document.getElementById(domId)));
  const xPath = (domId, steps) => {
    const tween = tweenOf(domId);
    return steps.map((p) => { tween.progress(p, true); return gsap.getProperty(document.getElementById(domId), 'x'); });
  };
  const sendStep = (grabbed, motionId, property, entryIndex, value) => {
    // Como a UI real: o token vem da exposição corrente (steps[]) do motion.
    const motionClip = (grabbed.motion || []).find((clip) => clip.id === motionId);
    const track = motionClip?.tracks?.find((candidate) => candidate.property === property);
    const token = track?.steps?.find((step) => step.entryIndex === entryIndex)?.token;
    window.dispatchEvent(new MessageEvent('message', {
      source: window,
      data: {
        protocol: 'uncraft-motion-editor/v1', source: 'host', type: 'apply-patch',
        payload: { patch: {
          elementId: grabbed.uncraftId, kind: 'motion', motionId,
          property: `keyframeStep.${property}`,
          before: { entryIndex, token, value: '', exists: true },
          value: { entryIndex, token, value, exists: true },
        } },
      },
    }));
  };
  const sendRetarget = (grabbed, motion, before, value) => window.dispatchEvent(new MessageEvent('message', {
    source: window,
    data: {
      protocol: 'uncraft-motion-editor/v1', source: 'host', type: 'apply-patch',
      payload: { patch: {
        elementId: grabbed.uncraftId, kind: 'motion', motionId: motion.id,
        property: 'retarget.final',
        before: { schemaVersion: 2, semanticProperty: 'translateX', runtimeProperty: 'x', value: before },
        value: { schemaVersion: 2, semanticProperty: 'translateX', runtimeProperty: 'x', value,
          writeModel: 'absolute', responsiveScope: 'shared',
          owner: { channelId: `${motion.id}:translateX`, motionId: motion.id },
          keyframe: { position: 'final-existing' } },
      } },
    },
  }));
  const entriesX = (domId) => tweenOf(domId).vars.keyframes.map((k) => (k.css ? k.css.x : k.x));
  const out = {};

  // [st] steps[] expostos com offsets reais (tl embutida 1.5 com stretch → 1/3, 2/3, 1)
  {
    const grabbed = grab('st');
    const motion = grabbed.motion[0];
    const track = motion.tracks.find((t) => t.property === 'x');
    out.stSteps = track.steps || null;
  }
  // [ed] step edit intermediário: render limpo + rollback verbatim
  {
    const grabbed = grab('ed');
    const motion = grabbed.motion[0];
    out.edBefore = xPath('ed', [0, 1 / 6, 1 / 3, 1 / 2, 2 / 3, 5 / 6, 1]);
    sendStep(grabbed, motion.id, 'x', 1, '500');
    out.edEntries = entriesX('ed');
    out.edAfter = xPath('ed', [0, 1 / 6, 1 / 3, 1 / 2, 2 / 3, 5 / 6, 1]);
    sendStep(grabbed, motion.id, 'x', 1, '200');
    out.edEntriesRestored = entriesX('ed');
    out.edTypesRestored = tweenOf('ed').vars.keyframes.map((k) => typeof k.x);
    out.edPathRestored = xPath('ed', [0, 1 / 6, 1 / 3, 1 / 2, 2 / 3, 5 / 6, 1]);
  }
  // [hold] membros do run congelado recusam
  {
    const grabbed = grab('hold');
    const motion = grabbed.motion[0];
    sendStep(grabbed, motion.id, 'x', 1, '250');
    sendStep(grabbed, motion.id, 'x', 2, '250');
    out.holdEntries = entriesX('hold');
  }
  // [raw] endereçamento raw: idx1 (opacity) recusa pra x; idx0 edita
  {
    const grabbed = grab('raw');
    const motion = grabbed.motion[0];
    sendStep(grabbed, motion.id, 'x', 1, '150');
    out.rawAfterBadIndex = tweenOf('raw').vars.keyframes.map((k) => ({ x: k.x, o: k.opacity }));
    sendStep(grabbed, motion.id, 'x', 0, '150');
    out.rawAfterGoodIndex = tweenOf('raw').vars.keyframes.map((k) => ({ x: k.x, o: k.opacity }));
  }
  // [lifo] journal separado: step → retarget → undo retarget → undo step
  {
    const grabbed = grab('lifo');
    const motion = grabbed.motion[0];
    sendStep(grabbed, motion.id, 'x', 1, '500');
    out.lifo1 = entriesX('lifo');
    sendRetarget(grabbed, motion, '300', '350');
    out.lifo2 = entriesX('lifo');
    sendRetarget(grabbed, motion, '350', '300');
    out.lifo3 = entriesX('lifo');
    sendStep(grabbed, motion.id, 'x', 1, '200');
    out.lifo4 = entriesX('lifo');
    out.lifoTypes = tweenOf('lifo').vars.keyframes.map((k) => typeof k.x);
  }
  // [zd] zero-dur: offsets duplicados nos steps + edit por índice limpo
  {
    const grabbed = grab('zd');
    const motion = grabbed.motion[0];
    const track = motion.tracks.find((t) => t.property === 'x');
    out.zdSteps = track.steps || null;
    sendStep(grabbed, motion.id, 'x', 1, '800');
    out.zdEntries = entriesX('zd');
    const tween = tweenOf('zd');
    out.zdRender = [0.45, 0.55, 1].map((p) => { tween.progress(p, true); return gsap.getProperty(document.getElementById('zd'), 'x'); });
    sendStep(grabbed, motion.id, 'x', 1, '200');
    out.zdRestored = entriesX('zd');
  }
  // [col] colisão com o end: edit idx1 → 300 (== end); rollback exato pelo índice
  {
    const grabbed = grab('col');
    const motion = grabbed.motion[0];
    sendStep(grabbed, motion.id, 'x', 1, '300');
    out.col1 = entriesX('col');
    sendStep(grabbed, motion.id, 'x', 1, '200');
    out.col2 = entriesX('col');
  }
  // [px] pré-simulação (Sol r5): '250' cross-unit recusa ANTES de mutar;
  // '250px' escreve e o rollback restaura verbatim
  {
    const grabbed = grab('px');
    const motion = grabbed.motion[0];
    sendStep(grabbed, motion.id, 'x', 1, '250');
    out.pxRefused = entriesX('px');
    sendStep(grabbed, motion.id, 'x', 1, '250px');
    out.pxWritten = entriesX('px');
    sendStep(grabbed, motion.id, 'x', 1, '200px');
    out.pxRestored = entriesX('px');
  }
  // [ap] Sol r30: attr.parent é DADO — mutação pós-exposição recusa o patch
  // retido antes de journal/mutação/invalidate; re-inspeção destrava.
  {
    const grabbed = grab('ap');
    const motion = grabbed.motion[0];
    const tween = tweenOf('ap');
    tween.vars.keyframes[0].attr.parent = 'B';
    sendStep(grabbed, motion.id, 'x', 0, '150');
    out.apRefused = entriesX('ap');
    out.apAttr = tween.vars.keyframes[0].attr.parent;
    const regrabbed = grab('ap');
    sendStep(regrabbed, regrabbed.motion[0].id, 'x', 0, '150');
    out.apApplied = entriesX('ap');
  }
  return out;
}, getRuntimeBridgeSource());

await browser.close();

let failures = 0;
const check = (label, ok, detail) => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
};
const close = (a, b) => Math.abs(a - b) < 0.02;

console.log('[st] steps[] expostos (offsets reais 1/3, 2/3, 1)');
check('3 steps com entryIndex 0/1/2', JSON.stringify((captured.stSteps || []).map((s) => s.entryIndex)) === '[0,1,2]', JSON.stringify(captured.stSteps));
check('offsets 1/3, 2/3, 1', captured.stSteps && close(captured.stSteps[0].offset, 1 / 3) && close(captured.stSteps[1].offset, 2 / 3) && close(captured.stSteps[2].offset, 1), JSON.stringify((captured.stSteps || []).map((s) => s.offset)));
check('valores autorais', JSON.stringify((captured.stSteps || []).map((s) => s.value)) === '["100","200","300"]', JSON.stringify((captured.stSteps || []).map((s) => s.value)));

console.log('\n[ed] step edit intermediário: render + rollback verbatim');
check('baseline [0,50,100,150,200,250,300]', JSON.stringify(captured.edBefore) === '[0,50,100,150,200,250,300]', JSON.stringify(captured.edBefore));
check('entradas [100,500,300]', JSON.stringify(captured.edEntries) === '[100,500,300]', JSON.stringify(captured.edEntries));
check('render pós-edit: segmento ANTERIOR intacto + ramps novos', JSON.stringify(captured.edAfter) === '[0,50,100,300,500,400,300]', JSON.stringify(captured.edAfter));
check('rollback verbatim [100,200,300] (números)', JSON.stringify(captured.edEntriesRestored) === '[100,200,300]' && JSON.stringify(captured.edTypesRestored) === '["number","number","number"]', JSON.stringify({ entries: captured.edEntriesRestored, types: captured.edTypesRestored }));
check('render restaurado byte-a-byte', JSON.stringify(captured.edPathRestored) === JSON.stringify(captured.edBefore), JSON.stringify(captured.edPathRestored));

console.log('\n[hold] run congelado recusa steps individuais');
check('entradas intactas [100,200,200]', JSON.stringify(captured.holdEntries) === '[100,200,200]', JSON.stringify(captured.holdEntries));

console.log('\n[raw] endereçamento por índice RAW');
check('idx1 (sem x) recusa — nada escrito', JSON.stringify(captured.rawAfterBadIndex) === JSON.stringify([{ x: 100 }, { o: 0.5 }, { x: 300 }].map((v) => ({ x: v.x, o: v.o }))), JSON.stringify(captured.rawAfterBadIndex));
check('idx0 edita x=150, opacity intacta', captured.rawAfterGoodIndex[0].x === 150 && captured.rawAfterGoodIndex[1].o === 0.5 && captured.rawAfterGoodIndex[2].x === 300, JSON.stringify(captured.rawAfterGoodIndex));

console.log('\n[lifo] journal separado step×retarget');
check('step: [100,500,300]', JSON.stringify(captured.lifo1) === '[100,500,300]', JSON.stringify(captured.lifo1));
check('retarget: [100,500,350]', JSON.stringify(captured.lifo2) === '[100,500,350]', JSON.stringify(captured.lifo2));
check('undo retarget: [100,500,300]', JSON.stringify(captured.lifo3) === '[100,500,300]', JSON.stringify(captured.lifo3));
check('undo step: [100,200,300] verbatim', JSON.stringify(captured.lifo4) === '[100,200,300]' && JSON.stringify(captured.lifoTypes) === '["number","number","number"]', JSON.stringify({ entries: captured.lifo4, types: captured.lifoTypes }));

console.log('\n[zd] zero-dur: offsets duplicados, edit por índice limpo');
check('offsets 0.5, 0.5, 1 (endpoint duplicado)', captured.zdSteps && close(captured.zdSteps[0].offset, 0.5) && close(captured.zdSteps[1].offset, 0.5) && close(captured.zdSteps[2].offset, 1), JSON.stringify((captured.zdSteps || []).map((s) => s.offset)));
check('edit idx1 → [100,800,300]', JSON.stringify(captured.zdEntries) === '[100,800,300]', JSON.stringify(captured.zdEntries));
check('render jump-cut editado (~100 antes, ~800 depois, 300 no fim)', close(captured.zdRender[0] / 100, captured.zdRender[0] / 100) && captured.zdRender[0] <= 101 && captured.zdRender[1] >= 300 && captured.zdRender[2] === 300, JSON.stringify(captured.zdRender));
check('rollback [100,200,300]', JSON.stringify(captured.zdRestored) === '[100,200,300]', JSON.stringify(captured.zdRestored));

console.log('\n[col] colisão com o end isolada pelo índice congelado');
check('edit idx1=300 (colide): [100,300,300]', JSON.stringify(captured.col1) === '[100,300,300]', JSON.stringify(captured.col1));
check('rollback exato [100,200,300] — nunca o run recomputado', JSON.stringify(captured.col2) === '[100,200,300]', JSON.stringify(captured.col2));

console.log('\n[px] pré-simulação cross-unit (Sol r5)');
check("'250' (sem unidade) recusa antes de mutar", JSON.stringify(captured.pxRefused) === '["100px","200px","300px"]', JSON.stringify(captured.pxRefused));
check("'250px' escreve", JSON.stringify(captured.pxWritten) === '["100px","250px","300px"]', JSON.stringify(captured.pxWritten));
check("rollback '200px' verbatim", JSON.stringify(captured.pxRestored) === '["100px","200px","300px"]', JSON.stringify(captured.pxRestored));

console.log('\n[ap] attr.parent como DADO no shape (Sol r30)');
check('mutação pós-exposição recusa o patch retido', JSON.stringify(captured.apRefused) === '[100,200,300]' && captured.apAttr === 'B', JSON.stringify({ entries: captured.apRefused, attr: captured.apAttr }));
check('re-inspeção destrava (x=150)', JSON.stringify(captured.apApplied) === '[150,200,300]', JSON.stringify(captured.apApplied));

console.log(failures === 0 ? '\nWITNESS: TUDO VERDE' : `\nWITNESS: ${failures} FALHAS`);
process.exit(failures === 0 ? 0 : 1);
