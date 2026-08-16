import { describe, expect, it } from 'vitest';
import { decodeReferenceGuidance, encodeReferenceGuidance } from './reference-guidance.js';

describe('reference curation guidance', () => {
  it('round-trips worth-borrowing and avoid guidance in the existing notes field', () => {
    const stored = encodeReferenceGuidance({
      worthBorrowing: 'Section rhythm and transparent media placement.',
      avoid: 'The WebGL hero distortion.',
    });
    expect(decodeReferenceGuidance(stored)).toEqual({
      worthBorrowing: 'Section rhythm and transparent media placement.',
      avoid: 'The WebGL hero distortion.',
    });
  });

  it('treats legacy free-form notes as worth-borrowing guidance', () => {
    expect(decodeReferenceGuidance('Preserve the pinned hero.')).toEqual({
      worthBorrowing: 'Preserve the pinned hero.',
      avoid: '',
    });
  });
});
