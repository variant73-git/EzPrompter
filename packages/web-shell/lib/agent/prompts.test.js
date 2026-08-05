import { describe, expect, it } from 'vitest';
import { BRAINSTORM_MODE, BRAINSTORM_MODE_WITH_VISUALS, withInteractionMode } from './prompts.js';

describe('agent interaction modes', () => {
  it('keeps the normal prompt untouched by default', () => {
    expect(withInteractionMode('base')).toBe('base');
  });

  it('turns brainstorming into a real no-generation discovery mode', () => {
    const prompt = withInteractionMode('base', 'brainstorm');
    expect(prompt).toContain(BRAINSTORM_MODE);
    expect(prompt).toContain('Do not create, edit, capture, or run nodes');
    expect(prompt).toContain('Ask at most one high-information question per turn');
    expect(prompt).toContain('Separate business category from brand attributes');
    expect(prompt).toContain('structure/wireframe + text-block composition and alignment + palette strategy + typography character + motion register');
    expect(prompt).toContain('mobile adaptations');
    expect(prompt).toContain(BRAINSTORM_MODE_WITH_VISUALS);
    expect(prompt).toContain('<uncraft-brainstorm>');
    expect(prompt).toContain('what it suits and what it conveys');
    expect(prompt).toContain('Use cards only when visual comparison materially helps');
  });
});
