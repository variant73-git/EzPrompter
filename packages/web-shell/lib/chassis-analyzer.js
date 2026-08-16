import { captureSnapshot } from './snapshot.js';
import { buildChassisManifest } from './chassis-manifest.js';
import { assertPublicReferenceUrl, isPrivateReferenceHost } from './public-reference-url.js';

export const CHASSIS_ANALYSIS_VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 1000 },
  { name: 'mobile', width: 390, height: 844 },
];

export function normalizeReferenceUrl(value) {
  let parsed;
  try { parsed = new URL(String(value || '').trim()); } catch { throw new Error('invalid_reference_url'); }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('invalid_reference_url');
  if (isPrivateReferenceHost(parsed.hostname)) throw new Error('private_reference_url');
  parsed.hash = '';
  return parsed.toString();
}

export async function analyzeChassisReference({ reference, guidance = {}, capture = captureSnapshot, validate = assertPublicReferenceUrl, viewports = CHASSIS_ANALYSIS_VIEWPORTS } = {}) {
  const url = await validate(normalizeReferenceUrl(reference?.url));
  const captures = await Promise.all(viewports.map(async (viewport) => {
    const result = await capture(url, {
      viewport: { width: viewport.width, height: viewport.height },
      includeChassisEvidence: true,
      publicNetworkOnly: true,
    });
    if (!result?.chassisEvidence) throw new Error(`chassis_evidence_missing:${viewport.name || viewport.width}`);
    return result.chassisEvidence;
  }));
  return buildChassisManifest({
    reference: { ...reference, url },
    captures,
    guidance,
  });
}
