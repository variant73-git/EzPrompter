import { describe, expect, it } from 'vitest';
import {
  canCuratePrivateReferences,
  detectWebbuilderTemplate,
  referencePrivacy,
} from './reference-privacy.js';

describe('reference template privacy', () => {
  it('marks known marketplace template URLs private by default', () => {
    expect(referencePrivacy({ url: 'https://www.framer.com/community/marketplace/templates/agentflow/' })).toMatchObject({
      isPrivate: true,
      templatePlatform: 'framer',
      automatic: true,
    });
    expect(referencePrivacy({ url: 'https://webflow.com/templates/html/example' })).toMatchObject({
      isPrivate: true,
      templatePlatform: 'webflow',
    });
  });

  it('uses explicit template provenance for a direct preview URL', () => {
    expect(referencePrivacy({
      url: 'https://agentflow.framer.ai',
      templatePlatform: 'framer',
      templateListingUrl: 'https://www.framer.com/community/marketplace/templates/agentflow/',
    })).toMatchObject({
      isPrivate: true,
      privacyReason: 'webbuilder-template',
      templatePlatform: 'framer',
    });
  });

  it('does not hide ordinary production sites merely because they use a builder', () => {
    expect(detectWebbuilderTemplate({ url: 'https://www.quantumbody.io/' })).toEqual({
      detected: false,
      platform: null,
      reason: null,
    });
    expect(referencePrivacy({
      url: 'https://example.webflow.io',
      source: { taxonomy: { builder: 'webflow' } },
    }).isPrivate).toBe(false);
  });

  it('accepts template taxonomy from future builder importers', () => {
    expect(referencePrivacy({
      url: 'https://preview.example',
      source: { taxonomy: { recordType: 'template', templatePlatform: 'aura' } },
    })).toMatchObject({ isPrivate: true, templatePlatform: 'aura' });
  });

  it('requires an allowlist in production and stays usable in local development', () => {
    const user = { email: 'adilson@example.com' };
    expect(canCuratePrivateReferences(user, { NODE_ENV: 'development' })).toBe(true);
    expect(canCuratePrivateReferences(user, { NODE_ENV: 'production' })).toBe(false);
    expect(canCuratePrivateReferences(user, {
      NODE_ENV: 'production',
      REFERENCE_CURATOR_EMAILS: 'owner@example.com, adilson@example.com',
    })).toBe(true);
  });
});
