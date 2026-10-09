import { describe, expect, it } from 'vitest';
import { EDIT_ROUTE } from '../edit-action-decision.js';
import { applyReconstructionResultToNode } from '../node-editor-kind.js';
import { CANONICAL_ENTRY, canonicalEditClientEnabled, openWhenReady, planCanonicalEntry, readyNodeFrom } from './edit-entry.js';

const site = (source) => ({ kind: 'site', current_snapshot_source: source });

describe('Edit com a cópia editável', () => {
  it('interruptor do canvas', () => {
    expect(canonicalEditClientEnabled('1')).toBe(true);
    expect(canonicalEditClientEnabled('true')).toBe(true);
    expect(canonicalEditClientEnabled('')).toBe(false);
    expect(canonicalEditClientEnabled(undefined)).toBe(false);
  });

  it('desligado ou com motor nominal: fluxo de hoje', () => {
    expect(planCanonicalEntry({ node: site('native-bundle'), route: EDIT_ROUTE.OPEN, enabled: false })).toBe(CANONICAL_ENTRY.OFF);
    expect(planCanonicalEntry({ node: site(null), route: EDIT_ROUTE.RECONSTRUCT, engine: 'iter9', enabled: true })).toBe(CANONICAL_ENTRY.OFF);
  });

  it('captura nativa nunca editada: prepara a cópia', () => {
    expect(planCanonicalEntry({ node: site('native-bundle'), route: EDIT_ROUTE.OPEN, enabled: true })).toBe(CANONICAL_ENTRY.PREPARE);
  });

  it('sem captura ainda: captura e depois prepara', () => {
    expect(planCanonicalEntry({ node: site('capture'), route: EDIT_ROUTE.RECONSTRUCT, enabled: true })).toBe(CANONICAL_ENTRY.CAPTURE_THEN_PREPARE);
  });

  it('já é a cópia, ou já tem edições no nativo: abre como hoje', () => {
    expect(planCanonicalEntry({ node: site('canonical'), route: EDIT_ROUTE.OPEN, enabled: true })).toBe(CANONICAL_ENTRY.OFF);
    expect(planCanonicalEntry({ node: site('native-edit'), route: EDIT_ROUTE.OPEN, enabled: true })).toBe(CANONICAL_ENTRY.OFF);
  });

  it('rotas de bloqueio seguem como hoje', () => {
    for (const route of [EDIT_ROUTE.REPAIR_NEEDED, EDIT_ROUTE.PLAN_REQUIRED, EDIT_ROUTE.NATIVE_UNAVAILABLE]) {
      expect(planCanonicalEntry({ node: site('native-bundle'), route, enabled: true })).toBe(CANONICAL_ENTRY.OFF);
    }
  });

  it('só tipos que abrem no editor nativo', () => {
    expect(planCanonicalEntry({ node: { kind: 'image', current_snapshot_source: 'native-bundle' }, route: EDIT_ROUTE.OPEN, enabled: true })).toBe(CANONICAL_ENTRY.OFF);
  });

  it('a cópia que chega minutos depois mantém a posição para onde o usuário moveu o node', () => {
    const clicado = { id: 'n1', kind: 'site', pos_x: 0, pos_y: 0, current_snapshot_source: 'native-bundle', meta: {} };
    const atual = { ...clicado, pos_x: 900, pos_y: 400, meta: { name: 'Renamed' } };
    const result = { kind: 'native', snapshotId: 's2', snapshotSource: 'canonical', bundleDescriptor: { bundleId: 'b2' }, motionManifest: { schemaVersion: 2 } };
    const pronto = readyNodeFrom([atual], clicado, result, applyReconstructionResultToNode);
    expect(pronto).toMatchObject({ pos_x: 900, pos_y: 400, current_snapshot_source: 'canonical', current_native_bundle_id: 'b2' });
    expect(pronto.meta.name).toBe('Renamed');
    expect(readyNodeFrom([], clicado, result, applyReconstructionResultToNode).pos_x).toBe(0);
  });

  it('a cópia que fica pronta NÃO abre por cima de outro node em edição (revisão final, Claude)', () => {
    expect(openWhenReady({ editingNodeId: null, nodeId: 'n1' })).toBe(true);
    expect(openWhenReady({ editingNodeId: 'n2', nodeId: 'n1' })).toBe(false);
    expect(openWhenReady({ editingNodeId: 'n1', nodeId: 'n1' })).toBe(false);
  });
});

