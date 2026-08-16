'use client';

import { Calculator, Link2, Unlink2 } from 'lucide-react';
import styles from './native-motion-canvas.module.css';

export default function PropertyScopeButton({
  property,
  propertyKey,
  label,
  value,
  binding,
  device,
  scope,
  onRequest,
}) {
  if (!scope || scope.relevant === false) return null;
  const mode = scope.mode || 'shared';
  const computed = mode === 'computed';
  const perDevice = mode === 'per-device';
  const Icon = computed ? Calculator : perDevice ? Unlink2 : Link2;
  const title = computed
    ? 'Calculated by this website'
    : perDevice
      ? `Applied to ${device?.label || device?.id || 'this device'} only`
      : 'Applied to all devices';
  const accessibleName = computed
    ? `${label} is calculated by this website`
    : perDevice
      ? `Apply ${label} to all devices`
      : `Change device scope for ${label}`;

  return (
    <button
      type="button"
      className={styles.propertyScopeButton}
      data-scope={mode}
      aria-label={accessibleName}
      title={title}
      disabled={computed}
      onPointerDown={(event) => event.preventDefault()}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (computed) return;
        onRequest?.({
          action: perDevice ? 'reconnect' : 'unlink',
          property,
          propertyKey,
          label,
          visibleValue: scope.effectiveValue ?? value,
          binding,
          deviceId: device?.id,
          trigger: event.currentTarget,
        });
      }}
    >
      <Icon aria-hidden="true" />
    </button>
  );
}
