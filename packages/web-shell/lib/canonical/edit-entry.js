// O Edit com a cópia editável (spec 2026-10-09 §0/§9): a decisão é pura e consome a rota que o
// `planEditEntry` já calculou — nunca reinventa a regra de linhagem nem de plano.
import { EDIT_ROUTE } from '../edit-action-decision.js';

export const CANONICAL_ENTRY = Object.freeze({
  OFF: 'off',
  PREPARE: 'prepare',
  CAPTURE_THEN_PREPARE: 'capture-then-prepare',
});

// Mesmos tipos que `resolveNodeEditorKind` abre no editor nativo.
const EDITABLE_KINDS = new Set(['site', 'template', 'chunk']);

export function canonicalEditClientEnabled(value = process.env.NEXT_PUBLIC_CANONICAL_EDIT) {
  return /^(1|true)$/i.test(String(value || ''));
}

export function planCanonicalEntry({ node, route, engine = null, enabled }) {
  if (!enabled || engine || !node || !EDITABLE_KINDS.has(node.kind)) return CANONICAL_ENTRY.OFF;
  if (route === EDIT_ROUTE.RECONSTRUCT) return CANONICAL_ENTRY.CAPTURE_THEN_PREPARE;
  if (route === EDIT_ROUTE.OPEN && node.current_snapshot_source === 'native-bundle') return CANONICAL_ENTRY.PREPARE;
  return CANONICAL_ENTRY.OFF;
}

// A preparação leva minutos: o resultado se aplica ao node ATUAL (posição, nome, meta), nunca ao capturado no clique.
export function readyNodeFrom(latestNodes, fallbackNode, result, apply) {
  const fresh = (latestNodes || []).find((n) => n.id === fallbackNode.id) || fallbackNode;
  return apply(fresh, result);
}

// A cópia fica pronta minutos depois do clique: se a pessoa já está editando QUALQUER node, abrir esta por cima
// fecharia aquele editor sem perguntar (edições não salvas perdidas, geometria/câmera de restauração trocadas).
// Nesse caso a cópia só fica pronta no node; o próximo Edit abre direto (revisão final, Claude).
export function openWhenReady({ editingNodeId }) {
  return !editingNodeId;
}
