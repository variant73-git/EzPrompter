import { describe, expect, it } from 'vitest';
import { normalizeBrainstormVisual, parseBrainstormMessage } from './brainstorm-visuals.js';

describe('brainstorm visual protocol', () => {
  it('extracts a bounded visual payload while preserving prose', () => {
    const content = `Which structure feels right?\n<uncraft-brainstorm>
{"kind":"structure","options":[{"id":"offset","title":"Offset editorial","fit":"Expert services","signal":"Confident, composed","reply":"I prefer the offset direction.","pattern":"offset"},{"id":"split","title":"Balanced split","fit":"Product stories","signal":"Clear, practical","reply":"I prefer the split direction.","pattern":"split"}]}
</uncraft-brainstorm>`;
    const parsed = parseBrainstormMessage(content);
    expect(parsed.text).toBe('Which structure feels right?');
    expect(parsed.visual.kind).toBe('structure');
    expect(parsed.visual.options).toHaveLength(2);
    expect(parsed.visual.options[0].pattern).toBe('offset');
  });

  it('hides incomplete protocol data while a response streams', () => {
    expect(parseBrainstormMessage('Choose one.\n<uncraft-brainstorm>\n{"kind"').text).toBe('Choose one.');
  });

  it('rejects arbitrary colors and caps choices at three', () => {
    const visual = normalizeBrainstormVisual({
      kind: 'palette',
      options: [
        { title: 'One', fit: 'Retail', signal: 'Warm', colors: ['#112233', '#AABBCC', '#445566'], reply: 'One.' },
        { title: 'Two', fit: 'Tech', signal: 'Sharp', colors: ['red', '#000000', '#FFFFFF'], reply: 'Two.' },
        { title: 'Three', fit: 'Culture', signal: 'Bold', colors: ['#123456', '#654321', '#ABCDEF'], reply: 'Three.' },
        { title: 'Four', fit: 'Finance', signal: 'Calm', colors: ['#111111', '#222222', '#333333'], reply: 'Four.' },
      ],
    });
    expect(visual.options).toHaveLength(3);
    expect(visual.options.map((option) => option.title)).toEqual(['One', 'Three', 'Four']);
  });
});
