'use client';

import { RotateCcw } from 'lucide-react';
import styles from './native-motion-editor.module.css';

function isRelevant(control, activeMotionId) {
  if (control?.status !== 'ready') return false;
  if (control.scope === 'site') return true;
  if (!activeMotionId) return control.scope !== 'animation';
  return (control.targets || []).some((target) => target.motionId === activeMotionId);
}

function sameValue(left, right) {
  return Object.is(left, right) || String(left) === String(right);
}

function SliderControl({ control, onChange }) {
  const commit = (raw) => {
    const value = Number(raw);
    if (Number.isFinite(value) && !sameValue(value, control.currentValue)) onChange?.(control, value);
  };
  return (
    <span className={styles.customSliderControl}>
      <input
        key={`${control.id}:range:${control.currentValue}`}
        type="range"
        aria-label={`${control.label} slider`}
        min={control.domain.min}
        max={control.domain.max}
        step={control.domain.step}
        defaultValue={control.currentValue}
        onPointerUp={(event) => commit(event.currentTarget.value)}
        onKeyUp={(event) => {
          if (['ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) commit(event.currentTarget.value);
        }}
      />
      <span className={styles.customNumericValue}>
        <input
          key={`${control.id}:number:${control.currentValue}`}
          type="number"
          aria-label={`${control.label} value`}
          min={control.domain.min}
          max={control.domain.max}
          step={control.domain.step}
          defaultValue={control.currentValue}
          onBlur={(event) => commit(event.currentTarget.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }}
        />
        <small>{control.unit}</small>
      </span>
    </span>
  );
}

function ToggleControl({ control, onChange }) {
  return (
    <button
      type="button"
      className={styles.customToggle}
      role="switch"
      aria-label={control.label}
      aria-checked={Boolean(control.currentValue)}
      onClick={() => onChange?.(control, !control.currentValue)}
    >
      <i />
    </button>
  );
}

function SelectControl({ control, onChange }) {
  const rawOptions = control.domain.options || [];
  const options = control.controlType === 'select'
    ? rawOptions
    : rawOptions.map((value) => ({ label: value, value }));
  return (
    <select
      aria-label={control.label}
      value={String(control.currentValue)}
      onChange={(event) => {
        const option = options.find((candidate) => String(candidate.value) === event.currentTarget.value);
        if (option) onChange?.(control, option.value);
      }}
    >
      {options.map((option) => (
        <option key={String(option.value)} value={String(option.value)}>{option.label}</option>
      ))}
    </select>
  );
}

function ControlInput({ control, onChange }) {
  if (control.controlType === 'slider-number') return <SliderControl control={control} onChange={onChange} />;
  if (control.controlType === 'toggle') return <ToggleControl control={control} onChange={onChange} />;
  return <SelectControl control={control} onChange={onChange} />;
}

export default function CustomControlsSection({ controls = [], activeMotionId = null, onChange, onReset }) {
  const visible = controls.filter((control) => isRelevant(control, activeMotionId));
  if (!visible.length) return null;
  return (
    <section className={styles.customControlsSection} aria-label="Validated website controls">
      <header className={styles.customControlsHeading}>
        <span>Website controls</span>
        <small>{visible.length}</small>
      </header>
      <div className={styles.customControlList}>
        {visible.map((control) => (
          <div key={control.id} className={styles.customControlRow}>
            <div className={styles.customControlCopy}>
              <strong>{control.label}</strong>
              <small>{control.description}</small>
            </div>
            <div className={styles.customControlInput}>
              <ControlInput control={control} onChange={onChange} />
              <button
                type="button"
                className={styles.customControlReset}
                aria-label={`Reset ${control.label} to original`}
                title="Reset to original"
                disabled={sameValue(control.currentValue, control.originalValue)}
                onClick={() => onReset?.(control)}
              >
                <RotateCcw aria-hidden="true" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
