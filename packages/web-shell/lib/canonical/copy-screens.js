// Telas que a cópia editável MOSTRADA pelo node tem (spec 2026-10-19 §5.3, T1). A cópia é gravada numa tela só
// (o estilo serializado é o calculado), então nas outras ela transbordaria: os botões delas ficam desligados com o
// motivo. Duas fontes, as duas amarradas à cópia e não ao node:
//   - `meta.canonicalCopies[bundleId]`: cada publicação JUNTA a sua (restaurar uma cópia antiga continua travado —
//     Astra r2 #1); só vale enquanto o node mostra aquele pacote. Reset para o clone original troca o pacote, e o
//     original se adapta a qualquer tela, então nada fica travado por engano;
//   - a própria página, que declara a tela em `<html data-u-tela>` (o node duplicado vira página comum, sem pacote,
//     com o HTML da cópia — Astra r2 #2).
import { MOTION_EDITOR_DEVICE_ORDER, MOTION_EDITOR_DEVICES } from '../motion-editor/devices.js';

export const CANONICAL_SCREENS = Object.freeze(['desktop']);

export const DESKTOP_ONLY_NOTICE = 'This editable copy was prepared for desktop only';

export function canonicalCopyMeta(bundleId) {
  return { canonicalCopies: { [bundleId]: { screens: [...CANONICAL_SCREENS] } } };
}

const objeto = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

export function mergeCanonicalCopies(meta, novas) {
  return { ...(objeto(meta?.canonicalCopies) ? meta.canonicalCopies : {}), ...(objeto(novas) ? novas : {}) };
}

// só a abertura que NÓS escrevemos (normalizar-clone.mjs): `<!doctype html>` e a tag <html> com o atributo
const ABERTURA_DA_COPIA = /^\s*<!doctype html>\s*<html\b[^>]*\sdata-u-tela="([a-z]+)"/i;

function telaDeclarada(html) {
  if (typeof html !== 'string') return null;
  const m = ABERTURA_DA_COPIA.exec(html.slice(0, 512));
  return m ? m[1] : null;
}

export function copyScreens(node) {
  const mapa = node?.meta?.canonicalCopies;
  const pacote = node?.current_native_bundle_id;
  if (pacote && objeto(mapa) && Object.hasOwn(mapa, pacote)) {
    const telas = mapa[pacote]?.screens;
    if (Array.isArray(telas) && telas.length) return telas;
  }
  const tela = telaDeclarada(node?.current_html);
  return tela ? [tela] : null;
}

const mesmaLargura = (a, b) => Math.abs(Number(a) - Number(b)) < 4;

export function viewportChoicesForNode(node) {
  const telas = copyScreens(node);
  return MOTION_EDITOR_DEVICE_ORDER.map((id) => {
    const { label, width, height } = MOTION_EDITOR_DEVICES[id];
    const allowed = !telas || telas.includes(id);
    return {
      id, label, width, height, allowed,
      active: mesmaLargura(node?.width, width),
      title: allowed ? `${label} · ${width}px` : `${label} — ${DESKTOP_ONLY_NOTICE}`,
    };
  });
}

export function deviceAllowedForNode(node, deviceId) {
  const telas = copyScreens(node);
  return !telas || telas.includes(deviceId);
}
