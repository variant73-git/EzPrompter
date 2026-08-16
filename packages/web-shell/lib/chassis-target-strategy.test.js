import { describe, expect, it } from 'vitest';
import { inferTargetStrategy } from './chassis-target-strategy.js';

const evidence = {
  brand: 'Amigo Secreto',
  title: 'Amigo Secreto, o site oficial do sorteio',
  description: 'Crie seu grupo, convide os amigos e faça o sorteio sem papelzinho no fim de ano.',
  headings: ['A alegria de tirar o Amigo Secreto, agora sem papelzinho.'],
  callsToAction: ['Criar meu grupo grátis'],
  counts: { visibleCharacters: 580, media: 0 },
};

describe('target strategy inference', () => {
  it('turns a short modernization prompt and target signals into a reviewable why ladder', () => {
    const strategy = inferTargetStrategy({
      prompt: 'Melhore este site antigo para parecer atual.',
      evidence,
      manifest: { reference: { url: 'https://bank-reference.example/' } },
    });

    expect(strategy.selected).toEqual({
      identityDistance: 'evolve',
      seasonality: 'translated',
      representation: 'people-system',
    });
    expect(strategy.hypotheses.map((item) => item.id)).toEqual(expect.arrayContaining([
      'recognizable-modernization',
      'seasonal-translation',
      'controlled-play',
      'visible-participation',
      'digital-ritual',
    ]));
    expect(strategy.suggestions.find((item) => item.id === 'visual-language')?.proposal).toMatch(/circular identity frames.*name pills.*directional circle controls/i);
    expect(strategy.referenceBoundary.rule).toMatch(/bank reference supplies the chassis only/i);
  });

  it('uses explicit user tokens and choices instead of silently replacing them', () => {
    const strategy = inferTargetStrategy({
      prompt: 'Use #520d33 #f97855 #f1edeb #bdeeba and make the seasonal cue evergreen.',
      evidence,
      manifest: { reference: { url: 'https://bank-reference.example/' } },
      selections: { identityDistance: 'reinvent', seasonality: 'evergreen', representation: 'identity-tokens' },
    });

    expect(strategy.suppliedPalette).toEqual(['#520D33', '#F97855', '#F1EDEB', '#BDEEBA']);
    expect(strategy.selected).toMatchObject({ identityDistance: 'reinvent', seasonality: 'evergreen', representation: 'identity-tokens' });
    expect(strategy.suggestions.find((item) => item.id === 'color')?.proposal).toContain('#520D33');
    expect(strategy.mediaPlan.mode).toBe('graphic-identities');
  });
});
