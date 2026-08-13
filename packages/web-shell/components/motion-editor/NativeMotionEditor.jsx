'use client';

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { ContextMenu, useContextMenu } from './ContextMenu.jsx';
import Link from 'next/link';
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  ArrowLeft,
  Check,
  ChevronDown,
  Code2,
  Copy,
  Diamond,
  Eye,
  Film,
  Gauge,
  ImageIcon,
  Inspect,
  Layers,
  Link2,
  Lock,
  Monitor,
  Move,
  MousePointer2,
  Pause,
  Play,
  Redo2,
  RotateCcw,
  Save,
  ScrollText,
  Shapes,
  Smartphone,
  Square,
  Type,
  Tablet,
  Trash2,
  Undo2,
  Upload,
  X,
} from 'lucide-react';
import {
  coerceMotionValue,
  motionCapabilityLabel,
  motionDriverLabel,
  motionPlaybackMode,
  trackKeyframeEditable,
} from '../../lib/motion-editor/motion-ir.js';
import { groupMotionClips } from '../../lib/motion-editor/motion-groups.js';
import { buildFramerExport } from '../../lib/motion-editor/framer-export.js';
import {
  MOTION_EDITOR_DEVICE_ORDER,
  MOTION_EDITOR_DEVICES,
} from '../../lib/motion-editor/devices.js';
import {
  decomposeTransform,
  transformComponentValue,
} from '../../lib/motion-editor/transform-components.js';
import {
  createLocalMotionPersistenceAdapter,
  useNativeMotionController,
} from './useNativeMotionController.js';
import MotionOwnershipChoice from './MotionOwnershipChoice.jsx';
import PropertyScopeButton from './PropertyScopeButton.jsx';
import styles from './native-motion-editor.module.css';

const SOURCE = '/api/native-clone/index.html';

const DEVICE_ICONS = Object.freeze({
  desktop: Monitor,
  tablet: Tablet,
  mobile: Smartphone,
});

function animationProperty(property) {
  return String(property || '').replace(/-([a-z])/g, (_, character) => character.toUpperCase());
}

function readLabPreference(key, fallback, minimum, maximum) {
  try {
    const stored = Number(window.localStorage.getItem(key));
    return Number.isFinite(stored) && stored >= minimum && stored <= maximum ? stored : fallback;
  } catch (_) {
    return fallback;
  }
}

const EASING_PRESETS = {
  linear: [0, 0, 1, 1],
  ease: [0.25, 0.1, 0.25, 1],
  'ease-in': [0.42, 0, 1, 1],
  'ease-out': [0, 0, 0.58, 1],
  'ease-in-out': [0.42, 0, 0.58, 1],
};

function parseEasing(value) {
  if (EASING_PRESETS[value]) return [...EASING_PRESETS[value]];
  const match = String(value || '').match(/cubic-bezier\(\s*(-?\d*\.?\d+)\s*,\s*(-?\d*\.?\d+)\s*,\s*(-?\d*\.?\d+)\s*,\s*(-?\d*\.?\d+)\s*\)/i);
  return match ? match.slice(1).map(Number) : [...EASING_PRESETS.ease];
}

function formatBezier(values) {
  return `cubic-bezier(${values.map((value) => Number(value).toFixed(2).replace(/\.00$/, '')).join(', ')})`;
}

function CubicBezierEditor({ keyframe, nextKeyframe, onCommit, onClose }) {
  const svgRef = useRef(null);
  const activeHandle = useRef(null);
  const easing = keyframe?.easing || 'ease';
  const [curve, setCurve] = useState(() => parseEasing(easing));

  useEffect(() => setCurve(parseEasing(easing)), [easing, keyframe?.offset]);

  function updateHandle(event, commit = false) {
    if (activeHandle.current == null || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, 1 - ((event.clientY - rect.top) / rect.height)));
    const next = [...curve];
    const start = activeHandle.current * 2;
    next[start] = x;
    next[start + 1] = y;
    setCurve(next);
    if (commit) onCommit(formatBezier(next));
  }

  function nudgeHandle(event, index) {
    const direction = {
      ArrowLeft: [-0.02, 0], ArrowRight: [0.02, 0],
      ArrowDown: [0, -0.02], ArrowUp: [0, 0.02],
    }[event.key];
    if (!direction) return;
    event.preventDefault();
    const next = [...curve];
    const start = index * 2;
    next[start] = Math.max(0, Math.min(1, next[start] + direction[0]));
    next[start + 1] = Math.max(0, Math.min(1, next[start + 1] + direction[1]));
    setCurve(next);
    onCommit(formatBezier(next));
  }

  const width = 184;
  const height = 76;
  const first = { x: curve[0] * width, y: (1 - curve[1]) * height };
  const second = { x: curve[2] * width, y: (1 - curve[3]) * height };

  return (
    <div className={styles.curveEditor} role="dialog" aria-label="Segment easing editor">
      <header>
        <span><strong>Segment curve</strong><small>{Number(keyframe.offset).toFixed(2)} → {Number(nextKeyframe.offset).toFixed(2)}</small></span>
        <button type="button" onClick={onClose} aria-label="Close curve editor"><X /></button>
      </header>
      <select
        aria-label="Easing preset"
        value={Object.keys(EASING_PRESETS).includes(easing) ? easing : 'custom'}
        onChange={(event) => {
          const preset = event.currentTarget.value;
          if (preset === 'custom') return;
          setCurve([...EASING_PRESETS[preset]]);
          onCommit(preset);
        }}
      >
        <option value="linear">Linear</option>
        <option value="ease">Ease</option>
        <option value="ease-in">Ease in</option>
        <option value="ease-out">Ease out</option>
        <option value="ease-in-out">Ease in out</option>
        <option value="custom">Custom cubic</option>
      </select>
      <svg
        ref={svgRef}
        className={styles.curveGraph}
        viewBox={`0 0 ${width} ${height}`}
        onPointerMove={(event) => updateHandle(event, false)}
        onPointerUp={(event) => {
          updateHandle(event, true);
          activeHandle.current = null;
          event.currentTarget.releasePointerCapture?.(event.pointerId);
        }}
        onPointerCancel={() => { activeHandle.current = null; }}
      >
        <path className={styles.curveGridLine} d={`M0 ${height} L${width} 0`} />
        <path className={styles.curveHandleLine} d={`M0 ${height} L${first.x} ${first.y} M${width} 0 L${second.x} ${second.y}`} />
        <path className={styles.curvePath} d={`M0 ${height} C${first.x} ${first.y}, ${second.x} ${second.y}, ${width} 0`} />
        {[first, second].map((point, index) => (
          <circle
            key={index}
            className={styles.curveHandle}
            cx={point.x}
            cy={point.y}
            r="5"
            tabIndex="0"
            role="slider"
            aria-label={`Bezier handle ${index + 1}`}
            aria-valuetext={`${curve[index * 2].toFixed(2)}, ${curve[index * 2 + 1].toFixed(2)}`}
            onPointerDown={(event) => {
              activeHandle.current = index;
              event.currentTarget.ownerSVGElement?.setPointerCapture?.(event.pointerId);
              event.preventDefault();
            }}
            onKeyDown={(event) => nudgeHandle(event, index)}
          />
        ))}
      </svg>
      <div className={styles.curveValues}>
        {curve.map((value, index) => <code key={index}>{value.toFixed(2)}</code>)}
      </div>
    </div>
  );
}

function KeyframeMarker({ state }) {
  if (!state) return null;
  return <Diamond className={styles.fieldKeyframe} data-state={state} aria-label={state === 'current' ? 'Keyframe at current time' : 'Animated property'} />;
}

function OwnershipIndicator({ label, ownership, onOpen }) {
  if (ownership?.status !== 'ambiguous' && ownership?.status !== 'unsupported') return null;
  // Unsupported = a writer exists but cannot be edited safely (gsap.from, keyframes
  // tweens, code-only). The field is disabled; this indicator carries the reason and
  // routes to Motion for the full explanation — never a chooser with no choice.
  const locked = ownership.status === 'unsupported';
  return (
    <button
      type="button"
      className={styles.ownershipIndicator}
      data-ownership-locked={locked || undefined}
      aria-label={locked
        ? `${label} is driven by an animation — open Motion for details`
        : `Choose controlling motion for ${label}`}
      title={locked
        ? 'Driven by an animation this editor cannot change safely — open Motion for details'
        : 'Multiple motions control this value'}
      onPointerDown={(event) => event.preventDefault()}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onOpen?.();
      }}
    >
      {locked ? <Lock aria-hidden="true" /> : <>
        <Link2 aria-hidden="true" />
        <span>{ownership.candidates.length}</span>
      </>}
    </button>
  );
}

function ResponsiveScopeControl({
  property,
  label,
  value,
  binding,
  scope,
  device,
  onRequest,
}) {
  if (!scope) return null;
  return (
    <PropertyScopeButton
      property={property}
      propertyKey={scope.propertyKey}
      label={label}
      value={value}
      binding={binding}
      device={device}
      scope={scope}
      onRequest={onRequest}
    />
  );
}

function Field({
  label,
  defaultValue,
  suffix,
  onCommit,
  type = 'text',
  disabled = false,
  keyframeState = null,
  ownership = null,
  onOwnershipOpen,
  property = null,
  binding = null,
  responsiveScope = null,
  device = null,
  onScopeRequest,
}) {
  const inputRef = useRef(null);
  const effectiveValue = responsiveScope?.effectiveValue ?? defaultValue;
  // ⚠️ O campo NÃO pode ser remontado enquanto está sendo digitado. Antes ele
  // tinha `key={`${label}:${effectiveValue}`}`, e o editor recebe atualizações
  // do site o tempo todo — a cada uma o valor mudava, a chave mudava, e o React
  // destruía e recriava o input debaixo dos dedos do usuário, apagando o que
  // ele tinha escrito antes de confirmar. Agora a chave é estável e o valor
  // externo só é escrito quando o campo NÃO está com o foco.
  useEffect(() => {
    const el = inputRef.current;
    if (!el || document.activeElement === el) return;
    const proximo = effectiveValue ?? '';
    if (el.value !== String(proximo)) el.value = proximo;
  }, [effectiveValue]);
  if (responsiveScope?.relevant === false) return null;
  return (
    <label className={styles.field}>
      <span className={styles.controlLabel}>
        <span className={styles.controlLabelText}>{label}</span>
        <KeyframeMarker state={keyframeState} />
        <OwnershipIndicator label={label} ownership={ownership} onOpen={onOwnershipOpen} />
        <ResponsiveScopeControl
          property={property}
          label={label}
          value={effectiveValue}
          binding={binding}
          scope={responsiveScope}
          device={device}
          onRequest={onScopeRequest}
        />
      </span>
      <span className={styles.fieldControl}>
        <input
          ref={inputRef}
          type={type}
          defaultValue={effectiveValue ?? ''}
          disabled={disabled || responsiveScope?.mode === 'computed' || ownership?.status === 'unsupported'}
          onBlur={(event) => onCommit?.(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
          }}
        />
        {suffix && <small>{suffix}</small>}
      </span>
    </label>
  );
}

function SelectField({
  label,
  value,
  onCommit,
  children,
  disabled = false,
  keyframeState = null,
  ownership = null,
  onOwnershipOpen,
  property = null,
  binding = null,
  responsiveScope = null,
  device = null,
  onScopeRequest,
}) {
  if (responsiveScope?.relevant === false) return null;
  const effectiveValue = responsiveScope?.effectiveValue ?? value;
  return (
    <label className={styles.field}>
      <span className={styles.controlLabel}>
        <span className={styles.controlLabelText}>{label}</span>
        <KeyframeMarker state={keyframeState} />
        <OwnershipIndicator label={label} ownership={ownership} onOpen={onOwnershipOpen} />
        <ResponsiveScopeControl
          property={property}
          label={label}
          value={effectiveValue}
          binding={binding}
          scope={responsiveScope}
          device={device}
          onRequest={onScopeRequest}
        />
      </span>
      <span className={styles.fieldControl}>
        <select disabled={disabled || responsiveScope?.mode === 'computed' || ownership?.status === 'unsupported'} value={effectiveValue} onChange={(event) => onCommit(event.currentTarget.value)}>
          {children}
        </select>
      </span>
    </label>
  );
}

function ToggleField({ label, checked, onCommit, disabled = false }) {
  return (
    <div className={styles.toggleField}>
      <span>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onCommit(!checked)}
      ><i /></button>
    </div>
  );
}

function ColorField({
  label,
  value,
  onCommit,
  keyframeState = null,
  ownership = null,
  onOwnershipOpen,
  property = null,
  binding = null,
  responsiveScope = null,
  device = null,
  onScopeRequest,
}) {
  if (responsiveScope?.relevant === false) return null;
  const effectiveValue = responsiveScope?.effectiveValue ?? value;
  const safeValue = /^#[0-9a-f]{6}$/i.test(effectiveValue || '') ? effectiveValue : '#292926';
  return (
    <label className={styles.field}>
      <span className={styles.controlLabel}>
        <span className={styles.controlLabelText}>{label}</span>
        <KeyframeMarker state={keyframeState} />
        <OwnershipIndicator label={label} ownership={ownership} onOpen={onOwnershipOpen} />
        <ResponsiveScopeControl
          property={property}
          label={label}
          value={effectiveValue}
          binding={binding}
          scope={responsiveScope}
          device={device}
          onRequest={onScopeRequest}
        />
      </span>
      <span className={styles.colorControl}>
        <input
          key={`${label}:${safeValue}`}
          type="color"
          defaultValue={safeValue}
          disabled={responsiveScope?.mode === 'computed' || ownership?.status === 'unsupported'}
          onBlur={(event) => onCommit?.(event.currentTarget.value)}
        />
        <input
          key={`${label}:text:${effectiveValue}`}
          defaultValue={effectiveValue || ''}
          disabled={responsiveScope?.mode === 'computed' || ownership?.status === 'unsupported'}
          onBlur={(event) => onCommit?.(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
          }}
        />
      </span>
    </label>
  );
}

function TextContentField({ selected, onCommit, responsiveScope, device, onScopeRequest }) {
  const effectiveValue = responsiveScope?.effectiveValue ?? selected.text ?? '';
  const [value, setValue] = useState(effectiveValue);
  useEffect(() => setValue(effectiveValue), [effectiveValue, selected.id]);
  if (responsiveScope?.relevant === false) return null;
  const changed = value !== effectiveValue;
  return (
    <label className={styles.textField}>
      <span className={styles.controlLabel}>
        <span className={styles.controlLabelText}>Text</span>
        <ResponsiveScopeControl
          property="text"
          label="Text"
          value={effectiveValue}
          binding={{ elementId: selected.id, kind: 'text' }}
          scope={responsiveScope}
          device={device}
          onRequest={onScopeRequest}
        />
      </span>
      <span className={styles.textEditorControl}>
        <textarea disabled={responsiveScope?.mode === 'computed'} value={value} onChange={(event) => setValue(event.currentTarget.value)} />
        <button type="button" disabled={!changed} onClick={() => onCommit(value)}>Apply text</button>
      </span>
    </label>
  );
}

function InspectorSection({ title, meta, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`${styles.inspectorSection} ${open ? '' : styles.sectionCollapsed}`}>
      <button
        type="button"
        className={styles.sectionHeading}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span>{title}</span>
        <span className={styles.sectionHeadingEnd}>
          {meta != null && <small>{meta}</small>}
          <ChevronDown aria-hidden="true" />
        </span>
      </button>
      <div className={styles.sectionBody}>{children}</div>
    </section>
  );
}

function DocumentProperties({ runtime }) {
  const profile = runtime?.profile;
  return (
    <div className={styles.panelBody}>
      <section className={styles.documentOverview}>
        <span className={styles.emptyIcon}><Inspect aria-hidden="true" /></span>
        <strong>Document properties</strong>
        <p>Hover to inspect. Click to select. Switch to Move to place an element freely.</p>
      </section>
      <InspectorSection title="Document colors" meta={profile?.colors?.length || 0}>
        <div className={styles.documentColors}>
          {(profile?.colors || []).map((color) => (
            <div key={color.value} title={`${color.value} · ${color.count} uses`}>
              <i style={{ background: color.value }} />
              <span>{color.value}</span>
            </div>
          ))}
        </div>
      </InspectorSection>
      <InspectorSection title="Typefaces" meta={profile?.fonts?.length || 0}>
        <div className={styles.fontList}>
          {(profile?.fonts || []).map((font) => <div key={font.value}><span style={{ fontFamily: font.value }}>Ag</span><strong>{font.value}</strong><small>{font.count}</small></div>)}
        </div>
      </InspectorSection>
    </div>
  );
}

function InspectorEmpty() {
  return (
    <div className={styles.emptyInspector}>
      <span className={styles.emptyIcon}><Inspect aria-hidden="true" /></span>
      <strong>Select something on the site</strong>
      <p>The native runtime keeps moving while this panel reads the real element underneath it.</p>
    </div>
  );
}

export function PropertiesPanel({
  selected,
  runtime,
  activeMotion,
  timelineOffset,
  propertyOwnership = {},
  onOwnershipOpen,
  onStyle,
  onText,
  onAttribute,
  device = null,
  responsiveScopeFor = null,
  onScopeRequest,
}) {
  if (!selected) return <DocumentProperties runtime={runtime} />;
  const stylesValue = selected.styles || {};
  const transform = decomposeTransform(stylesValue.transform || 'none', stylesValue.transformOrigin || '50% 50%');
  const canEditText = selected.canEditText !== false && !['img', 'video', 'canvas', 'svg', 'section'].includes(selected.tag);
  const supportsTypography = canEditText || Boolean(selected.text);
  const ownershipFor = (property) => propertyOwnership[animationProperty(property)] || null;
  const scopeProps = (property, fallbackValue, binding = null) => ({
    property,
    binding,
    responsiveScope: responsiveScopeFor?.(property, fallbackValue, binding) || null,
    device,
    onScopeRequest,
  });
  const styleBinding = (property) => ({ elementId: selected.id, kind: 'style', property });
  const alignmentScope = responsiveScopeFor?.(
    'textAlign',
    stylesValue.textAlign,
    styleBinding('text-align'),
  ) || null;
  const keyframeState = (property) => {
    const normalized = animationProperty(property);
    const track = activeMotion?.tracks?.find((item) => animationProperty(item.property) === normalized);
    if (!track) return null;
    return track.keyframes?.some((keyframe) => Math.abs(Number(keyframe.offset) - timelineOffset) < 0.0005) ? 'current' : 'track';
  };

  return (
    <div className={styles.panelBody}>
      <InspectorSection title="Content" meta={selected.tag}>
        {canEditText && (
          <TextContentField
            selected={selected}
            onCommit={onText}
            responsiveScope={responsiveScopeFor?.('text', selected.text, { elementId: selected.id, kind: 'text' }) || null}
            device={device}
            onScopeRequest={onScopeRequest}
          />
        )}
        {selected.tag === 'img' && (
          <Field
            label="Source"
            defaultValue={selected.imageSrc}
            {...scopeProps('attribute.src', selected.imageSrc, { elementId: selected.id, kind: 'attribute', property: 'src' })}
            onCommit={(value) => onAttribute('src', value, selected.imageSrc)}
          />
        )}
        {!canEditText && selected.tag !== 'img' && <p className={styles.mutedCopy}>This element has no directly editable content.</p>}
      </InspectorSection>

      <InspectorSection title="Layout">
        <div className={styles.metricGrid}>
          {Object.entries(selected.rect || {}).map(([key, value]) => (
            <div key={key}><span>{key.toUpperCase()}</span><strong>{value}</strong></div>
          ))}
        </div>
      </InspectorSection>

      <InspectorSection title="Transform">
        {transform.reliable ? <>
          <div className={styles.controlGrid}>
            <Field
              label="X"
              defaultValue={transformComponentValue(transform, 'translateX')}
              {...scopeProps('translateX', transformComponentValue(transform, 'translateX'))}
              ownership={ownershipFor('translateX')}
              onOwnershipOpen={() => onOwnershipOpen?.('translateX')}
              onCommit={(value) => onStyle('translateX', value, transformComponentValue(transform, 'translateX'))}
            />
            <Field
              label="Y"
              defaultValue={transformComponentValue(transform, 'translateY')}
              {...scopeProps('translateY', transformComponentValue(transform, 'translateY'))}
              ownership={ownershipFor('translateY')}
              onOwnershipOpen={() => onOwnershipOpen?.('translateY')}
              onCommit={(value) => onStyle('translateY', value, transformComponentValue(transform, 'translateY'))}
            />
          </div>
          <div className={styles.controlGrid}>
            <Field
              label="Scale X"
              defaultValue={transformComponentValue(transform, 'scaleX')}
              {...scopeProps('scaleX', transformComponentValue(transform, 'scaleX'))}
              ownership={ownershipFor('scaleX')}
              onOwnershipOpen={() => onOwnershipOpen?.('scaleX')}
              onCommit={(value) => onStyle('scaleX', value, transformComponentValue(transform, 'scaleX'))}
            />
            <Field
              label="Scale Y"
              defaultValue={transformComponentValue(transform, 'scaleY')}
              {...scopeProps('scaleY', transformComponentValue(transform, 'scaleY'))}
              ownership={ownershipFor('scaleY')}
              onOwnershipOpen={() => onOwnershipOpen?.('scaleY')}
              onCommit={(value) => onStyle('scaleY', value, transformComponentValue(transform, 'scaleY'))}
            />
          </div>
          <Field
            label="Rotate"
            defaultValue={transformComponentValue(transform, 'rotate')}
            {...scopeProps('rotate', transformComponentValue(transform, 'rotate'))}
            ownership={ownershipFor('rotate')}
            onOwnershipOpen={() => onOwnershipOpen?.('rotate')}
            onCommit={(value) => onStyle('rotate', value, transformComponentValue(transform, 'rotate'))}
          />
          <div className={styles.controlGrid}>
            <Field
              label="Skew X"
              defaultValue={transformComponentValue(transform, 'skewX')}
              {...scopeProps('skewX', transformComponentValue(transform, 'skewX'))}
              ownership={ownershipFor('skewX')}
              onOwnershipOpen={() => onOwnershipOpen?.('skewX')}
              onCommit={(value) => onStyle('skewX', value, transformComponentValue(transform, 'skewX'))}
            />
            <Field
              label="Skew Y"
              defaultValue={transformComponentValue(transform, 'skewY')}
              {...scopeProps('skewY', transformComponentValue(transform, 'skewY'))}
              ownership={ownershipFor('skewY')}
              onOwnershipOpen={() => onOwnershipOpen?.('skewY')}
              onCommit={(value) => onStyle('skewY', value, transformComponentValue(transform, 'skewY'))}
            />
          </div>
          <div className={styles.controlGrid}>
            <Field
              label="Origin X"
              defaultValue={transformComponentValue(transform, 'transformOriginX')}
              {...scopeProps('transformOriginX', transformComponentValue(transform, 'transformOriginX'))}
              ownership={ownershipFor('transformOriginX')}
              onOwnershipOpen={() => onOwnershipOpen?.('transformOriginX')}
              onCommit={(value) => onStyle('transformOriginX', value, transformComponentValue(transform, 'transformOriginX'))}
            />
            <Field
              label="Origin Y"
              defaultValue={transformComponentValue(transform, 'transformOriginY')}
              {...scopeProps('transformOriginY', transformComponentValue(transform, 'transformOriginY'))}
              ownership={ownershipFor('transformOriginY')}
              onOwnershipOpen={() => onOwnershipOpen?.('transformOriginY')}
              onCommit={(value) => onStyle('transformOriginY', value, transformComponentValue(transform, 'transformOriginY'))}
            />
          </div>
        </> : (
          <div className={styles.transformUnavailable}>
            <p>Position and rotation are controlled by a complex motion.</p>
            <button type="button" onClick={() => onOwnershipOpen?.('transform')}>Open Motion</button>
          </div>
        )}
      </InspectorSection>

      <InspectorSection title="Appearance">
        <ColorField
          label="Text"
          value={stylesValue.colorHex}
          {...scopeProps('color', stylesValue.colorHex, styleBinding('color'))}
          keyframeState={keyframeState('color')}
          ownership={ownershipFor('color')}
          onOwnershipOpen={() => onOwnershipOpen?.('color')}
          onCommit={(value) => onStyle('color', value, stylesValue.color)}
        />
        <ColorField
          label="Fill"
          value={stylesValue.backgroundColorHex}
          {...scopeProps('backgroundColor', stylesValue.backgroundColorHex, styleBinding('background-color'))}
          keyframeState={keyframeState('background-color')}
          ownership={ownershipFor('backgroundColor')}
          onOwnershipOpen={() => onOwnershipOpen?.('backgroundColor')}
          onCommit={(value) => onStyle('background-color', value, stylesValue.backgroundColor)}
        />
        <div className={styles.controlGrid}>
          <Field
            label="Opacity"
            defaultValue={stylesValue.opacity}
            {...scopeProps('opacity', stylesValue.opacity, styleBinding('opacity'))}
            keyframeState={keyframeState('opacity')}
            ownership={ownershipFor('opacity')}
            onOwnershipOpen={() => onOwnershipOpen?.('opacity')}
            onCommit={(value) => onStyle('opacity', value, stylesValue.opacity)}
          />
          <Field
            label="Radius"
            defaultValue={stylesValue.borderRadius}
            {...scopeProps('borderRadius', stylesValue.borderRadius, styleBinding('border-radius'))}
            keyframeState={keyframeState('border-radius')}
            ownership={ownershipFor('borderRadius')}
            onOwnershipOpen={() => onOwnershipOpen?.('borderRadius')}
            onCommit={(value) => onStyle('border-radius', value, stylesValue.borderRadius)}
          />
        </div>
      </InspectorSection>

      {supportsTypography && <InspectorSection title="Typography">
        <Field
          label="Font"
          defaultValue={stylesValue.fontFamily}
          {...scopeProps('fontFamily', stylesValue.fontFamily, styleBinding('font-family'))}
          ownership={ownershipFor('fontFamily')}
          onOwnershipOpen={() => onOwnershipOpen?.('fontFamily')}
          onCommit={(value) => onStyle('font-family', value, stylesValue.fontFamily)}
        />
        <div className={styles.controlGrid}>
          <Field
            label="Weight"
            defaultValue={stylesValue.fontWeight}
            {...scopeProps('fontWeight', stylesValue.fontWeight, styleBinding('font-weight'))}
            keyframeState={keyframeState('font-weight')}
            ownership={ownershipFor('fontWeight')}
            onOwnershipOpen={() => onOwnershipOpen?.('fontWeight')}
            onCommit={(value) => onStyle('font-weight', value, stylesValue.fontWeight)}
          />
          <Field
            label="Size"
            defaultValue={stylesValue.fontSize}
            {...scopeProps('fontSize', stylesValue.fontSize, styleBinding('font-size'))}
            keyframeState={keyframeState('font-size')}
            ownership={ownershipFor('fontSize')}
            onOwnershipOpen={() => onOwnershipOpen?.('fontSize')}
            onCommit={(value) => onStyle('font-size', value, stylesValue.fontSize)}
          />
        </div>
        <div className={styles.controlGrid}>
          <Field
            label="Line height"
            defaultValue={stylesValue.lineHeight}
            {...scopeProps('lineHeight', stylesValue.lineHeight, styleBinding('line-height'))}
            keyframeState={keyframeState('line-height')}
            ownership={ownershipFor('lineHeight')}
            onOwnershipOpen={() => onOwnershipOpen?.('lineHeight')}
            onCommit={(value) => onStyle('line-height', value, stylesValue.lineHeight)}
          />
          <Field
            label="Letter spacing"
            defaultValue={stylesValue.letterSpacing}
            {...scopeProps('letterSpacing', stylesValue.letterSpacing, styleBinding('letter-spacing'))}
            keyframeState={keyframeState('letter-spacing')}
            ownership={ownershipFor('letterSpacing')}
            onOwnershipOpen={() => onOwnershipOpen?.('letterSpacing')}
            onCommit={(value) => onStyle('letter-spacing', value, stylesValue.letterSpacing)}
          />
        </div>
        {alignmentScope?.relevant !== false && <div className={styles.field}>
          <span className={styles.controlLabel}>
            <span className={styles.controlLabelText}>Alignment</span>
            <OwnershipIndicator label="Alignment" ownership={ownershipFor('textAlign')} onOpen={() => onOwnershipOpen?.('textAlign')} />
            <ResponsiveScopeControl
              property="textAlign"
              label="Alignment"
              value={alignmentScope?.effectiveValue ?? stylesValue.textAlign}
              binding={styleBinding('text-align')}
              scope={alignmentScope}
              device={device}
              onRequest={onScopeRequest}
            />
          </span>
          <div className={styles.alignControl}>
            {[
              ['left', AlignLeft], ['center', AlignCenter], ['right', AlignRight], ['justify', AlignJustify],
            ].map(([value, Icon]) => (
              <button
                key={value}
                type="button"
                aria-label={`Align ${value}`}
                aria-pressed={(alignmentScope?.effectiveValue ?? stylesValue.textAlign) === value}
                disabled={alignmentScope?.mode === 'computed' || ownershipFor('textAlign')?.status === 'unsupported'}
                onClick={() => onStyle('text-align', value, stylesValue.textAlign)}
              ><Icon /></button>
            ))}
          </div>
        </div>}
        <div className={styles.controlGrid}>
          <SelectField
            label="Case"
            value={stylesValue.textTransform || 'none'}
            {...scopeProps('textTransform', stylesValue.textTransform || 'none', styleBinding('text-transform'))}
            ownership={ownershipFor('textTransform')}
            onOwnershipOpen={() => onOwnershipOpen?.('textTransform')}
            onCommit={(value) => onStyle('text-transform', value, stylesValue.textTransform)}
          >
            <option value="none">Original</option><option value="uppercase">Uppercase</option><option value="lowercase">Lowercase</option><option value="capitalize">Title case</option>
          </SelectField>
          <SelectField
            label="Style"
            value={stylesValue.fontStyle || 'normal'}
            {...scopeProps('fontStyle', stylesValue.fontStyle || 'normal', styleBinding('font-style'))}
            ownership={ownershipFor('fontStyle')}
            onOwnershipOpen={() => onOwnershipOpen?.('fontStyle')}
            onCommit={(value) => onStyle('font-style', value, stylesValue.fontStyle)}
          >
            <option value="normal">Normal</option><option value="italic">Italic</option><option value="oblique">Oblique</option>
          </SelectField>
        </div>
      </InspectorSection>}
    </div>
  );
}

const MOTION_GROUP_LABELS = {
  'text-reveal': 'Text reveal',
  timeline: 'Timeline',
  stagger: 'Stagger',
};

// Phase 0 legibility: the badge must EXPLAIN, not just style. "Sometimes it
// works, sometimes it doesn't" came from capabilities that never said why.
const EDITABILITY_EXPLAINED = {
  direct: 'Editable: keyframes and timing write back natively (CSS/WAAPI)',
  known: 'Known adapter: timing, easing and final values write back through the site runtime',
  adapter: 'Adapter: timing, easing and start/end values write back through GSAP; keyframes cannot be moved or added',
  declarative: 'Declarative: this value writes back through a safe site binding',
  custom: 'Custom: this control was validated for this website',
  code: 'Code-driven: this animation is controlled by site scripts and is read-only here',
};

export function MotionPanel({ selected, motion, activeMotionId, onMotion, onStagger }) {
  const activeMotion = motion.find((item) => item.id === activeMotionId) || null;
  const usesKnownAdapter = ['adapter', 'known'].includes(activeMotion?.editability);
  const motionRows = useMemo(() => groupMotionClips(motion), [motion]);
  // The timeline owns the LIST of animations (Figma Motion model) — this panel
  // inspects the active one. Group context surfaces here only as the Stagger
  // control, because stagger is a property of the group, not a list entry.
  const activeGroup = motionRows.find((row) => row.kind !== 'single' && row.clips.some((item) => item.id === activeMotionId)) || null;
  // Verified on real GSAP 3.15: delay() on a timeline child updates the
  // reported value but never moves startTime, and delay is meaningless on
  // a scroll-scrubbed clip — offering the control there would record
  // phantom edits that visually do nothing.
  const staggerable = Boolean(activeGroup)
    && activeGroup.type !== 'timeline'
    && activeGroup.driver?.type !== 'scroll'
    && activeGroup.clips.every((item) => !item.group?.timelineId);

  const commit = (property, value, before) => {
    if (!activeMotion) return;
    onMotion(activeMotion, property, coerceMotionValue(property, value), before);
  };

  return (
    <div className={styles.panelBody}>
      {!selected && <p className={styles.mutedCopy}>Select an element to see its animation properties.</p>}
      {selected && !motion.length && <p className={styles.mutedCopy}>No animation is attached directly. Check the parent, or pick a row in the timeline.</p>}
      {['scroll', 'media'].includes(activeMotion?.driver?.type) && (
        <p className={styles.motionScrollHint}>
          <ScrollText /> Driven by scroll — scroll the site to play this animation.
        </p>
      )}

      {activeMotion && <>
        <InspectorSection title="Animation" meta={motionCapabilityLabel(activeMotion.editability)}>
          <div className={styles.motionFactRow}>
            <span>{activeMotion.name}</span>
            <strong>{activeMotion.engine}</strong>
          </div>
          {activeGroup && (
            <div className={styles.motionFactRow}>
              <span>Group</span>
              <strong>{activeGroup.label} · {MOTION_GROUP_LABELS[activeGroup.type]} · {activeGroup.count} animations</strong>
            </div>
          )}
          <p className={styles.mutedCopy} data-editability={activeMotion.editability}>{EDITABILITY_EXPLAINED[activeMotion.editability] || EDITABILITY_EXPLAINED.code}</p>
        </InspectorSection>
        <InspectorSection title="Trigger" meta={motionDriverLabel(activeMotion.driver)}>
          <SelectField label="Driver" value={activeMotion.driver?.type || 'time'} disabled>
            <option value="time">Time</option>
            <option value="scroll">Scroll</option>
            <option value="media">Media</option>
            <option value="pointer">Pointer</option>
            <option value="event">Event</option>
          </SelectField>
          <div className={styles.motionFactRow}>
            <span>Trigger</span>
            <strong>{activeMotion.trigger?.type || 'Runtime'}</strong>
          </div>
          {activeMotion.trigger?.target && <div className={styles.motionFactRow}><span>Target</span><strong>{String(activeMotion.trigger.target)}</strong></div>}
        </InspectorSection>

        <InspectorSection title="Timing">
          <div className={styles.controlGrid}>
            <Field label="Delay" type="number" defaultValue={activeMotion.timing.delay} suffix="ms" disabled={!activeMotion.capabilities.timing} onCommit={(value) => commit('timing.delay', value, activeMotion.timing.delay)} />
            <Field label="Duration" type="number" defaultValue={activeMotion.timing.duration} suffix="ms" disabled={!activeMotion.capabilities.timing} onCommit={(value) => commit('timing.duration', value, activeMotion.timing.duration)} />
          </div>
          <div className={styles.controlGrid}>
            <Field label="Iterations" type="number" defaultValue={activeMotion.timing.iterations} disabled={!activeMotion.capabilities.timing} onCommit={(value) => commit('timing.iterations', value, activeMotion.timing.iterations)} />
            <Field label="Repeat delay" type="number" defaultValue={activeMotion.timing.repeatDelay} suffix="ms" disabled={!usesKnownAdapter} onCommit={(value) => commit('timing.repeatDelay', value, activeMotion.timing.repeatDelay)} />
          </div>
          <ToggleField label="Alternate direction" checked={activeMotion.timing.yoyo} disabled={!usesKnownAdapter} onCommit={(value) => commit('timing.yoyo', value, activeMotion.timing.yoyo)} />
          {staggerable && (
            <Field
              label="Stagger"
              type="number"
              suffix="ms"
              defaultValue={activeGroup.stagger ?? ''}
              onCommit={(value) => {
                // The shown value is a detected uniform spacing (empty when the
                // group has none) — an untouched blur must never rewrite the group.
                const raw = String(value).trim();
                if (!raw) return;
                const next = Number(raw);
                if (!Number.isFinite(next) || next === activeGroup.stagger) return;
                onStagger?.(activeGroup.clips, next);
              }}
            />
          )}
        </InspectorSection>

        <InspectorSection title="Easing">
          <SelectField label="Curve" value={activeMotion.timing.easing} disabled={!activeMotion.capabilities.easing} onCommit={(value) => commit('timing.easing', value, activeMotion.timing.easing)}>
            <option value={activeMotion.timing.easing}>{activeMotion.timing.easing}</option>
            <option value="linear">Linear</option>
            <option value="ease">Ease</option>
            <option value="ease-in">Ease in</option>
            <option value="ease-out">Ease out</option>
            <option value="ease-in-out">Ease in out</option>
            {usesKnownAdapter && <><option value="power2.out">Power out</option><option value="power2.inOut">Power in out</option></>}
          </SelectField>
          <div className={styles.curvePreview} aria-hidden="true"><i /><span /></div>
        </InspectorSection>

        {activeMotion.scroll && <InspectorSection title="Scroll" meta="Linked">
          <div className={styles.motionFactRow}><span>Start</span><strong>{activeMotion.scroll.start}</strong></div>
          <div className={styles.motionFactRow}><span>End</span><strong>{activeMotion.scroll.end}</strong></div>
          <div className={styles.toggleStack}>
            <ToggleField label="Scrub" checked={activeMotion.scroll.scrub} disabled />
            <ToggleField label="Pin" checked={activeMotion.scroll.pin} disabled />
            <ToggleField label="Snap" checked={activeMotion.scroll.snap} disabled />
          </div>
        </InspectorSection>}

        <InspectorSection title="Animated properties" meta={activeMotion.tracks.length}>
          <div className={styles.trackList}>
            {activeMotion.tracks.map((track) => (
              <div key={track.property}>
                <Diamond />
                <span>{track.property}</span>
                <small>{track.keyframes?.length || 0} keyframes</small>
              </div>
            ))}
            {!activeMotion.tracks.length && <p className={styles.mutedCopy}>The runtime owns these values. Timing remains editable through its adapter.</p>}
          </div>
        </InspectorSection>
      </>}
      {(selected?.warnings || []).map((warning) => <p className={styles.warning} key={warning}>{warning}</p>)}
    </div>
  );
}

function formatTimelineTime(milliseconds) {
  const seconds = Math.max(0, Number(milliseconds) || 0) / 1000;
  return `${seconds.toFixed(seconds >= 10 ? 1 : 2)}s`;
}

const KIND_ICON = { image: ImageIcon, text: Type, svg: Shapes, video: Film, canvas: Square, container: Layers };
const KIND_LABEL = { image: 'Image', text: 'Text', svg: 'Vector', video: 'Video', canvas: 'Canvas', container: 'Container' };

// (The old ViewportPanel lived here — dead code once the timeline became the
// full-page inventory. Its semantics moved into TimelinePanel's layer rows.)

// Figma Motion proportions: the collapsed timeline is 166px tall; the top-edge
// handle can grow it to double that. The labels column trades width with the
// track area through the vertical divider.
const TIMELINE_MIN_HEIGHT = 166;
const TIMELINE_MAX_HEIGHT = 332;
const LABELS_MIN_WIDTH = 110;
const LABELS_MAX_WIDTH = 340;
const LABELS_DEFAULT_WIDTH = 152;
// Breathing room before strips start (matches the transparent border-left on
// .rowTrack) — every x computation must account for it.
const TRACK_INSET = 5;
// Screen px per millisecond for TIME strips on the scroll axis: seconds have
// no natural page-pixel width, so this fixed scale makes duration visible and
// its right-edge drag meaningful (wider strip = longer = slower).
const TIME_PX_PER_MS = 0.06;

export function TimelinePanel({
  open,
  motion,
  rows = [],
  detailByRow = null,
  expandedLayers = null,
  onToggleLayer,
  activeMotionId = null,
  onActiveMotion,
  selectedElementId = null,
  onSelectElement,
  page = null,
  onScrollTo,
  onScrubIntro,
  onScrubStart,
  onScrubEnd,
  onUnlink,
  onStripEdit,
  state,
  speed,
  zoom,
  autoKeyframe,
  selectedKeyframe,
  labelsWidth = LABELS_DEFAULT_WIDTH,
  onLabelsWidth,
  bodyHeight = TIMELINE_MIN_HEIGHT,
  onBodyHeight,
  onToggle,
  onPlayback,
  onSpeed,
  onSeek,
  onZoom,
  onPlaybackMode,
  onAutoKeyframe,
  onSelectKeyframe,
  onMoveKeyframe,
  onDuplicateKeyframe,
  onDeleteKeyframe,
  onChangeKeyframeEasing,
  onChangeKeyframeValue,
  onChangeStepValue,
}) {
  const [draggingKeyframe, setDraggingKeyframe] = useState(null);
  const [draggingStrip, setDraggingStrip] = useState(null);
  const [curveOpen, setCurveOpen] = useState(false);
  const [scrubbing, setScrubbing] = useState(null);
  const [resizingHeight, setResizingHeight] = useState(null);
  const [resizingLabels, setResizingLabels] = useState(null);
  // Playhead time inside the INTRO lane (ms). null = the intro already played
  // out — the playhead lives on the page-scroll segment.
  const [introTime, setIntroTime] = useState(null);
  const suppressKeyframeClick = useRef(false);
  const scrollerRef = useRef(null);
  const duration = Math.max(1, state.duration || (motion ? motion.timing.delay + motion.timing.duration + motion.timing.endDelay : 1000));
  const currentTime = Math.max(0, Math.min(duration, state.currentTime || 0));
  const currentPercent = (currentTime / duration) * 100;
  const delay = Math.max(0, motion?.timing.delay || 0);
  const clipDuration = Math.max(1, motion?.timing.duration || duration);
  const clipStart = Math.min(100, (delay / duration) * 100);
  const clipWidth = Math.max(0.8, Math.min(100 - clipStart, (clipDuration / duration) * 100));
  // ONE ruler (§3b): when the bridge reports page metrics, the master axis is
  // the page scroll in pixels — every strip sits where it happens on the page.
  // Without page data (no runtime yet), fall back to the active motion's time.
  // Page metrics alone flip the ruler into scroll mode — gating on rows would
  // make the scrubber vanish whenever the user scrubs into a stretch with
  // nothing animated on screen, stranding them there.
  const scrollRuler = Boolean(page && page.maxScroll > 0);
  // ⚠️ BUG DA RÉGUA QUE FOGE DO MOUSE. A largura da régua saía da altura VIVA da
  // página, e arrastar a régua ROLA a página — em sites com elementos fixados a
  // altura oscila durante a rolagem, então a régua mudava de tamanho enquanto
  // estava sendo usada e as bordas ficavam impossíveis de clicar. Trava-se o
  // eixo e só se aceita mudança SUBSTANCIAL, a mesma regra de 2% que o bridge já
  // usa para não re-derivar pontos de revelação com o tremor do spacer.
  //
  // A trava vale SÓ para a régua de rolagem. Na régua de TEMPO, seguir a duração
  // é o comportamento certo: quando o usuário muda a duração no painel, a régua
  // deve acompanhar.
  // Durante o arraste, a régua usa o valor SENDO arrastado. Antes, só a faixa
  // arrastada se mexia e todo o resto pulava ao soltar.
  const duracaoNoArraste = draggingStrip?.kind === 'duration' && Number.isFinite(draggingStrip.durationMs)
    ? draggingStrip.durationMs
    : duration;
  const eixoVivo = scrollRuler ? Math.max(1, page.maxScroll) : duracaoNoArraste;
  const [eixoTravado, setEixoTravado] = useState(eixoVivo);
  useEffect(() => {
    if (!scrollRuler) return;
    setEixoTravado((antigo) => (
      !antigo || Math.abs(eixoVivo - antigo) > Math.max(48, antigo * 0.02) ? eixoVivo : antigo
    ));
  }, [scrollRuler, eixoVivo]);
  const axisMax = scrollRuler ? Math.max(1, eixoTravado) : duration;
  // §item-1: load-time animations (preloader, wipes, hero text) form an INTRO
  // segment BEFORE the page-scroll axis — a time sequence, laid out by the
  // page's own opening schedule, instead of a pile of strips on top of the hero.
  const introRows = scrollRuler ? rows.filter((row) => row.isIntro) : [];
  const introMs = introRows.length
    ? Math.max(1000, Math.min(30000, Math.max(...introRows.map((row) => Number(row.introEndMs) || 0))))
    : 0;
  const introPx = introMs ? Math.round(introMs * TIME_PX_PER_MS * zoom) : 0;
  const scrollPx = Math.round(Math.max(720, scrollRuler ? axisMax * 0.15 : duration * 0.42) * zoom);
  const timelineWidth = introPx + scrollPx;
  const introPct = introPx ? (introPx / timelineWidth) * 100 : 0;
  const scrollSpanPct = 100 - introPct;
  const introActive = introPx > 0 && introTime != null && introTime < introMs;
  const ticks = [];
  if (introPx > 0) {
    const stepMs = introMs <= 4000 ? 1000 : introMs <= 12000 ? 2000 : 5000;
    for (let tickMs = 0; tickMs < introMs; tickMs += stepMs) {
      ticks.push({ left: (tickMs / introMs) * introPct, label: `${Math.round(tickMs / 1000)}s`, intro: true });
    }
  }
  for (let index = 0; index <= 10; index += 1) {
    ticks.push({
      left: introPct + index * (scrollSpanPct / 10),
      label: scrollRuler ? `${Math.round((axisMax * index) / 10)}px` : formatTimelineTime((duration * index) / 10),
    });
  }
  // A time-driven clip is a POINT on the scroll axis (where it triggers) — its
  // extent is seconds, shown as a readout, not a scroll range.
  const NOMINAL_TIME_STRIP = 1.4;
  function stripGeometry(row) {
    const isScroll = row.driver === 'scroll';
    if (scrollRuler) {
      if (row.isIntro && introPx > 0) {
        const start = Math.max(0, Math.min(introMs, Number(row.introStartMs) || 0));
        const end = Math.max(start, Math.min(introMs, Number(row.introEndMs) || start));
        return {
          left: (start / introMs) * introPct,
          width: Math.max(NOMINAL_TIME_STRIP, ((end - start) / introMs) * introPct),
        };
      }
      const start = Math.max(0, Math.min(axisMax, Number(row.scrollStart) || 0));
      const left = introPct + (start / axisMax) * scrollSpanPct;
      const width = row.scrollEnd != null
        ? Math.max(0.8, ((Math.max(start, Math.min(axisMax, Number(row.scrollEnd))) - start) / axisMax) * scrollSpanPct)
        : Math.max(NOMINAL_TIME_STRIP, (((row.durationMs || 0) * TIME_PX_PER_MS * zoom) / Math.max(1, timelineWidth - TRACK_INSET)) * 100);
      return { left, width };
    }
    const rowScale = Math.max(1, ...rows.map((item) => (item.delayMs || 0) + (item.durationMs || 0)));
    return {
      left: isScroll ? 0 : ((row.delayMs || 0) / rowScale) * 100,
      width: isScroll ? 100 : Math.max(1.5, ((row.durationMs || 0) / rowScale) * 100),
    };
  }
  const activeRow = rows.find((row) => row.elementId === selectedElementId) || null;
  // How many rows each shared animation touches — a link is only a CHAIN when
  // it reaches at least two rows.
  const linkRowCount = {};
  rows.forEach((row) => (row.links || []).forEach((linkId) => {
    linkRowCount[linkId] = (linkRowCount[linkId] || 0) + 1;
  }));
  const playheadPercent = scrollRuler
    ? (introActive
      ? (introTime / introMs) * introPct
      : introPct + Math.min(scrollSpanPct, ((page.scrollY || 0) / axisMax) * scrollSpanPct))
    : currentPercent;
  const playbackMode = motion ? motionPlaybackMode(motion.timing) : 'once';
  const isPlaying = state.playState === 'running';
  const canAutoKeyframe = Boolean(motion?.capabilities?.keyframes && motion?.editability === 'direct');
  // Adapter (GSAP) keyframes are a start→end pair: selectable, value- and
  // easing-editable, but never movable/duplicable (a simple tween has no
  // middle — the writeback rejects intermediate offsets by design).
  const canSelectKeyframes = Boolean(motion?.capabilities?.keyframes);
  const isAdapterKeyframes = canSelectKeyframes && motion?.editability !== 'direct';
  const selectedTrack = motion && selectedKeyframe && motion.id === selectedKeyframe.motionId
    ? motion.tracks.find((track) => track.property === selectedKeyframe.property)
    : null;
  const orderedFrames = [...(selectedTrack?.keyframes || [])].sort((first, second) => Number(first.offset) - Number(second.offset));
  const selectedFrameIndex = orderedFrames.findIndex((keyframe) => Math.abs(Number(keyframe.offset) - Number(selectedKeyframe?.offset)) < 0.0005);
  const selectedFrame = selectedFrameIndex >= 0 ? orderedFrames[selectedFrameIndex] : null;
  const nextFrame = selectedFrameIndex >= 0 ? orderedFrames[selectedFrameIndex + 1] || null : null;

  useEffect(() => {
    function onKeyDown(event) {
      if (!selectedFrame) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.matches('input,select,textarea') || (target.matches('button') && !target.classList.contains(styles.timelineKeyframe)) || target.isContentEditable)) return;
      if (event.key === 'Backspace' || event.key === 'Delete') {
        event.preventDefault();
        if (!isAdapterKeyframes) onDeleteKeyframe(selectedKeyframe);
      } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'd') {
        event.preventDefault();
        if (!isAdapterKeyframes) onDuplicateKeyframe(selectedKeyframe);
      } else if (event.key === 'Escape') {
        setCurveOpen(false);
        onSelectKeyframe(null);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isAdapterKeyframes, onDeleteKeyframe, onDuplicateKeyframe, onSelectKeyframe, selectedFrame, selectedKeyframe]);

  useEffect(() => setCurveOpen(false), [selectedKeyframe?.motionId, selectedKeyframe?.property, selectedKeyframe?.offset]);

  // Clicking an element ON THE SITE must bring its timeline row into view —
  // vertically in the row list, and horizontally so its strip is visible.
  // `rows` is a dep so a selection made BEFORE its row arrives still lands;
  // the ref keeps later row updates from re-yanking the scroll position.
  const scrolledToRef = useRef(null);
  useEffect(() => {
    if (!open || !selectedElementId) return undefined;
    if (scrolledToRef.current === selectedElementId) return undefined;
    const scroller = scrollerRef.current;
    if (!scroller) return undefined;
    const frame = window.requestAnimationFrame(() => {
      const rowEl = scroller.querySelector(`[data-element-row="${selectedElementId}"]`);
      if (!rowEl) return;
      scrolledToRef.current = selectedElementId;
      const rowBox = rowEl.getBoundingClientRect();
      const box = scroller.getBoundingClientRect();
      const rulerHeight = 26;
      if (rowBox.top < box.top + rulerHeight || rowBox.bottom > box.bottom) {
        scroller.scrollTop += rowBox.top - (box.top + rulerHeight + 28);
      }
      const strip = rowEl.querySelector('[data-layer-strip]');
      if (strip) {
        const stripBox = strip.getBoundingClientRect();
        const viewLeft = box.left + labelsWidth;
        if (stripBox.right < viewLeft + 8 || stripBox.left > box.right - 8) {
          scroller.scrollLeft += stripBox.left - (viewLeft + 24);
        }
      }
    });
    return () => window.cancelAnimationFrame(frame);
    // labelsWidth intentionally omitted: resizing the labels column must not
    // yank the scroll position back to the selected row.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, selectedElementId, rows]);

  function offsetAtPointer(event, rect) {
    // rect is a rowTrack border box; strips live in its padding box, which
    // starts after the TRACK_INSET transparent border.
    const pointerPercent = Math.max(0, Math.min(100, ((event.clientX - rect.left - TRACK_INSET) / Math.max(1, rect.width - TRACK_INSET)) * 100));
    if (scrollRuler && activeRow) {
      const strip = stripGeometry(activeRow);
      return Math.max(0, Math.min(1, (pointerPercent - strip.left) / Math.max(0.001, strip.width)));
    }
    const timelineTime = (pointerPercent / 100) * duration;
    return Math.max(0, Math.min(1, (timelineTime - delay) / clipDuration));
  }

  function keyframeLeft(displayOffset) {
    if (scrollRuler && activeRow) {
      const strip = stripGeometry(activeRow);
      return Math.min(100, strip.left + displayOffset * strip.width);
    }
    return Math.min(100, ((delay + displayOffset * clipDuration) / duration) * 100);
  }

  // A GSAP start/end pair cannot move as a keyframe — but its diamonds still
  // map to timing: dragging the END stretches DURATION, dragging the START
  // slides DELAY. Time-driven adapters only; a scrubbed tween has no clock.
  const adapterTimingDrag = isAdapterKeyframes && motion?.driver?.type === 'time' && Boolean(motion?.capabilities?.timing);

  function beginKeyframeDrag(event, track, keyframe) {
    if (event.button !== 0) return;
    const canvas = event.currentTarget.closest(`.${styles.rowTrack}`);
    if (!canvas) return;
    const offset = Number(keyframe.offset) || 0;
    event.preventDefault();
    event.stopPropagation();
    // ⚠️ SELECIONAR sempre funciona, mesmo onde ARRASTAR não é permitido. Antes
    // a função desistia antes daqui, então o diamante não respondia a nada em
    // trilhas travadas — e o usuário só conseguia selecionar pelas setas da
    // linha da propriedade, que chamam isto direto.
    onSelectKeyframe({ motionId: motion.id, property: track.property, offset });
    if (!canAutoKeyframe && !adapterTimingDrag) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    if (adapterTimingDrag) {
      const timingEdge = offset >= 0.999 ? 'duration' : offset <= 0.001 ? 'delay' : null;
      if (!timingEdge) return;
      setDraggingKeyframe({
        pointerId: event.pointerId,
        property: track.property,
        originalOffset: offset,
        offset,
        rect: canvas.getBoundingClientRect(),
        timingEdge,
        startX: event.clientX,
        initialDurationMs: Math.max(50, Math.round(Number(motion.timing.duration) || 50)),
        initialDelayMs: Math.max(0, Math.round(Number(motion.timing.delay) || 0)),
        valueMs: null,
        duplicate: false,
        moved: false,
      });
      return;
    }
    onSeek(delay + offset * clipDuration);
    setDraggingKeyframe({
      pointerId: event.pointerId,
      property: track.property,
      originalOffset: offset,
      offset,
      rect: canvas.getBoundingClientRect(),
      duplicate: event.altKey,
      moved: false,
    });
  }

  function updateKeyframeDrag(event) {
    if (!draggingKeyframe || event.pointerId !== draggingKeyframe.pointerId) return;
    if (draggingKeyframe.timingEdge) {
      // Same px→ms scale the strips are drawn at, so the drag tracks the ruler.
      const pxPerMs = scrollRuler ? TIME_PX_PER_MS * zoom : (Math.max(1, timelineWidth) / Math.max(1, duration));
      const deltaMs = (event.clientX - draggingKeyframe.startX) / Math.max(0.0001, pxPerMs);
      setDraggingKeyframe((current) => {
        if (!current) return current;
        const valueMs = current.timingEdge === 'duration'
          ? Math.max(50, Math.round(current.initialDurationMs + deltaMs))
          : Math.max(0, Math.round(current.initialDelayMs + deltaMs));
        return { ...current, valueMs, moved: true };
      });
      return;
    }
    const offset = offsetAtPointer(event, draggingKeyframe.rect);
    setDraggingKeyframe((current) => current ? {
      ...current,
      offset,
      moved: current.moved || Math.abs(offset - current.originalOffset) > 0.001,
    } : current);
    onSeek(delay + offset * clipDuration);
  }

  function finishKeyframeDrag(event) {
    if (!draggingKeyframe || event.pointerId !== draggingKeyframe.pointerId) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (draggingKeyframe.timingEdge) {
      const finished = draggingKeyframe;
      setDraggingKeyframe(null);
      if (finished.moved && finished.valueMs != null) {
        suppressKeyframeClick.current = true;
        onStripEdit?.(activeRow, finished.timingEdge === 'duration'
          ? { durationMs: finished.valueMs }
          : { delayMs: finished.valueMs });
        window.setTimeout(() => { suppressKeyframeClick.current = false; }, 0);
      }
      return;
    }
    const selection = { motionId: motion.id, property: draggingKeyframe.property, offset: draggingKeyframe.originalOffset };
    if (draggingKeyframe.moved) {
      suppressKeyframeClick.current = true;
      if (draggingKeyframe.duplicate) onDuplicateKeyframe(selection, draggingKeyframe.offset);
      else onMoveKeyframe(selection, draggingKeyframe.offset);
      window.setTimeout(() => { suppressKeyframeClick.current = false; }, 0);
    }
    setDraggingKeyframe(null);
  }

  // §3b: the strip IS the control. Dragging an edge retargets the ScrollTrigger
  // range in page pixels (writeback probe-verified). Scroll-driven strips only —
  // a time strip is a trigger point here; its extent is edited as duration.
  function beginStripDrag(event, row, edge, kind = 'scroll') {
    if (event.button !== 0) return;
    const canvas = event.currentTarget.closest(`.${styles.rowTrack}`);
    if (!canvas) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    // Duration drags are DELTA-based against the ACTIVE clip's own duration —
    // the drawn strip is the row's merged envelope (with a minimum visual
    // width), so absolute px→ms mapping would jump on the first pixel.
    const initialDurationMs = kind === 'duration'
      ? Math.max(1, Math.round(Number(motion?.timing?.duration) || Number(row.durationMs) || 0))
      : Number(row.durationMs) || 0;
    setDraggingStrip({
      pointerId: event.pointerId,
      elementId: row.elementId,
      edge,
      kind,
      rect: canvas.getBoundingClientRect(),
      startX: event.clientX,
      initialDurationMs,
      start: Number(row.scrollStart) || 0,
      end: Number(row.scrollEnd) || 0,
      durationMs: initialDurationMs,
      moved: false,
    });
  }

  function stripScrollAtPointer(event, rect) {
    // Strip handles live on the SCROLL segment — subtract the intro lane,
    // measured in the same padding-box space the strips draw in.
    const paddingWidth = Math.max(1, rect.width - TRACK_INSET);
    const introEdge = (introPct / 100) * paddingWidth;
    const px = event.clientX - rect.left - TRACK_INSET - introEdge;
    const span = Math.max(1, paddingWidth - introEdge);
    const percent = Math.max(0, Math.min(100, (px / span) * 100));
    return Math.round((percent / 100) * axisMax);
  }

  // ⚠️ SUAVIDADE: o ponteiro dispara muito mais que o vídeo desenha. Sem
  // coalescer, cada evento força um render e o arraste fica "duro" — a mesma
  // razão pela qual o canvas trata o gesto como caminho sagrado. Guarda-se o
  // último evento e aplica-se UM por quadro.
  const quadroDoArraste = useRef(null);
  const eventoPendente = useRef(null);
  function updateStripDrag(eventoBruto, row) {
    const evento = { clientX: eventoBruto.clientX, clientY: eventoBruto.clientY, pointerId: eventoBruto.pointerId };
    // O PRIMEIRO movimento do quadro é aplicado na hora — resposta instantânea.
    // Os seguintes só guardam o último e um único quadro os aplica, para não
    // renderizar várias vezes entre dois desenhos da tela.
    if (!quadroDoArraste.current) {
      aplicaArrasteDeStrip(evento, row);
      quadroDoArraste.current = requestAnimationFrame(() => {
        quadroDoArraste.current = null;
        const pendente = eventoPendente.current;
        eventoPendente.current = null;
        if (pendente) aplicaArrasteDeStrip(pendente, row);
      });
      return;
    }
    eventoPendente.current = evento;
  }

  useEffect(() => () => { if (quadroDoArraste.current) cancelAnimationFrame(quadroDoArraste.current); }, []);

  function aplicaArrasteDeStrip(event, row) {
    if (!draggingStrip || event.pointerId !== draggingStrip.pointerId) return;
    if (draggingStrip.kind === 'duration') {
      // Delta px → delta ms: stretching right = longer = slower.
      const durationMs = Math.max(50, Math.round(draggingStrip.initialDurationMs + (event.clientX - draggingStrip.startX) / (TIME_PX_PER_MS * zoom)));
      setDraggingStrip((current) => current ? { ...current, durationMs, moved: true } : current);
      return;
    }
    const value = stripScrollAtPointer(event, draggingStrip.rect);
    setDraggingStrip((current) => {
      if (!current) return current;
      if (current.edge === 'start') {
        return { ...current, start: Math.min(value, current.end - 1), moved: true };
      }
      return { ...current, end: Math.max(value, current.start + 1), moved: true };
    });
  }

  function finishStripDrag(event, row) {
    if (!draggingStrip || event.pointerId !== draggingStrip.pointerId) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    const finished = draggingStrip;
    setDraggingStrip(null);
    if (!finished.moved) return;
    if (finished.kind === 'duration') {
      onStripEdit?.(row, { durationMs: finished.durationMs });
      return;
    }
    onStripEdit?.(row, finished.edge === 'start' ? { start: finished.start } : { end: finished.end });
  }

  // ---- Scrub: the playhead is DRAGGED OVER fixed strips. Clicking or dragging
  // anywhere on empty track area moves the page scroll (or the clip time),
  // never the strips themselves.
  function applyScrub(event) {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left - labelsWidth - TRACK_INSET;
    // Left of the boundary the playhead scrubs the INTRO sequence by time;
    // right of it, the page scroll — crossing rightward parks the intro at its
    // finished state so the hero shows what the site shows after load.
    // Strips draw in the PADDING box (percent of width − inset), so the
    // boundary in pointer space is introPct of that same box, not introPx raw.
    const introEdge = introPx > 0 ? (introPct / 100) * (timelineWidth - TRACK_INSET) : 0;
    if (scrollRuler && introEdge > 0 && x < introEdge) {
      const timeMs = Math.max(0, Math.min(introMs, (x / introEdge) * introMs));
      setIntroTime(timeMs);
      onScrubIntro?.(timeMs);
      return;
    }
    if (introActive) {
      setIntroTime(null);
      onScrubIntro?.(introMs);
    }
    const pct = Math.max(0, Math.min(1, (x - introEdge) / Math.max(1, (timelineWidth - TRACK_INSET) - introEdge)));
    if (scrollRuler) onScrollTo?.(Math.round(pct * axisMax));
    else if (motion) onSeek?.(pct * duration);
  }

  function beginScrub(event) {
    if (event.button !== 0) return;
    if (event.target.closest('button,input,select,textarea')) return;
    // The labels column is STICKY: on a horizontally-scrolled timeline it
    // covers surface-x [scrollLeft, scrollLeft+labelsWidth] — guard against
    // the SCROLLER viewport, not the surface, or label clicks scrub a track
    // position hidden underneath.
    const scroller = event.currentTarget.parentElement;
    const viewportRect = (scroller || event.currentTarget).getBoundingClientRect();
    if (event.clientX - viewportRect.left < labelsWidth) return;
    event.preventDefault(); // no text selection while dragging the playhead
    event.currentTarget.setPointerCapture?.(event.pointerId);
    onScrubStart?.();
    setScrubbing({ pointerId: event.pointerId });
    applyScrub(event);
  }

  function moveScrub(event) {
    if (scrubbing && event.pointerId === scrubbing.pointerId) applyScrub(event);
  }

  function endScrub(event) {
    if (!scrubbing || event.pointerId !== scrubbing.pointerId) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    setScrubbing(null);
    onScrubEnd?.();
  }

  // ---- Panel resizes: top edge grows the timeline (up to 2×), the vertical
  // divider trades label width for track width.
  function beginHeightResize(event) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setResizingHeight({ pointerId: event.pointerId, startY: event.clientY, startHeight: bodyHeight });
  }

  function moveHeightResize(event) {
    if (!resizingHeight || event.pointerId !== resizingHeight.pointerId) return;
    const next = resizingHeight.startHeight + (resizingHeight.startY - event.clientY);
    onBodyHeight?.(Math.max(TIMELINE_MIN_HEIGHT, Math.min(TIMELINE_MAX_HEIGHT, Math.round(next))));
  }

  function endHeightResize(event) {
    if (!resizingHeight || event.pointerId !== resizingHeight.pointerId) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    setResizingHeight(null);
  }

  function beginLabelsResize(event) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setResizingLabels({ pointerId: event.pointerId, startX: event.clientX, startWidth: labelsWidth });
  }

  function moveLabelsResize(event) {
    if (!resizingLabels || event.pointerId !== resizingLabels.pointerId) return;
    const next = resizingLabels.startWidth + (event.clientX - resizingLabels.startX);
    onLabelsWidth?.(Math.max(LABELS_MIN_WIDTH, Math.min(LABELS_MAX_WIDTH, Math.round(next))));
  }

  function endLabelsResize(event) {
    if (!resizingLabels || event.pointerId !== resizingLabels.pointerId) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    setResizingLabels(null);
  }

  // Where the playhead currently sits INSIDE the active clip, 0..1 — feeds the
  // property-row steppers and the current-value readout.
  function currentClipOffset() {
    if (scrollRuler && activeRow) {
      if (activeRow.isIntro && introPx > 0) {
        const start = Number(activeRow.introStartMs) || 0;
        const span = Math.max(1, (Number(activeRow.introEndMs) || start) - start);
        const timeMs = introActive ? introTime : introMs;
        return Math.max(0, Math.min(1, (timeMs - start) / span));
      }
      const start = Number(activeRow.scrollStart) || 0;
      const end = Number(activeRow.scrollEnd);
      const span = Number.isFinite(end) ? Math.max(1, end - start) : Math.max(1, page.viewportHeight || 1);
      return Math.max(0, Math.min(1, ((page.scrollY || 0) - start) / span));
    }
    return Math.max(0, Math.min(1, (currentTime - delay) / clipDuration));
  }

  function seekToOffset(offset) {
    if (scrollRuler && activeRow) {
      if (activeRow.isIntro && introPx > 0) {
        const start = Number(activeRow.introStartMs) || 0;
        const span = Math.max(1, (Number(activeRow.introEndMs) || start) - start);
        const timeMs = Math.max(0, Math.min(introMs, start + offset * span));
        setIntroTime(timeMs);
        onScrubIntro?.(timeMs);
        return;
      }
      const start = Number(activeRow.scrollStart) || 0;
      const end = Number(activeRow.scrollEnd);
      const span = Number.isFinite(end) ? Math.max(1, end - start) : Math.max(1, page.viewportHeight || 1);
      onScrollTo?.(Math.round(start + offset * span));
      return;
    }
    onSeek?.(delay + offset * clipDuration);
  }

  // Tweens are named after their element, so two animations on the same
  // element are homonyms — differentiate them by what they animate (and by
  // duration when even that collides).
  function clipDisplayName(clip, clips) {
    const homonyms = clips.filter((item) => item.name === clip.name);
    if (homonyms.length < 2) return clip.name;
    const property = clip.tracks?.[0]?.property || null;
    if (property && homonyms.filter((item) => (item.tracks?.[0]?.property || null) === property).length < 2) {
      return `${clip.name} · ${property}`;
    }
    const duration = Number(clip.timing?.duration) || 0;
    return `${clip.name} · ${property ? `${property} · ` : ''}${(duration / 1000).toFixed(1)}s`;
  }

  // A sub-row clip strip sits at its own scroll pixels when it has them,
  // otherwise it inherits the layer strip (same widget, same place).
  function clipGeometry(row, clip) {
    if (scrollRuler) {
      const start = Number(clip?.scroll?.start);
      const end = Number(clip?.scroll?.end);
      if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
        const left = introPct + (Math.max(0, Math.min(axisMax, start)) / axisMax) * scrollSpanPct;
        const width = Math.max(0.8, ((Math.min(axisMax, end) - Math.max(0, start)) / axisMax) * scrollSpanPct);
        return { left, width };
      }
      return stripGeometry(row);
    }
    const scale = Math.max(1, (clip?.timing?.delay || 0) + (clip?.timing?.duration || 0), duration);
    return {
      left: ((clip?.timing?.delay || 0) / scale) * 100,
      width: Math.max(1.5, ((clip?.timing?.duration || 0) / scale) * 100),
    };
  }

  // Why a track's step (keyframe) edits are locked — published by the adapter
  // per track so the field explains itself instead of dead-ending (Sol v6).
  const KEYFRAME_LOCK_REASONS = {
    stagger: 'Shared by a staggered group — unchain the layer (chain icon) to edit it independently.',
    'multi-target': 'Shared by multiple targets — unchain the layer (chain icon) to edit it independently.',
    'css-wrapper': "This value lives in the tween's legacy css wrapper — step editing isn't supported yet.",
    keyframes: 'Driven by GSAP keyframes — its steps cannot be edited safely yet.',
    from: 'A gsap.from() holds the start, not the end — read-only.',
    plugin: 'Driven by a GSAP plugin — read-only.',
    sampling: 'This track could not be sampled — read-only.',
  };
  function keyframeLockText(track) {
    return KEYFRAME_LOCK_REASONS[track?.keyframeEditReason] || "This step value can't be edited safely yet.";
  }

  // Fase-2: why ONE step diamond is locked while its track edits — the frozen
  // trailing run belongs to the end keyframe.
  function stepLockText(step) {
    if (step?.reason === 'final') return 'This step holds the final value — edit the end keyframe.';
    return KEYFRAME_LOCK_REASONS[step?.reason] || "This step value can't be edited safely yet.";
  }

  function renderTrackCell(track) {
    return (
      <div className={styles.rowTrack} data-track-row={track.property}>
        {(track.keyframes || []).map((keyframe, index) => {
          const offset = Number.isFinite(Number(keyframe.offset)) ? Number(keyframe.offset) : 0;
          const isDragging = draggingKeyframe?.property === track.property && Math.abs(draggingKeyframe.originalOffset - offset) < 0.0005;
          const displayOffset = isDragging ? draggingKeyframe.offset : offset;
          const left = keyframeLeft(displayOffset);
          const isSelected = selectedKeyframe?.motionId === motion.id && selectedKeyframe.property === track.property && Math.abs(Number(selectedKeyframe.offset) - offset) < 0.0005;
          return (
            <button
              type="button"
              key={`${track.property}:${offset}:${index}`}
              className={styles.timelineKeyframe}
              data-selected={isSelected || isDragging}
              data-duplicate={isDragging && draggingKeyframe.duplicate}
              data-keyframe-property={track.property}
              data-keyframe-value={String(keyframe.value ?? '')}
              data-keyframe-offset={String(displayOffset)}
              style={{ left: `${left}%` }}
              title={canAutoKeyframe
                ? `${track.property}: ${keyframe.value}. Drag to move, Option-drag to duplicate.`
                : !trackKeyframeEditable(track)
                  ? `${track.property}: ${keyframe.value}. ${keyframeLockText(track)}`
                  : adapterTimingDrag
                    ? `${track.property}: ${keyframe.value}. Edit the value in the label; drag the end diamond to stretch duration, the start diamond to slide delay.`
                    : canSelectKeyframes
                      ? `${track.property}: ${keyframe.value}. Click to select and edit its value in the label; GSAP start/end cannot be moved.`
                      : `${track.property}: ${keyframe.value}. This track is read-only.`}
              aria-label={`${track.property} keyframe at ${Math.round(offset * 100)} percent`}
              aria-pressed={isSelected}
              // ⚠️ NÃO desabilitar por `canSelectKeyframes`. Essa capacidade diz
              // se dá para ESCREVER na trilha; usá-la aqui fazia o botão inteiro
              // ficar inerte, e um botão desabilitado não recebe evento nenhum —
              // então em trilha somente-leitura o diamante não respondia a nada.
              // Selecionar e inspecionar não exigem permissão de escrita; quem
              // barra a edição é o writer, que já checa a capacidade.
              data-readonly={!canSelectKeyframes || undefined}
              onClick={() => {
                if (suppressKeyframeClick.current) return;
                onSelectKeyframe({ motionId: motion.id, property: track.property, offset });
                onSeek(delay + offset * clipDuration);
              }}
              onDoubleClick={() => { if (isSelected && nextFrame) setCurveOpen(true); }}
              onPointerDown={(event) => beginKeyframeDrag(event, track, keyframe)}
              onPointerMove={updateKeyframeDrag}
              onPointerUp={finishKeyframeDrag}
              onPointerCancel={() => setDraggingKeyframe(null)}
            />
          );
        })}
        {/* Fase-2: one diamond per addressable ENTRY (rawEntryIndex is the
            address; offset only positions). The terminal step is hidden by
            IDENTITY (isEnd — the end diamond above already shows it), never by
            numeric offset: Number(null) coerces to 0 and a zero-duration shape
            publishes null/duplicated offsets (Sol r4). A null offset falls
            back to even spacing by order. */}
        {(() => {
          const renderedSteps = (track.steps || []).filter((step) => !step.isEnd);
          // GLOBAL slot allocation (Sol r8/r9): stacked absolute buttons make
          // the covered address unclickable, and a local per-duplicate nudge
          // just re-collides with the NEXT occupied position ([0.50,0.50,0.52])
          // or with the START/END diamonds (a non-terminal step at 1). Every
          // diamond claims a slot on a 2% grid; each step takes the nearest
          // free slot (right first, then left). The REAL offset still drives
          // seek and selection.
          const occupiedSlots = new Set((track.keyframes || [])
            .map((keyframe) => (Number.isFinite(Number(keyframe.offset)) ? Number(keyframe.offset) : 0).toFixed(2)));
          const claimSlot = (desired) => {
            for (let distance = 0; distance <= 50; distance += 1) {
              const rightSlot = Math.min(1, desired + distance * 0.02);
              if (!occupiedSlots.has(rightSlot.toFixed(2))) {
                occupiedSlots.add(rightSlot.toFixed(2));
                return rightSlot;
              }
              const leftSlot = Math.max(0, desired - distance * 0.02);
              if (!occupiedSlots.has(leftSlot.toFixed(2))) {
                occupiedSlots.add(leftSlot.toFixed(2));
                return leftSlot;
              }
            }
            return desired;
          };
          return renderedSteps.map((step, index, list) => {
            const fallback = (index + 1) / (list.length + 1);
            const realOffset = step.offset == null ? fallback : Number(step.offset);
            const displayOffset = claimSlot(realOffset);
            const left = keyframeLeft(displayOffset);
            const isSelected = selectedKeyframe?.motionId === motion.id
              && selectedKeyframe.property === track.property
              && selectedKeyframe.entryIndex === step.entryIndex;
            return (
              <button
                type="button"
                key={`step:${track.property}:${step.entryIndex}`}
                className={styles.timelineKeyframe}
                data-step
                data-selected={isSelected}
                data-locked={!step.editable || undefined}
                style={{ left: `${left}%` }}
                title={step.editable
                  ? `${track.property} step: ${step.value}. Click to select and edit its value in the label.`
                  : `${track.property} step: ${step.value}. ${stepLockText(step)}`}
                aria-label={`${track.property} step ${step.entryIndex + 1}`}
                aria-pressed={isSelected}
                onClick={() => {
                  if (suppressKeyframeClick.current) return;
                  onSelectKeyframe({ motionId: motion.id, property: track.property, entryIndex: step.entryIndex, offset: realOffset });
                  onSeek(delay + realOffset * clipDuration);
                }}
              />
            );
          });
        })()}
      </div>
    );
  }

  // Property row: Figma-style label cell — name, `< ◇ >` steppers and the
  // value at the playhead — paired with its diamonds track cell.
  function renderPropertyRow(track) {
    const frames = [...(track.keyframes || [])].sort((first, second) => Number(first.offset) - Number(second.offset));
    const current = currentClipOffset();
    const epsilon = 0.0005;
    const previous = [...frames].reverse().find((keyframe) => Number(keyframe.offset) < current - epsilon) || null;
    const following = frames.find((keyframe) => Number(keyframe.offset) > current + epsilon) || null;
    const atPlayhead = frames.find((keyframe) => Math.abs(Number(keyframe.offset) - current) <= epsilon) || null;
    const valueSource = atPlayhead || previous || frames[0] || null;
    // The label's value field edits the SELECTED keyframe when one is picked on
    // this track; otherwise the keyframe under the playhead.
    const selectedOnTrack = selectedKeyframe && selectedKeyframe.motionId === motion.id && selectedKeyframe.property === track.property
      && selectedKeyframe.entryIndex == null
      ? frames.find((keyframe) => Math.abs(Number(keyframe.offset) - Number(selectedKeyframe.offset)) < 0.0005) || null
      : null;
    // Fase-2: a selected STEP points the label field at the entry value —
    // addressed by rawEntryIndex, never by its (possibly duplicated) offset.
    const selectedStep = selectedKeyframe && selectedKeyframe.motionId === motion.id && selectedKeyframe.property === track.property
      && selectedKeyframe.entryIndex != null
      ? (track.steps || []).find((step) => step.entryIndex === selectedKeyframe.entryIndex) || null
      : null;
    const editSource = selectedOnTrack || valueSource;
    const nearest = atPlayhead || previous || following;
    const jumpTo = (keyframe) => {
      const offset = Number(keyframe.offset) || 0;
      onSelectKeyframe?.({ motionId: motion.id, property: track.property, offset });
      seekToOffset(offset);
    };
    return (
      <div key={track.property} className={styles.timelineRow} data-row-kind="property">
        <div className={styles.rowLabel} data-cell="property" data-selected={selectedTrack?.property === track.property}>
          <span className={styles.propertyName}>{track.property}</span>
          <span className={styles.keyframeSteppers}>
            <button type="button" aria-label={`Previous ${track.property} keyframe`} disabled={!previous} onClick={() => previous && jumpTo(previous)}>‹</button>
            <button
              type="button"
              aria-label={`Add ${track.property} keyframe`}
              data-on-keyframe={Boolean(atPlayhead)}
              disabled={!canAutoKeyframe || isAdapterKeyframes || Boolean(atPlayhead) || !nearest}
              title={canAutoKeyframe && !isAdapterKeyframes
                ? (atPlayhead ? 'The playhead is on a keyframe' : 'Add a keyframe at the playhead')
                : 'Adding keyframes requires an editable CSS or WAAPI animation'}
              onClick={() => {
                if (!nearest) return;
                onDuplicateKeyframe?.({ motionId: motion.id, property: track.property, offset: Number(nearest.offset) || 0 }, current);
              }}
            ><Diamond /></button>
            <button type="button" aria-label={`Next ${track.property} keyframe`} disabled={!following} onClick={() => following && jumpTo(following)}>›</button>
          </span>
          {selectedStep ? (
            selectedStep.editable ? (
              <input
                className={styles.propertyValueInput}
                key={`${track.property}:step:${selectedStep.entryIndex}:${selectedStep.value}`}
                defaultValue={String(selectedStep.value)}
                title={`${track.property} step value — type to change it`}
                aria-label={`${track.property} step value`}
                onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }}
                onBlur={(event) => {
                  const next = event.currentTarget.value;
                  if (next !== String(selectedStep.value)) {
                    onChangeStepValue?.({ motionId: motion.id, property: track.property, entryIndex: selectedStep.entryIndex }, next);
                  }
                }}
              />
            ) : (
              <span className={styles.propertyValue} title={stepLockText(selectedStep)}>
                {String(selectedStep.value).slice(0, 14)}
              </span>
            )
          ) : canSelectKeyframes && trackKeyframeEditable(track) && editSource ? (
            <input
              className={styles.propertyValueInput}
              key={`${track.property}:${editSource.offset}:${editSource.value}`}
              defaultValue={String(editSource.value)}
              title={`${track.property} value at this keyframe — type to change it`}
              aria-label={`${track.property} keyframe value`}
              onFocus={() => onSelectKeyframe?.({ motionId: motion.id, property: track.property, offset: Number(editSource.offset) || 0 })}
              onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }}
              onBlur={(event) => {
                const next = event.currentTarget.value;
                if (next !== String(editSource.value)) {
                  onChangeKeyframeValue?.({ motionId: motion.id, property: track.property, offset: Number(editSource.offset) || 0 }, next);
                }
              }}
            />
          ) : (
            <span
              className={styles.propertyValue}
              title={!trackKeyframeEditable(track)
                ? keyframeLockText(track)
                : (valueSource ? String(valueSource.value) : '')}
            >
              {valueSource ? String(valueSource.value).slice(0, 14) : ''}
            </span>
          )}
        </div>
        {renderTrackCell(track)}
      </div>
    );
  }

  return (
    <section className={`${styles.timeline} ${open ? styles.timelineOpen : styles.timelineClosed}`} aria-label="Animation timeline">
      {open && (
        <div
          className={styles.timelineHeightHandle}
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize the timeline"
          title="Drag to resize the timeline"
          onPointerDown={beginHeightResize}
          onPointerMove={moveHeightResize}
          onPointerUp={endHeightResize}
          onPointerCancel={endHeightResize}
        />
      )}
      <header
        className={styles.timelineHeader}
        // Clicar em QUALQUER lugar da aba abre e fecha a timeline. Só os
        // controles de verdade ficam de fora — senão apertar "play" ou trocar o
        // zoom fecharia o painel junto.
        onClick={(event) => {
          if (event.target.closest('button, select, input, a, [role="slider"], [role="menu"]')) return;
          onToggle();
        }}
        title={open ? 'Collapse timeline' : 'Open timeline'}
      >
        <button type="button" className={styles.timelineDisclosure} onClick={onToggle} aria-expanded={open} title={open ? 'Collapse timeline' : 'Open timeline'}>
          <ChevronDown />
          <strong>Timeline</strong>
        </button>
        <span className={styles.timelineMotionName}>{motion ? `${motion.name} · ${motion.engine}` : 'Select an animation in Motion'}</span>
        <div className={styles.timelineTransport}>
          {/* Scroll-driven clips have no transport: the site's scroll IS the playhead.
              Showing an inert play button was the single most confusing control here. */}
          {['scroll', 'media'].includes(motion?.driver?.type) ? (
            <span className={styles.timelineScrollHint} title="This layer is driven by scroll — scroll the site to play it">
              <ScrollText /> scroll to play
            </span>
          ) : (
            <>
              <button type="button" disabled={!motion} onClick={() => onPlayback('restart')} title="Restart this layer"><RotateCcw /></button>
              <button type="button" disabled={!motion} onClick={() => onPlayback(isPlaying ? 'pause' : 'play')} title={isPlaying ? 'Pause this layer' : 'Play this layer'}>
                {isPlaying ? <Pause /> : <Play />}
              </button>
            </>
          )}
          <button
            type="button"
            className={styles.autoKeyframe}
            aria-pressed={autoKeyframe}
            disabled={!canAutoKeyframe}
            onClick={() => onAutoKeyframe(!autoKeyframe)}
            title={canAutoKeyframe ? 'Create keyframes when animated properties change' : 'Auto keyframe requires an editable CSS or WAAPI animation'}
          ><Diamond /><span>Auto</span></button>
          <span className={styles.keyframeActions} aria-label="Selected keyframe actions">
            <button
              type="button"
              disabled={!selectedFrame || isAdapterKeyframes}
              onClick={() => onDuplicateKeyframe(selectedKeyframe)}
              title={isAdapterKeyframes ? 'A GSAP tween has only a start and an end — keyframes cannot be duplicated' : 'Duplicate keyframe (⌘D)'}
              aria-label="Duplicate keyframe (⌘D)"
            ><Copy /></button>
            <button
              type="button"
              disabled={!selectedFrame || isAdapterKeyframes}
              onClick={() => onDeleteKeyframe(selectedKeyframe)}
              title={isAdapterKeyframes
                ? 'A GSAP start/end pair cannot be deleted — edit its value instead'
                : 'Delete keyframe'}
              aria-label="Delete keyframe"
            ><Trash2 /></button>
            <button
              type="button"
              aria-pressed={curveOpen}
              disabled={!nextFrame || isAdapterKeyframes}
              onClick={() => setCurveOpen((current) => !current)}
              title={isAdapterKeyframes
                ? 'GSAP curves are edited in the Easing section'
                : nextFrame ? 'Edit curve to next keyframe' : 'Select a keyframe with a following frame'}
              aria-label="Edit curve to next keyframe"
            ><Gauge /></button>
          </span>
          <code>{formatTimelineTime(currentTime)} / {formatTimelineTime(duration)}</code>
          <select aria-label="Playback mode" disabled={!motion} value={playbackMode} onChange={(event) => onPlaybackMode(event.currentTarget.value)}>
            <option value="once">Once</option>
            <option value="loop">Loop</option>
            <option value="ping-pong">Ping-pong</option>
          </select>
          <select aria-label="Playback speed" disabled={!motion} value={speed} onChange={(event) => onSpeed(Number(event.currentTarget.value))}>
            <option value="0.25">0.25×</option>
            <option value="0.5">0.5×</option>
            <option value="1">1×</option>
            <option value="2">2×</option>
          </select>
          <label className={styles.timelineZoom} title="Timeline zoom">
            <span>Zoom</span>
            <input type="range" min="1" max="4" step="0.25" value={zoom} onChange={(event) => onZoom(Number(event.currentTarget.value))} />
          </label>
        </div>
      </header>

      {open && <div className={styles.timelineBody} style={{ height: bodyHeight }}>
        <div className={styles.timelineScroller} ref={scrollerRef}>
          <div
            className={styles.timelineSurface}
            data-timeline-surface
            style={{ width: labelsWidth + timelineWidth, '--labels-w': `${labelsWidth}px`, '--track-w': `${timelineWidth}px` }}
            onPointerDown={beginScrub}
            onPointerMove={moveScrub}
            onPointerUp={endScrub}
            onPointerCancel={endScrub}
          >
            <div className={styles.timelineRow} data-row-kind="ruler">
              <div className={styles.rowLabel} data-cell="ruler">Page</div>
              <div className={`${styles.rowTrack} ${styles.rulerTrack}`}>
                {introPx > 0 && (
                  <span className={styles.introRegion} style={{ width: `${introPct}%` }} title="Load animations — the page's opening sequence, before any scrolling">
                    Intro
                  </span>
                )}
                {ticks.map((tick, index) => <span key={index} data-intro={tick.intro || undefined} style={{ left: `${tick.left}%` }}><i />{tick.label}</span>)}
                {/* The cap lives in the STICKY ruler row, so it stays visible
                    while the row list scrolls vertically. */}
                <i className={styles.playheadCap} data-playhead-cap aria-hidden="true" style={{ left: `${playheadPercent}%`, transform: 'translateZ(0)' }} />
              </div>
            </div>

            {!rows.length && !motion && (
              <div className={styles.timelineRow} data-row-kind="empty">
                <div className={styles.rowLabel} data-cell="empty">No animations detected</div>
                <div className={styles.rowTrack} />
              </div>
            )}

            {rows.map((row) => {
              const Icon = KIND_ICON[row.kind] || Layers;
              const isActive = row.elementId === selectedElementId;
              // A chevron that expands NOTHING is noise: rows with a single
              // animation get a spacer instead, and open implicitly when active
              // (their property tracks are the only thing to show).
              const expandable = row.count > 1;
              // With a controlled Set (the app), the chevron is the single
              // truth — selection auto-expands by ADDING to the set, so the
              // user can still collapse it back. Without one (tests/standalone),
              // the selected row is implicitly expanded.
              const expanded = expandable
                ? (expandedLayers ? expandedLayers.has(row.elementId) : isActive)
                : isActive;
              const clips = detailByRow?.[row.elementId] || null;
              // Rows chained by ONE shared animation (a stagger across
              // siblings): show the chain and let the user break it.
              const sharedLinks = (row.links || []).filter((linkId) => (linkRowCount[linkId] || 0) > 1);
              const isStripDragging = draggingStrip?.elementId === row.elementId;
              const geometry = isStripDragging
                ? (draggingStrip.kind === 'duration'
                  ? {
                    left: stripGeometry(row).left,
                    width: Math.max(NOMINAL_TIME_STRIP, ((draggingStrip.durationMs * TIME_PX_PER_MS * zoom) / Math.max(1, timelineWidth - TRACK_INSET)) * 100),
                  }
                  : {
                    left: introPct + (Math.max(0, draggingStrip.start) / axisMax) * scrollSpanPct,
                    width: Math.max(0.8, ((draggingStrip.end - draggingStrip.start) / axisMax) * scrollSpanPct),
                  })
                : stripGeometry(row);
              const { left, width } = geometry;
              // scrollEditable comes from the bridge: only vertical window
              // triggers with a resolved numeric range can be retargeted.
              const editableStrip = isActive && scrollRuler && row.driver === 'scroll'
                && row.scrollEditable !== false && row.scrollEnd != null && ['scroll', 'media'].includes(motion?.driver?.type);
              // A time strip's right edge edits duration (wider = slower).
              // Scroll ruler only: on the time ruler strips are drawn in
              // rowScale percentages, not px/ms — the delta math would lie.
              const durationEditable = isActive && scrollRuler && row.driver === 'time'
                && motion?.driver?.type === 'time' && Boolean(motion?.capabilities?.timing);
              return (
                <Fragment key={row.elementId}>
                  <div className={styles.timelineRow} data-row-kind="layer">
                    <div className={styles.rowLabel} data-cell="layer" data-selected={isActive}>
                      {expandable ? (
                        <button
                          type="button"
                          className={styles.layerChevron}
                          aria-expanded={expanded}
                          aria-label={`${expanded ? 'Collapse' : 'Expand'} ${row.label}`}
                          onClick={() => onToggleLayer?.(row.elementId)}
                        ><ChevronDown /></button>
                      ) : (
                        <span className={styles.layerChevronSpacer} aria-hidden="true" />
                      )}
                      <button
                        type="button"
                        className={styles.layerName}
                        title={`${row.label} · ${row.count} animation${row.count === 1 ? '' : 's'} · ${row.engines.join(', ')}`}
                        onClick={() => onSelectElement?.(row.elementId)}
                      >
                        <span className={styles.viewportKind}><Icon /></span>
                        <span className={styles.viewportLabel}>{row.label}</span>
                        {row.loop && <span className={styles.timelineLoopIndicator} data-motion-loop="true">Loop</span>}
                        {row.inViewport === false && <span className={styles.offscreenMark} title="Outside the current viewport — click to scroll there" />}
                      </button>
                      {sharedLinks.length > 0 && (
                        <button
                          type="button"
                          className={styles.linkChain}
                          title={`Chained to ${(linkRowCount[sharedLinks[0]] || 2) - 1} other layer${(linkRowCount[sharedLinks[0]] || 2) > 2 ? 's' : ''} by one shared animation — click to unchain this layer so it animates independently`}
                          aria-label={`Unchain ${row.label} from its shared animation`}
                          onClick={() => onUnlink?.(row, sharedLinks)}
                        ><Link2 /></button>
                      )}
                    </div>
                    <div className={styles.rowTrack} data-element-row={row.elementId} data-selected={isActive}>
                      <button
                        type="button"
                        className={styles.timelineClip}
                        data-layer-strip
                        data-driver={row.driver}
                        data-selected={isActive}
                        style={{ left: `${left}%`, width: `${width}%` }}
                        title={`Select ${row.label}`}
                        aria-label={`Select ${row.label}`}
                        onClick={() => onSelectElement?.(row.elementId)}
                      />
                      {editableStrip && ['start', 'end'].map((edge) => (
                        <button
                          key={edge}
                          type="button"
                          className={styles.timelineStripHandle}
                          data-edge={edge}
                          aria-label={`Adjust scroll ${edge}`}
                          title={`Drag to change where this animation ${edge === 'start' ? 'starts' : 'ends'} in the page scroll`}
                          style={{ left: `${edge === 'start' ? left : left + width}%` }}
                          onPointerDown={(event) => beginStripDrag(event, row, edge)}
                          onPointerMove={(event) => updateStripDrag(event, row)}
                          onPointerUp={(event) => finishStripDrag(event, row)}
                          onPointerCancel={() => setDraggingStrip(null)}
                        />
                      ))}
                      {durationEditable && (
                        <button
                          type="button"
                          className={styles.timelineStripHandle}
                          data-edge="end"
                          aria-label="Adjust duration"
                          title="Drag to stretch this animation's duration — longer means slower"
                          style={{ left: `${left + width}%` }}
                          onPointerDown={(event) => beginStripDrag(event, row, 'end', 'duration')}
                          onPointerMove={(event) => updateStripDrag(event, row)}
                          onPointerUp={(event) => finishStripDrag(event, row)}
                          onPointerCancel={() => setDraggingStrip(null)}
                        />
                      )}
                    </div>
                  </div>
                  {expanded && clips && clips.length > 1 && groupMotionClips(clips).map((entry) => {
                    // Split-text mints one tween per LETTER — those collapse
                    // into one semantic sub-row ("Text reveal · 42") instead of
                    // a pile of one-letter clips ("y").
                    if (entry.kind !== 'single') {
                      const memberGeos = entry.clips.map((member) => clipGeometry(row, member));
                      const groupLeft = Math.min(...memberGeos.map((geo) => geo.left));
                      const groupRight = Math.max(...memberGeos.map((geo) => geo.left + geo.width));
                      const groupGeo = { left: groupLeft, width: Math.max(0.8, groupRight - groupLeft) };
                      const isActiveClip = isActive && entry.clips.some((member) => member.id === activeMotionId);
                      const groupName = `${entry.label} · ${entry.count}`;
                      const groupTitle = `${MOTION_GROUP_LABELS[entry.type] || 'Group'} · ${entry.count} animations`;
                      const groupStripPx = (groupGeo.width / 100) * timelineWidth;
                      const groupLabelInside = groupStripPx >= 56;
                      return (
                        <div key={entry.id} className={styles.timelineRow} data-row-kind="clip">
                          <div className={styles.rowLabel} data-cell="clip" data-selected={isActiveClip}>
                            <button
                              type="button"
                              className={styles.layerName}
                              title={isActive ? `Edit ${groupTitle}` : `Select ${row.label}`}
                              onClick={() => { if (isActive) onActiveMotion?.(entry.clip.id); else onSelectElement?.(row.elementId); }}
                            >
                              <span className={styles.viewportLabel}>{groupName}</span>
                            </button>
                          </div>
                          <div className={styles.rowTrack} data-clip-row={entry.id}>
                            <button
                              type="button"
                              className={styles.timelineClipStrip}
                              data-selected={isActiveClip}
                              data-driver={entry.driver?.type}
                              style={{ left: `${groupGeo.left}%`, width: `${groupGeo.width}%` }}
                              title={isActive ? `Edit ${groupTitle}` : `Select ${row.label}`}
                              onClick={() => { if (isActive) onActiveMotion?.(entry.clip.id); else onSelectElement?.(row.elementId); }}
                            >{groupLabelInside && <span>{groupName}</span>}</button>
                            {!groupLabelInside && (
                              <span
                                className={styles.clipStripTag}
                                data-selected={isActiveClip}
                                style={{ left: `calc(${groupGeo.left + groupGeo.width}% + 6px)` }}
                              >{groupName}</span>
                            )}
                          </div>
                        </div>
                      );
                    }
                    const clip = entry.clip;
                    const clipGeo = clipGeometry(row, clip);
                    const isActiveClip = isActive && clip.id === activeMotionId;
                    const clipName = clipDisplayName(clip, clips);
                    // A time-driven clip is a POINT on the scroll axis — when its
                    // strip is too narrow to hold text, the name sits beside it.
                    const stripPx = (clipGeo.width / 100) * timelineWidth;
                    const labelInside = stripPx >= 56;
                    return (
                      <div key={clip.id} className={styles.timelineRow} data-row-kind="clip">
                        <div className={styles.rowLabel} data-cell="clip" data-selected={isActiveClip}>
                          <button
                            type="button"
                            className={styles.layerName}
                            title={isActive ? `Edit ${clipName}` : `Select ${row.label}`}
                            onClick={() => { if (isActive) onActiveMotion?.(clip.id); else onSelectElement?.(row.elementId); }}
                          >
                            <span className={styles.viewportLabel}>{clipName}</span>
                          </button>
                        </div>
                        <div className={styles.rowTrack} data-clip-row={clip.id}>
                          <button
                            type="button"
                            className={styles.timelineClipStrip}
                            data-selected={isActiveClip}
                            data-driver={clip.driver?.type}
                            style={{ left: `${clipGeo.left}%`, width: `${clipGeo.width}%` }}
                            title={isActive ? `Edit ${clipName}` : `Select ${row.label}`}
                            onClick={() => { if (isActive) onActiveMotion?.(clip.id); else onSelectElement?.(row.elementId); }}
                          >{labelInside && <span>{clipName}</span>}</button>
                          {!labelInside && (
                            <span
                              className={styles.clipStripTag}
                              data-selected={isActiveClip}
                              style={{ left: `calc(${clipGeo.left + clipGeo.width}% + 6px)` }}
                            >{clipName}</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {isActive && expanded && motion && (motion.tracks || []).map((track) => renderPropertyRow(track))}
                  {isActive && expanded && motion && !motion.tracks.length && (
                    <div className={styles.timelineRow} data-row-kind="property">
                      <div className={styles.rowLabel} data-cell="property">Runtime values</div>
                      <div className={styles.rowTrack} data-track-row="runtime" />
                    </div>
                  )}
                </Fragment>
              );
            })}

            {/* Standalone tracks exist only on the TIME ruler (no page metrics yet).
                On the scroll axis, an offscreen selection has no strip to nest
                under — time-math keyframes on a pixel ruler would be lies. */}
            {!scrollRuler && motion && !rows.some((row) => row.elementId === selectedElementId) && (motion.tracks || []).map((track) => renderPropertyRow(track))}

            {introPx > 0 && (
              <i
                className={styles.introBoundary}
                aria-hidden="true"
                style={{ left: labelsWidth + TRACK_INSET + (introPct / 100) * (timelineWidth - TRACK_INSET) }}
              />
            )}
            <i
              className={styles.timelinePlayhead}
              data-timeline-playhead
              aria-hidden="true"
              style={{ transform: `translateX(${Math.round(labelsWidth + TRACK_INSET + (playheadPercent / 100) * (timelineWidth - TRACK_INSET))}px)` }}
            />
          </div>
        </div>
        <div
          className={styles.labelsResizeHandle}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize the labels column"
          title="Drag to resize the labels column"
          style={{ left: labelsWidth - 3 }}
          onPointerDown={beginLabelsResize}
          onPointerMove={moveLabelsResize}
          onPointerUp={endLabelsResize}
          onPointerCancel={endLabelsResize}
        />
      </div>}
      {open && curveOpen && selectedFrame && nextFrame && (
        <CubicBezierEditor
          keyframe={selectedFrame}
          nextKeyframe={nextFrame}
          onCommit={(easing) => onChangeKeyframeEasing(selectedKeyframe, easing)}
          onClose={() => setCurveOpen(false)}
        />
      )}
    </section>
  );
}

function assetPreview(asset) {
  if (asset.kind === 'svg' && asset.markup) return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(asset.markup)}`;
  if (asset.kind === 'video') return asset.poster || '';
  if (asset.kind === 'image' || asset.kind === 'background') return asset.source;
  return '';
}

export function AssetsPanel({ assets, onSelect, onReplace }) {
  const [query, setQuery] = useState('');
  const filtered = assets.filter((asset) => `${asset.label} ${asset.kind}`.toLowerCase().includes(query.toLowerCase()));
  return (
    <div className={styles.assetsPanel}>
      <div className={styles.assetSearch}><input value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder="Search assets" /></div>
      <div className={styles.assetSummary}>{filtered.length} images, SVGs, videos and motion assets</div>
      <div className={styles.assetList}>
        {filtered.map((asset, index) => {
          const preview = assetPreview(asset);
          return (
            <article key={`${asset.elementId}:${asset.kind}:${index}`}>
              <button type="button" className={styles.assetSelect} onClick={() => onSelect(asset.elementId)}>
                <span className={styles.assetThumb}>
                  {preview ? <img src={preview} alt="" /> : asset.kind === 'video' ? <Film /> : <ImageIcon />}
                  <span>{asset.kind}</span>
                </span>
                <span className={styles.assetMeta}><strong>{asset.label}</strong><small>{asset.width && asset.height ? `${asset.width} × ${asset.height}` : asset.kind}</small></span>
              </button>
              <label className={styles.assetReplace} title={`Replace ${asset.label}`} onClick={(event) => event.stopPropagation()}>
                <Upload />
                <input
                  type="file"
                  accept={asset.kind === 'svg' ? 'image/svg+xml' : asset.kind === 'video' ? 'video/*' : asset.kind === 'lottie' ? 'application/json' : 'image/*'}
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    if (file) onReplace(asset, file);
                    event.currentTarget.value = '';
                  }}
                />
              </label>
            </article>
          );
        })}
      </div>
    </div>
  );
}

export function CodePanel({ selected }) {
  if (!selected) return <InspectorEmpty />;
  return (
    <div className={styles.panelBody}>
      <InspectorSection title="Runtime locator">
        <pre className={styles.codeBlock}>{`[data-uncraft-id="${selected.id}"]`}</pre>
        <div className={styles.codeFacts}>
          <div><span>Tag</span><code>{selected.tag}</code></div>
          <div><span>ID</span><code>{selected.authoredId || 'none'}</code></div>
          <div><span>Webflow ID</span><code>{selected.webflowId || 'none'}</code></div>
          <div><span>Display</span><code>{selected.styles?.display}</code></div>
          <div><span>Position</span><code>{selected.styles?.position}</code></div>
          <div><span>Transform</span><code>{selected.styles?.transform}</code></div>
        </div>
      </InspectorSection>
      <InspectorSection title="Classes" meta={selected.classes?.length || 0}>
        <div className={styles.classList}>
          {(selected.classes || []).map((className) => <code key={className}>.{className}</code>)}
        </div>
      </InspectorSection>
    </div>
  );
}

export default function NativeMotionEditor({
  runtimeUrl = SOURCE,
  persistenceAdapter = null,
}) {
  const stageRef = useRef(null);
  const localPersistence = useMemo(
    () => createLocalMotionPersistenceAdapter(runtimeUrl),
    [runtimeUrl],
  );
  const [activeTab, setActiveTab] = useState('properties');
  const [stageSize, setStageSize] = useState({ width: 1000, height: 800 });
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [timelineZoom, setTimelineZoom] = useState(1);
  const [expandedLayers, setExpandedLayers] = useState(() => new Set());
  const [timelineLabelsWidth, setTimelineLabelsWidth] = useState(() => {
    if (typeof window === 'undefined') return LABELS_DEFAULT_WIDTH;
    return readLabPreference('uncraft-motion-labels-w', LABELS_DEFAULT_WIDTH, LABELS_MIN_WIDTH, LABELS_MAX_WIDTH);
  });
  const [timelineHeight, setTimelineHeight] = useState(() => {
    if (typeof window === 'undefined') return TIMELINE_MIN_HEIGHT;
    return readLabPreference('uncraft-motion-timeline-h', TIMELINE_MIN_HEIGHT, TIMELINE_MIN_HEIGHT, TIMELINE_MAX_HEIGHT);
  });
  const controller = useNativeMotionController({
    persistenceAdapter: persistenceAdapter || localPersistence,
    activePanel: activeTab,
    timelineOpen,
  });
  const {
    iframeRef,
    status,
    runtime,
    mode,
    tool,
    device: deviceConfig,
    selected,
    selectedRowId,
    viewportRows,
    viewportPage,
    historyCount,
    canUndo,
    canRedo,
    speed,
    saveState,
    patchError,
    pendingTransactions,
    activeMotionId,
    motion,
    activeMotion,
    timelineState,
    timelineOffset,
    autoKeyframe,
    selectedKeyframe,
    motionDetail,
    propertyOwnership,
    ownershipConflict,
    commands,
  } = controller;

  useEffect(() => {
    if (!selectedRowId) return;
    setExpandedLayers((current) => {
      if (current.has(selectedRowId)) return current;
      const next = new Set(current);
      next.add(selectedRowId);
      return next;
    });
  }, [selectedRowId]);

  useEffect(() => {
    if (!stageRef.current) return undefined;
    const observer = new ResizeObserver(([entry]) => {
      setStageSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(stageRef.current);
    return () => observer.disconnect();
  }, []);

  const viewportScale = useMemo(() => {
    const horizontal = Math.max(0.25, (stageSize.width - 80) / deviceConfig.width);
    const vertical = Math.max(0.25, (stageSize.height - 72) / deviceConfig.height);
    return Math.min(1, horizontal, vertical);
  }, [deviceConfig, stageSize]);

  function exportFramer() {
    if (!selected || !motion.length) return;
    const { code } = buildFramerExport({ label: selected.label, tag: selected.tag, clips: motion });
    const blob = new Blob([code], { type: 'text/javascript' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${String(selected.label || 'motion').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'motion'}-framer.jsx`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function selectMotion(motionId) {
    commands.selectMotion(motionId);
    setTimelineOpen(true);
  }

  function toggleAutoKeyframe(nextValue) {
    if (nextValue) setTimelineOpen(true);
    commands.toggleAutoKeyframe(nextValue);
  }

  // ⚠️ Botão direito em QUALQUER lugar abre menu — regra de produto: a
  // ferramenta tem que parecer software, não site. Área de painel SEM DADOS
  // devolve lista vazia: nada aparece, e o menu do navegador continua bloqueado.
  const menuContexto = useContextMenu((alvo) => {
    if (!alvo || typeof alvo.closest !== 'function') return [];
    const copiar = (texto) => navigator.clipboard?.writeText?.(String(texto ?? '')).catch(() => {});

    const kf = alvo.closest('[data-keyframe-property]');
    if (kf) {
      const prop = kf.getAttribute('data-keyframe-property');
      const valor = kf.getAttribute('data-keyframe-value');
      return [
        // Responde a pergunta "onde altero a opacidade de um keyframe?": o campo
        // de valor da linha da propriedade escreve no keyframe sob o ponteiro.
        { label: 'Move playhead here', hint: 'edits the value', onSelect: () => kf.click() },
        { separator: true },
        { label: `Copy value`, hint: valor, onSelect: () => copiar(valor) },
        { label: 'Copy property name', hint: prop, onSelect: () => copiar(prop) },
      ];
    }

    const campo = alvo.closest('input, select');
    if (campo) {
      // Mesma lista e mesma ordem do menu de campo do Figma (anexo do Adilson):
      // Undo, Redo · Cut, Copy, Paste · Select All, com os atalhos à direita.
      const ehSelect = campo.tagName === 'SELECT';
      const escreve = (texto) => {
        // Pelo setter NATIVO: atribuir `.value` direto não dispara o onChange do
        // React, e a edição sumiria no próximo render.
        const proto = Object.getPrototypeOf(campo);
        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        setter ? setter.call(campo, texto) : (campo.value = texto);
        campo.dispatchEvent(new Event('input', { bubbles: true }));
        campo.dispatchEvent(new Event('change', { bubbles: true }));
      };
      const selecionado = () => {
        if (ehSelect) return campo.value;
        const { selectionStart: a, selectionEnd: b } = campo;
        return a != null && b != null && a !== b ? campo.value.slice(a, b) : campo.value;
      };
      return [
        // Desabilitados como no Figma quando não há o que desfazer no campo.
        { label: 'Undo', hint: '⌘Z', disabled: !canUndo, onSelect: () => commands.undo() },
        { label: 'Redo', hint: '⇧⌘Z', disabled: !canRedo, onSelect: () => commands.redo() },
        { separator: true },
        {
          label: 'Cut',
          hint: '⌘X',
          disabled: ehSelect,
          onSelect: () => { copiar(selecionado()); escreve(''); },
        },
        { label: 'Copy', hint: '⌘C', onSelect: () => copiar(selecionado()) },
        {
          label: 'Paste',
          hint: '⌘V',
          disabled: ehSelect,
          onSelect: async () => {
            const texto = await navigator.clipboard?.readText?.().catch(() => null);
            if (texto != null) escreve(texto);
          },
        },
        { separator: true },
        { label: 'Select All', hint: '⌘A', disabled: ehSelect, onSelect: () => campo.select?.() },
      ];
    }

    const linha = alvo.closest('[data-row-kind]');
    if (linha && linha.getAttribute('data-row-kind') !== 'empty') {
      const rotulo = (linha.textContent || '').trim().slice(0, 40);
      return [
        { label: 'Select this layer', onSelect: () => linha.querySelector('button')?.click() },
        { separator: true },
        { label: 'Copy layer name', hint: rotulo, onSelect: () => copiar(rotulo) },
      ];
    }

    return [];
  });

  return (
    <main className={styles.editorShell} onContextMenu={menuContexto.aoAbrir}>
      {menuContexto.menu ? (
        <ContextMenu {...menuContexto.menu} onClose={menuContexto.fechar} />
      ) : null}
      <header className={styles.topbar}>
        <div className={styles.topbarStart}>
          <Link href="/canvas" className={styles.iconButton} aria-label="Back to canvas"><ArrowLeft /></Link>
          <span className={styles.brandMark}>U</span>
          <div className={styles.documentName}>
            <strong>{runtime?.title || 'Native animated clone'}</strong>
            <span><i data-ready={status === 'ready'} />{status === 'ready' ? 'Runtime connected' : 'Connecting runtime'}</span>
          </div>
        </div>

        <div className={styles.deviceSwitcher} aria-label="Viewport">
          {MOTION_EDITOR_DEVICE_ORDER.map((key) => {
            const value = MOTION_EDITOR_DEVICES[key];
            const Icon = DEVICE_ICONS[key];
            return (
              <button
                key={key}
                type="button"
                aria-label={value.label}
                aria-pressed={deviceConfig.id === key}
                onClick={() => commands.changeDevice(key)}
              ><Icon /></button>
            );
          })}
        </div>

        <div className={styles.topbarEnd}>
          <div className={styles.historyControls}>
            <button type="button" onClick={commands.undo} disabled={!canUndo || pendingTransactions > 0} aria-label="Undo"><Undo2 /></button>
            <button type="button" onClick={commands.redo} disabled={!canRedo || pendingTransactions > 0} aria-label="Redo"><Redo2 /></button>
          </div>
          <div className={styles.modeSwitch}>
            <button type="button" aria-pressed={mode === 'edit'} onClick={() => commands.changeMode('edit')}><MousePointer2 />Edit</button>
            <button type="button" aria-pressed={mode === 'preview'} onClick={() => commands.changeMode('preview')}><Eye />Preview</button>
          </div>
          <button
            type="button"
            className={styles.exportButton}
            disabled={!selected || !motion.length}
            title={selected && motion.length
              ? 'Export this element as React + Framer Motion code (with a translation report)'
              : 'Select an animated element to export it'}
            onClick={exportFramer}
          ><Code2 />Export</button>
          <button type="button" className={styles.saveButton} onClick={commands.save} disabled={pendingTransactions > 0}>
            {saveState === 'saved' ? <Check /> : <Save />}
            {saveState === 'saved' ? 'Saved' : 'Save changes'}
          </button>
        </div>
      </header>

      <section className={styles.workspace}>
        <div className={styles.stage} ref={stageRef}>
          <div className={styles.toolRail}>
            <button type="button" aria-pressed={mode === 'edit' && tool === 'select'} onClick={() => { commands.changeMode('edit'); commands.changeTool('select'); }} title="Select elements"><MousePointer2 /></button>
            <button type="button" aria-pressed={mode === 'edit' && tool === 'move'} onClick={() => { commands.changeMode('edit'); commands.changeTool('move'); }} title="Move freely"><Move /></button>
            <span />
            <button type="button" onClick={() => { setActiveTab('motion'); setTimelineOpen(true); }} title="Inspect motion"><Gauge /></button>
          </div>

          <div
            className={styles.viewportOuter}
            style={{
              width: deviceConfig.width * viewportScale,
              height: deviceConfig.height * viewportScale,
            }}
          >
            <div
              className={styles.viewportInner}
              style={{
                width: deviceConfig.width,
                height: deviceConfig.height,
                transform: `scale(${viewportScale})`,
              }}
            >
              <iframe
                ref={iframeRef}
                title="Native animated website runtime"
                src={runtimeUrl}
                sandbox="allow-scripts allow-pointer-lock"
                referrerPolicy="no-referrer"
                onLoad={commands.markRuntimeLoaded}
              />
            </div>
          </div>

          {patchError && <div className={styles.patchError} role="alert">{patchError}</div>}
          <div className={styles.stageStatus}>
            <span>{deviceConfig.width} × {deviceConfig.height}</span>
            <span>{Math.round(viewportScale * 100)}%</span>
            <span>{historyCount} {historyCount === 1 ? 'change' : 'changes'}</span>
          </div>
        </div>

        <aside className={styles.inspector}>
          <div className={styles.inspectorHeader}>
            <div>
              <span className={styles.selectionIcon}><Code2 /></span>
              <span>
                <strong>{selected?.label || 'Nothing selected'}</strong>
                <small>{selected ? `${selected.tag}${selected.classes?.[0] ? `.${selected.classes[0]}` : ''}` : 'Choose an element on the page'}</small>
              </span>
            </div>
            <button type="button" aria-label="Selection menu" disabled><ChevronDown /></button>
          </div>
          <nav className={styles.inspectorTabs} aria-label="Inspector tabs">
            {['properties', 'motion', 'code', 'assets'].map((tab) => (
              <button key={tab} type="button" aria-selected={activeTab === tab} onClick={() => { setActiveTab(tab); if (tab === 'motion') setTimelineOpen(true); }}>
                {tab[0].toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </nav>
          {activeTab === 'properties' && <PropertiesPanel
            selected={selected}
            runtime={runtime}
            activeMotion={activeMotion}
            timelineOffset={timelineOffset}
            propertyOwnership={propertyOwnership}
            onOwnershipOpen={(property) => {
              commands.focusOwnership(property);
              setActiveTab('motion');
              setTimelineOpen(true);
            }}
            onStyle={commands.applyStyle}
            onText={commands.applyText}
            onAttribute={commands.applyAttribute}
          />}
          {activeTab === 'assets' && <AssetsPanel assets={runtime?.assets || []} onSelect={commands.selectElement} onReplace={commands.replaceAsset} />}
          {activeTab === 'motion' && <>
            <MotionOwnershipChoice conflict={ownershipConflict} onChoose={commands.chooseOwnership} />
            <MotionPanel selected={selected} motion={motion} activeMotionId={activeMotionId} onMotion={commands.applyMotion} onStagger={commands.applyStagger} />
          </>}
          {activeTab === 'code' && <CodePanel selected={selected} />}
        </aside>

        <TimelinePanel
          open={timelineOpen}
          rows={viewportRows}
          detailByRow={motionDetail}
          expandedLayers={expandedLayers}
          onToggleLayer={(elementId) => {
            const expanding = !expandedLayers.has(elementId);
            setExpandedLayers((current) => {
              const next = new Set(current);
              if (next.has(elementId)) next.delete(elementId);
              else next.add(elementId);
              return next;
            });
            if (expanding && !motionDetail[elementId] && status === 'ready') commands.describeElement(elementId);
          }}
          activeMotionId={activeMotionId}
          onActiveMotion={selectMotion}
          selectedElementId={selectedRowId}
          onSelectElement={commands.focusElement}
          labelsWidth={timelineLabelsWidth}
          onLabelsWidth={(width) => {
            setTimelineLabelsWidth(width);
            try { window.localStorage.setItem('uncraft-motion-labels-w', String(width)); } catch (_) {}
          }}
          bodyHeight={timelineHeight}
          onBodyHeight={(height) => {
            setTimelineHeight(height);
            try { window.localStorage.setItem('uncraft-motion-timeline-h', String(height)); } catch (_) {}
          }}
          page={viewportPage}
          onScrollTo={commands.scrollTo}
          onScrubIntro={commands.scrubIntro}
          onUnlink={commands.unlinkMotion}
          onStripEdit={commands.applyStripEdit}
          motion={activeMotion}
          state={timelineState}
          speed={speed}
          zoom={timelineZoom}
          autoKeyframe={autoKeyframe}
          selectedKeyframe={selectedKeyframe}
          onToggle={() => setTimelineOpen((current) => !current)}
          onPlayback={commands.playback}
          onSpeed={commands.changeSpeed}
          onSeek={commands.seekMotion}
          onZoom={setTimelineZoom}
          onPlaybackMode={commands.changePlaybackMode}
          onAutoKeyframe={toggleAutoKeyframe}
          onSelectKeyframe={commands.selectKeyframe}
          onMoveKeyframe={commands.moveKeyframe}
          onDuplicateKeyframe={commands.duplicateKeyframe}
          onDeleteKeyframe={commands.deleteKeyframe}
          onChangeKeyframeEasing={commands.changeKeyframeEasing}
          onChangeKeyframeValue={commands.changeKeyframeValue}
          onChangeStepValue={commands.changeStepValue}
        />
      </section>
    </main>
  );
}
