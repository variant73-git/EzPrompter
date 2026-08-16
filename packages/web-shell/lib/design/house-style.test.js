import { describe, expect, it } from 'vitest';
import {
  buildAbsorb,
  buildGuardrails,
  buildHouseStyle,
  buildHouseStyleFromEnv,
  buildInvent,
  houseStyleMode,
  listCriteria,
} from './house-style.js';

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

  // MEDIDO 2026-08-13: `allOff` desliga 37 guardrails MAIS o bloco ABSORB — e o
  // ABSORB e a doutrina de referencia ("REFERENCE USE — preserve section
  // topology, alignment and anchoring logic, media-to-copy proportions"), o
  // mesmo vocabulario do plano do banco de referencias. Comparar "regras
  // ligadas x desligadas" com esse interruptor tira, junto, COMO usar uma
  // referencia: os dois lados do 2x2 passam a diferir em mais de uma coisa.
  const soGuardrailsFora = () => ({
    off: listCriteria().filter((c) => c.mode === 'guardrails').map((c) => c.id),
  });

  it('isola os guardrails, mantendo a doutrina de referencia de pe', () => {
    expect(buildGuardrails(soGuardrailsFora())).toBe('');
    expect(buildAbsorb(soGuardrailsFora())).toMatch(/REFERENCE USE/);
    expect(buildInvent(soGuardrailsFora())).not.toBe('');
  });

  it('desligar so os guardrails nao e o mesmo que desligar tudo', () => {
    expect(buildHouseStyle(soGuardrailsFora())).not.toBe('');
    expect(buildHouseStyle({ allOff: true })).toBe('');
  });

  it('o modo do interruptor fica legivel, para rotular a comparacao', () => {
    expect(houseStyleMode({ UNCRAFT_HOUSESTYLE: 'off' })).toBe('off');
    expect(houseStyleMode({ UNCRAFT_HOUSESTYLE: 'guardrails-off' })).toBe('guardrails-off');
    expect(houseStyleMode({})).toBe('on');
    // valor que ninguem reconhece nao pode virar "desligado" em silencio
    expect(houseStyleMode({ UNCRAFT_HOUSESTYLE: 'talvez' })).toBe('on');
  });

  it('o interruptor de ambiente sabe tirar so os guardrails', () => {
    expect(buildHouseStyleFromEnv({ UNCRAFT_HOUSESTYLE: 'guardrails-off' })).toMatch(/REFERENCE USE/);
    expect(buildHouseStyleFromEnv({ UNCRAFT_HOUSESTYLE: 'guardrails-off' })).not.toMatch(/DESIGN GUARDRAILS/);
    expect(buildHouseStyleFromEnv({ UNCRAFT_HOUSESTYLE: 'off' })).toBe('');
    expect(buildHouseStyleFromEnv({})).toMatch(/DESIGN GUARDRAILS/);
  });
});
