import { describe, expect, it } from 'vitest';
import {
  normalizeLoadingStage,
  PATIENCE_SUFFIX,
  playfulLoadingMessage,
} from './loading-messages.js';

describe('playful loading messages', () => {
  it('always follows the action plus patience format', () => {
    for (const stage of ['checking', 'shy', 'launching', 'capturing', 'finalizing', 'generic']) {
      const message = playfulLoadingMessage({ nodeId: `node-${stage}`, stage, kind: 'site' });
      expect(message.endsWith(PATIENCE_SUFFIX)).toBe(true);
      expect(message.length).toBeGreaterThan(PATIENCE_SUFFIX.length + 4);
    }
  });

  it('keeps a randomized choice stable for a node and stage', () => {
    const input = { nodeId: 'node-42', stage: 'capturing', kind: 'site' };
    expect(playfulLoadingMessage(input)).toBe(playfulLoadingMessage(input));
  });

  it('maps real progress labels to playful stage families', () => {
    expect(normalizeLoadingStage('Checking embed policy', 'site')).toBe('checking');
    expect(normalizeLoadingStage('iframe-blocked', 'site')).toBe('shy');
    expect(normalizeLoadingStage('thumbnailing', 'site')).toBe('thumbnailing');
    expect(normalizeLoadingStage('generating', 'image')).toBe('image');
  });
});
