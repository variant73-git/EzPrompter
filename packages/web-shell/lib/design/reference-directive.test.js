import { describe, expect, it } from 'vitest';
import {
  REFERENCE_AUTHORITY,
  buildReferenceDirective,
  referencesMode,
} from './reference-directive.js';

function plano(extra = {}) {
  return {
    schemaVersion: 3,
    rule: 'No fixed roles per site. One contextual scale owner; optional references contribute bounded section structures.',
    selectedReferences: [
      {
        id: 'ref-1',
        title: 'Estúdio Vinte',
        url: 'https://estudiovinte.example',
        influence: 'scale-owner',
        scaleOwner: true,
        owns: 'page-wide type and media scale, spacing cadence, and responsive consistency',
        reasons: ['tipo em escala grande', 'ritmo de seções largo'],
      },
      {
        id: 'ref-2',
        title: 'Casa Norte',
        url: 'https://casanorte.example',
        influence: 'section-source',
        scaleOwner: false,
        owns: 'testimonial section structure',
        reasons: ['prova social em duas colunas'],
      },
    ],
    composition: {
      preserve: ['section topology and reading order', 'media-to-copy proportions'],
      adapt: ['Casa Norte: testimonial section structure'],
      replace: ['brand identity', 'copy', 'imagery'],
    },
    warnings: ['Style was not explicit; brainstorm before treating a reference family as intentional.'],
    ...extra,
  };
}

describe('referencesMode', () => {
  it('is on by default and off only when asked', () => {
    expect(referencesMode({})).toBe('on');
    expect(referencesMode({ UNCRAFT_REFERENCES: 'off' })).toBe('off');
    expect(referencesMode({ UNCRAFT_REFERENCES: 'OFF' })).toBe('off');
  });

  // Espelha a regra do interruptor das regras de gosto: um valor que ninguem
  // reconhece nao pode desligar nada em silencio.
  it('treats an unknown value as on', () => {
    expect(referencesMode({ UNCRAFT_REFERENCES: 'talvez' })).toBe('on');
  });
});

describe('buildReferenceDirective', () => {
  it('names each reference, its role and what it governs', () => {
    const texto = buildReferenceDirective(plano());
    expect(texto).toContain('Estúdio Vinte');
    expect(texto).toContain('https://estudiovinte.example');
    expect(texto).toContain('scale owner');
    expect(texto).toContain('page-wide type and media scale');
    expect(texto).toContain('Casa Norte');
  });

  it('carries the preserve / adapt / replace contract', () => {
    const texto = buildReferenceDirective(plano());
    expect(texto).toMatch(/PRESERVE[\s\S]*section topology and reading order/);
    expect(texto).toMatch(/REPLACE[\s\S]*brand identity/);
  });

  it('passes the plan warnings through instead of swallowing them', () => {
    expect(buildReferenceDirective(plano())).toContain('brainstorm before treating a reference family as intentional');
  });

  // ⭐ A pergunta de produto e se as duas fontes se somam ou se anulam. Deixar o
  // conflito ambiguo NAO e neutralidade: o modelo resolveria por conta, de um
  // jeito diferente a cada geracao, e a comparacao mediria esse sorteio. Cada
  // fonte manda numa DIMENSAO, e isso vai escrito.
  it('says which source is the authority for each dimension', () => {
    const texto = buildReferenceDirective(plano());
    expect(texto).toContain(REFERENCE_AUTHORITY);
    expect(texto).toMatch(/structure, scale, rhythm and proportion/i);
    expect(texto).toMatch(/typeface, colour and the banned details/i);
    // pedido explicito do usuario ganha das duas — ja e a regra do verificador
    expect(texto).toMatch(/explicit[\s\S]{0,80}request/i);
  });

  it('is empty when there is no plan, so nothing empty reaches the prompt', () => {
    expect(buildReferenceDirective(null)).toBe('');
    expect(buildReferenceDirective({ selectedReferences: [] })).toBe('');
  });

  // Uma referencia sem material medido e so um nome: dizer ao modelo "pareca com
  // isto" sem mostrar o que e' pedir invencao. O bloco declara o que foi medido,
  // e quando nao ha medida nenhuma ele avisa — nunca finge.
  it('declares measured evidence when there is any, and says so when there is none', () => {
    const semMedida = buildReferenceDirective(plano());
    expect(semMedida).toMatch(/no measured evidence/i);

    const comMedida = buildReferenceDirective(plano(), {
      evidence: {
        'ref-1': {
          sections: ['hero', 'features', 'testimonial'],
          typeScale: ['clamp(3rem, 6vw, 5.5rem)', '1.125rem'],
          mediaRatios: ['16:9', '4:5'],
        },
      },
    });
    expect(comMedida).toContain('hero, features, testimonial');
    expect(comMedida).toContain('clamp(3rem, 6vw, 5.5rem)');
    expect(comMedida).not.toMatch(/no measured evidence for Estúdio Vinte/i);
  });
});
