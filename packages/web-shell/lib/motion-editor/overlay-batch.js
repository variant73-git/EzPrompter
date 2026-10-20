// A edição de um gesto da camada de alças e guias (spec 2026-10-20 §6.2.3). Igual ao caminho do painel
// (`applyResponsiveEdit` no controller), mas POR PAR elemento × propriedade: o do painel usa `selected.id` e a marca de
// UMA propriedade para todos os patches, e ao reabrir a altura voltava ao valor antigo (Astra r2 #1). O redimensionar
// toca o filho E o pai (liberar o corte); o `gap` toca só o pai — cada mudança leva o SEU elemento.
import { createPatch } from './protocol.js';
import {
  parseResponsiveManifest,
  resolveResponsiveProperty,
  responsivePropertyKey,
  setResponsivePropertyMode,
  setResponsivePropertyValue,
  withResponsiveMetadata,
} from './responsive-manifest.js';
import { responsiveBindingFromPatch, responsivePropertyName, responsiveStoredValue } from './responsive-edit.js';

export function buildOverlayBatch({ manifest, deviceId, changes, descriptorFor }) {
  if (!Array.isArray(changes) || !changes.length) return { ok: false, reason: 'empty_batch' };
  // Uma entrada por elemento × propriedade: o 1º `before` e o ÚLTIMO valor. O assentamento da tabela só lê a 1ª
  // ocorrência de cada chave, e destravar + redimensionar podem escrever a mesma largura duas vezes (Astra, Task 2).
  const porChave = new Map();
  for (const c of changes) {
    if (!c || !c.elementId || !c.property) continue;
    const chave = `${c.elementId}\u0000${responsivePropertyName(c.property)}`;
    const ja = porChave.get(chave);
    if (ja) ja.value = c.value;
    else porChave.set(chave, { ...c });
  }
  const efetivas = [...porChave.values()].filter((c) => String(c.before ?? '') !== String(c.value ?? ''));
  if (!efetivas.length) return { ok: false, reason: 'no_effect' };
  let atual = parseResponsiveManifest(manifest);
  const patches = [];
  for (const change of efetivas) {
    const normalized = responsivePropertyName(change.property);
    const descriptor = (typeof descriptorFor === 'function' && descriptorFor(change.elementId, normalized)) || null;
    if (descriptor?.mode === 'computed') return { ok: false, reason: 'computed_scope' };
    const propertyKey = responsivePropertyKey(change.elementId, normalized);
    const beforeEntry = atual.properties?.[propertyKey] || null;
    const patch = createPatch({ elementId: change.elementId, kind: 'style', property: change.property, before: change.before ?? '', value: change.value ?? '' });
    const binding = responsiveBindingFromPatch(patch);
    const scope = resolveResponsiveProperty(atual, { propertyKey, deviceId, fallbackValue: patch.before, descriptor });
    if (scope?.mode === 'computed') return { ok: false, reason: 'computed_scope' };
    let base = atual;
    if (!beforeEntry && scope?.mode === 'per-device') {
      base = setResponsivePropertyMode(base, { propertyKey, mode: 'per-device', deviceId, visibleValue: patch.before, binding, descriptor });
    }
    atual = setResponsivePropertyValue(base, {
      propertyKey,
      deviceId,
      value: responsiveStoredValue(patch, patch.value),
      binding,
      descriptor: { ...descriptor, mode: scope?.mode || descriptor?.mode || 'shared' },
      provenance: scope?.provenance,
    });
    const afterEntry = atual.properties[propertyKey];
    patches.push(withResponsiveMetadata(patch, { propertyKey, mode: afterEntry.mode, deviceId, beforeEntry, afterEntry }));
  }
  return { ok: true, patches, nextManifest: atual };
}
