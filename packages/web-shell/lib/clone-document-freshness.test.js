import { describe, it, expect } from 'vitest';
import {
  STALE_CLONE_DOCUMENT, MISSING_CLONE_DOCUMENT, cloneDocumentFreshness,
  assertRunPreconditions, motionTransactionCount,
} from './clone-document-freshness.js';

const BUNDLE = '11111111-2222-4333-8444-555555555555';

describe('o documento do clone contra o runtime', () => {
  const semSessao = async () => [];

  it('sem bundle nao ha duas autoridades', async () => {
    expect(cloneDocumentFreshness({ html: '<html>' })).toEqual({ stale: false, edits: 0 });
    await expect(assertRunPreconditions({ sql: semSessao, nodes: [{ id: 'n', html: null }] })).resolves.toBeUndefined();
  });

  it('clone recem-feito, sem sessao aberta, passa', async () => {
    await expect(assertRunPreconditions({
      sql: semSessao,
      nodes: [{ id: 'n', native_bundle_id: BUNDLE, html: '<html>', motion_manifest: { transactions: [] } }],
    })).resolves.toBeUndefined();
  });

  it('documento AUSENTE recusa — senao a rota compoe de pagina em branco', async () => {
    await expect(assertRunPreconditions({
      sql: semSessao,
      nodes: [{ id: 'n', native_bundle_id: BUNDLE, html: null, papel: 'target' }],
    })).rejects.toMatchObject({ code: MISSING_CLONE_DOCUMENT, role: 'target' });
  });

  it('edicao ja absorvida no snapshot recusa', async () => {
    await expect(assertRunPreconditions({
      sql: semSessao,
      nodes: [{ id: 'n', native_bundle_id: BUNDLE, html: '<html>', motion_manifest: { transactions: [{}, {}] }, papel: 'target' }],
    })).rejects.toMatchObject({ code: STALE_CLONE_DOCUMENT, edits: 2 });
  });

  // ⭐ O autosave grava no rascunho da SESSAO, sem tocar no snapshot. Sem esta
  // pergunta ao banco, quem esta' editando agora passaria como "em dia" e veria
  // o trabalho vivo ser sobrescrito.
  it('rascunho VIVO na sessao recusa, mesmo com o snapshot zerado', async () => {
    const comSessao = async () => [{ node_id: 'n', edits: 3 }];
    await expect(assertRunPreconditions({
      sql: comSessao,
      nodes: [{ id: 'n', native_bundle_id: BUNDLE, html: '<html>', motion_manifest: { transactions: [] }, papel: 'target' }],
    })).rejects.toMatchObject({ code: STALE_CLONE_DOCUMENT, edits: 3, open: true });
  });

  // Uma FONTE com bundle tambem entrega HTML pre-edicao — o Sol pegou que so' o
  // alvo estava sendo checado.
  it('a FONTE tambem e checada, nao so o alvo', async () => {
    await expect(assertRunPreconditions({
      sql: semSessao,
      nodes: [
        { id: 'alvo', native_bundle_id: BUNDLE, html: '<html>', motion_manifest: { transactions: [] }, papel: 'target' },
        { id: 'fonte', native_bundle_id: BUNDLE, html: '<html>', motion_manifest: { transactions: [{}] }, papel: 'source' },
      ],
    })).rejects.toMatchObject({ code: STALE_CLONE_DOCUMENT, nodeId: 'fonte', role: 'source' });
  });


  it('le o manifesto tambem quando ele vem como texto do banco', () => {
    expect(motionTransactionCount(JSON.stringify({ transactions: [{}, {}, {}] }))).toBe(3);
    expect(motionTransactionCount('nao e json')).toBe(0);
    expect(motionTransactionCount(null)).toBe(0);
    expect(motionTransactionCount({ transactions: 'nao e lista' })).toBe(0);
  });
});

// O portao recebe nodes de duas formas (alvo traz `current_html`, fonte traz
// `source_html`). Normalizar e' responsabilidade de quem chama — e este teste
// prende que o portao le SEMPRE `html`, para o erro aparecer no chamador e nao
// virar uma recusa misteriosa em producao.
describe('o portao le um campo so', () => {
  it('recusa quando o documento nao foi normalizado para `html`', async () => {
    await expect(assertRunPreconditions({
      sql: async () => [],
      nodes: [{ id: 'n', native_bundle_id: BUNDLE, current_html: '<html>', papel: 'target' }],
    })).rejects.toMatchObject({ code: MISSING_CLONE_DOCUMENT });
  });
});
