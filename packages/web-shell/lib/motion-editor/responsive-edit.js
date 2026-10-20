// Regras da tabela por tela partilhadas entre o painel (useNativeMotionController) e a camada de alças e guias
// (overlay-batch.js) — saíram do controller sem mudança de comportamento (2026-10-20).
import { normalizeSemanticProperty } from './motion-ownership.js';

export function responsivePropertyName(property) {
  if (property === 'text' || String(property).startsWith('attribute.')) return property;
  return normalizeSemanticProperty(property);
}

export function responsiveBindingFromPatch(patch) {
  if (!patch || patch.kind === 'responsive') return null;
  const binding = {
    elementId: patch.elementId,
    kind: patch.kind,
    ...(['text', 'svg'].includes(patch.kind) ? {} : { property: patch.property }),
    ...(patch.kind === 'motion' ? { motionId: patch.motionId } : {}),
  };
  if (patch.kind === 'motion' && patch.property === 'retarget.final' && patch.value && typeof patch.value === 'object') {
    binding.valueTemplate = patch.value;
  }
  return binding;
}

export function responsiveStoredValue(patch, visibleValue) {
  if (patch?.kind === 'style' && patch.property === 'transform') {
    return { visibleValue, runtimeValue: patch.value };
  }
  return visibleValue;
}
