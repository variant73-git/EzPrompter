import { validateChassisManifest } from './chassis-manifest.js';

function textCapacity(section) {
  const heading = section.text?.heading?.value?.length || 0;
  const body = section.text?.body?.value?.length || 0;
  return { headingCharacters: heading, bodyCharacters: body, visibleCharacters: section.text?.visibleCharacters || heading + body };
}

export function createTransplantBlueprint({ manifest, target = {} } = {}) {
  const validation = validateChassisManifest(manifest);
  if (!validation.ok) throw new Error(`invalid_chassis_manifest:${validation.issues.join(',')}`);
  const brand = String(target.brand || '').trim();
  if (!brand) throw new Error('target_brand_required');
  const sections = manifest.structure.sections.map((section) => ({
    chassisSectionId: section.id,
    role: section.role,
    order: section.order,
    capacity: textCapacity(section),
    mediaSlots: (section.mediaSlotIds || []).map((id) => manifest.media.slots.find((slot) => slot.id === id)).filter(Boolean),
    motionTracks: (section.motionTrackIds || []).map((id) => manifest.motion.tracks.find((track) => track.id === id)).filter(Boolean),
    directive: {
      preserve: ['role', 'order', 'geometry', 'text anchors', 'media placement'],
      adapt: ['copy length', 'media crop', 'motion timing'],
      replace: ['visible copy', 'brand tokens', 'media assets'],
    },
  }));
  return {
    schemaVersion: 1,
    manifestHash: manifest.hash,
    reference: manifest.reference,
    target: {
      brand,
      contentSource: target.contentSource || 'provided-content',
      designSystemSource: target.designSystemSource || 'target-brand',
      mediaSource: target.mediaSource || 'replacement-assets',
    },
    sections,
    directives: manifest.transplant,
    acceptance: {
      required: [
        'section order matches the chassis manifest',
        'target identity replaces reference identity',
        'every media slot is replaced or explicitly waived',
        'desktop and mobile preserve the recorded structural relationships',
        'curator avoid guidance is absent from the result',
      ],
      generationAuthorized: false,
    },
  };
}

export function renderTransplantInstructions(blueprint) {
  if (!blueprint?.manifestHash || !blueprint?.sections?.length) throw new Error('invalid_transplant_blueprint');
  const lines = [
    '# Chassis Transfer Contract',
    `Reference: ${blueprint.reference.url}`,
    `Target brand: ${blueprint.target.brand}`,
    `Manifest: ${blueprint.manifestHash}`,
    '',
    '## Preserve',
    ...blueprint.directives.preserve.map((item) => `- ${item}`),
    '',
    '## Adapt',
    ...blueprint.directives.adapt.map((item) => `- ${item}`),
    '',
    '## Replace',
    ...blueprint.directives.replace.map((item) => `- ${item}`),
    '',
    '## Section ledger',
    ...blueprint.sections.map((section) => `- ${section.order}. ${section.role} (${section.chassisSectionId}): ${section.mediaSlots.length} media slot(s), ${section.motionTracks.length} motion track(s)`),
    '',
    'Generation remains locked until this contract is explicitly approved.',
  ];
  return lines.join('\n');
}

function sequenceScore(expected, actual) {
  const length = Math.max(expected.length, actual.length, 1);
  const matches = expected.filter((role, index) => actual[index] === role).length;
  return Math.round((matches / length) * 100);
}

export function auditChassisTransfer({ blueprint, outputEvidence = {}, visibleText = '' } = {}) {
  if (!blueprint?.sections?.length) throw new Error('invalid_transplant_blueprint');
  const expectedRoles = blueprint.sections.map((section) => section.role);
  const actualRoles = (outputEvidence.sections || []).map((section) => section.role);
  const structureScore = sequenceScore(expectedRoles, actualRoles);
  const referenceTitle = String(blueprint.reference.title || '').trim();
  const identityLeak = referenceTitle.length >= 3 && visibleText.toLowerCase().includes(referenceTitle.toLowerCase());
  const expectedMedia = blueprint.sections.reduce((sum, section) => sum + section.mediaSlots.length, 0);
  const actualMedia = (outputEvidence.mediaSlots || []).length;
  const warnings = [
    ...(structureScore < 90 ? [`Structural sequence score is ${structureScore}/100.`] : []),
    ...(identityLeak ? ['Reference identity remains in visible output text.'] : []),
    ...(actualMedia < expectedMedia ? [`Only ${actualMedia} of ${expectedMedia} expected media slots were observed.`] : []),
    ...(!outputEvidence.responsiveCompared ? ['Responsive output evidence is missing.'] : []),
  ];
  return {
    ok: warnings.length === 0,
    scores: { structure: structureScore, mediaCoverage: expectedMedia ? Math.min(100, Math.round((actualMedia / expectedMedia) * 100)) : 100 },
    checks: { identityReplaced: !identityLeak, responsiveCompared: Boolean(outputEvidence.responsiveCompared) },
    warnings,
  };
}
