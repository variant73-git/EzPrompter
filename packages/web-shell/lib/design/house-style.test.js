import { describe, expect, it } from 'vitest';
import { buildAbsorb, buildGuardrails, buildHouseStyle, buildInvent } from './house-style.js';

describe('house style reference decomposition', () => {
  it('treats exact type metrics and mobile behavior as ground truth', () => {
    const guardrails = buildGuardrails();
    expect(guardrails).toContain('letter-spacing and line-height as measured source data');
    expect(guardrails).toContain('Mobile quality is a hard gate');
    expect(guardrails).not.toContain('Eyebrows in particular never widen');
  });

  it('separates reusable structure from replaceable treatment', () => {
    const absorb = buildAbsorb();
    expect(absorb).toContain('reusable structure');
    expect(absorb).toContain('replaceable treatment');
    expect(absorb).toContain('within 15%');
    expect(absorb).toContain('choose one scale owner');
    expect(absorb).toContain('independently chosen ingredients');
  });

  it('uses the new macro priorities for sparse invention', () => {
    const invent = buildInvent();
    expect(invent).toContain('large media with anchored text');
    expect(invent).toContain('remain strong on mobile');
    expect(invent).toContain('brand personality separately from business category');
    expect(invent).toContain('structure + text composition/alignment + palette + typography + motion');
  });
});

// O interruptor geral existe para uma pergunta de produto do Adilson: as regras de
// gosto e o banco de referencias se SOMAM ou CONFLITAM? So da para responder isso
// rodando a mesma geracao com as regras ligadas e desligadas e comparando. Sem um
// desligamento total, a comparacao nao existe.
describe('interruptor geral das regras', () => {
  it('desliga tudo de uma vez, sem precisar listar 39 ids', () => {
    expect(buildHouseStyle({ allOff: true })).toBe('');
    expect(buildGuardrails({ allOff: true })).toBe('');
    expect(buildAbsorb({ allOff: true })).toBe('');
    expect(buildInvent({ allOff: true })).toBe('');
  });

  it('nao deixa cabecalho orfao quando nao sobra criterio nenhum', () => {
    // O texto vai direto para dentro do prompt: um cabecalho sozinho, sem regras
    // embaixo, seria instrucao vazia enviada ao modelo.
    expect(buildGuardrails({ allOff: true })).not.toMatch(/GUARDRAILS/);
  });

  it('ligado, continua entregando as regras', () => {
    expect(buildHouseStyle().length).toBeGreaterThan(500);
  });
});
