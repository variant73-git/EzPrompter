'use client';

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  command,
  createPatch,
  invertPatch,
  isRuntimeMessage,
  removeRejectedPatch,
  storageKey,
} from '../../lib/motion-editor/protocol.js';
import {
  buildStripEditPatches,
  coerceMotionValue,
  motionCapabilityLabel,
  motionDriverLabel,
  motionPlaybackMode,
  normalizeMotionClip,
} from '../../lib/motion-editor/motion-ir.js';
import { applyStaggerDelays, groupMotionClips } from '../../lib/motion-editor/motion-groups.js';
import { buildFramerExport } from '../../lib/motion-editor/framer-export.js';
import styles from './native-motion-editor.module.css';

const SOURCE = '/api/native-clone/index.html';

const DEVICES = {
  desktop: { label: 'Desktop', width: 1440, height: 900, Icon: Monitor },
  tablet: { label: 'Tablet', width: 768, height: 900, Icon: Tablet },
  mobile: { label: 'Mobile', width: 390, height: 844, Icon: Smartphone },
};

const AUTO_KEYFRAME_PROPERTIES = new Set([
  'backgroundColor', 'borderRadius', 'color', 'filter', 'fontSize', 'fontWeight',
  'letterSpacing', 'lineHeight', 'opacity', 'transform', 'translate',
]);

function animationProperty(property) {
  return String(property || '').replace(/-([a-z])/g, (_, character) => character.toUpperCase());
}

function patchValuesEqual(first, second) {
  if (typeof first === 'object' || typeof second === 'object') {
    try { return JSON.stringify(first) === JSON.stringify(second); } catch (_) { return false; }
  }
  return String(first ?? '') === String(second ?? '');
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

function keyframeDescriptor(keyframe, offset = keyframe?.offset) {
  if (!keyframe) return { offset: Number(offset) || 0, exists: false };
  return {
    offset: Number(offset) || 0,
    value: String(keyframe.value ?? ''),
    ...(keyframe.easing ? { easing: keyframe.easing } : {}),
    exists: true,
  };
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

function Field({ label, defaultValue, suffix, onCommit, type = 'text', disabled = false, keyframeState = null }) {
  return (
    <label className={styles.field}>
      <span className={styles.controlLabel}>{label}<KeyframeMarker state={keyframeState} /></span>
      <span className={styles.fieldControl}>
        <input
          key={`${label}:${defaultValue}`}
          type={type}
          defaultValue={defaultValue ?? ''}
          disabled={disabled}
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

function SelectField({ label, value, onCommit, children, disabled = false, keyframeState = null }) {
  return (
    <label className={styles.field}>
      <span className={styles.controlLabel}>{label}<KeyframeMarker state={keyframeState} /></span>
      <span className={styles.fieldControl}>
        <select disabled={disabled} value={value} onChange={(event) => onCommit(event.currentTarget.value)}>
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

function ColorField({ label, value, onCommit, keyframeState = null }) {
  const safeValue = /^#[0-9a-f]{6}$/i.test(value || '') ? value : '#292926';
  return (
    <label className={styles.field}>
      <span className={styles.controlLabel}>{label}<KeyframeMarker state={keyframeState} /></span>
      <span className={styles.colorControl}>
        <input
          key={`${label}:${safeValue}`}
          type="color"
          defaultValue={safeValue}
          onBlur={(event) => onCommit?.(event.currentTarget.value)}
        />
        <input
          key={`${label}:text:${value}`}
          defaultValue={value || ''}
          onBlur={(event) => onCommit?.(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
          }}
        />
      </span>
    </label>
  );
}

function TextContentField({ selected, onCommit }) {
  const [value, setValue] = useState(selected.text || '');
  useEffect(() => setValue(selected.text || ''), [selected.id, selected.text]);
  const changed = value !== (selected.text || '');
  return (
    <label className={styles.textField}>
      <span className={styles.controlLabel}>Text</span>
      <span className={styles.textEditorControl}>
        <textarea value={value} onChange={(event) => setValue(event.currentTarget.value)} />
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

function PropertiesPanel({ selected, runtime, activeMotion, timelineOffset, onStyle, onText, onAttribute }) {
  if (!selected) return <DocumentProperties runtime={runtime} />;
  const stylesValue = selected.styles || {};
  const canEditText = selected.canEditText !== false && !['img', 'video', 'canvas', 'svg', 'section'].includes(selected.tag);
  const supportsTypography = canEditText || Boolean(selected.text);
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
          <TextContentField selected={selected} onCommit={onText} />
        )}
        {selected.tag === 'img' && (
          <Field
            label="Source"
            defaultValue={selected.imageSrc}
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

      <InspectorSection title="Appearance">
        <ColorField label="Text" value={stylesValue.colorHex} keyframeState={keyframeState('color')} onCommit={(value) => onStyle('color', value, stylesValue.color)} />
        <ColorField label="Fill" value={stylesValue.backgroundColorHex} keyframeState={keyframeState('background-color')} onCommit={(value) => onStyle('background-color', value, stylesValue.backgroundColor)} />
        <div className={styles.controlGrid}>
          <Field label="Opacity" defaultValue={stylesValue.opacity} keyframeState={keyframeState('opacity')} onCommit={(value) => onStyle('opacity', value, stylesValue.opacity)} />
          <Field label="Radius" defaultValue={stylesValue.borderRadius} keyframeState={keyframeState('border-radius')} onCommit={(value) => onStyle('border-radius', value, stylesValue.borderRadius)} />
        </div>
      </InspectorSection>

      {supportsTypography && <InspectorSection title="Typography">
        <Field label="Font" defaultValue={stylesValue.fontFamily} onCommit={(value) => onStyle('font-family', value, stylesValue.fontFamily)} />
        <div className={styles.controlGrid}>
          <Field label="Weight" defaultValue={stylesValue.fontWeight} keyframeState={keyframeState('font-weight')} onCommit={(value) => onStyle('font-weight', value, stylesValue.fontWeight)} />
          <Field label="Size" defaultValue={stylesValue.fontSize} keyframeState={keyframeState('font-size')} onCommit={(value) => onStyle('font-size', value, stylesValue.fontSize)} />
        </div>
        <div className={styles.controlGrid}>
          <Field label="Line height" defaultValue={stylesValue.lineHeight} keyframeState={keyframeState('line-height')} onCommit={(value) => onStyle('line-height', value, stylesValue.lineHeight)} />
          <Field label="Letter spacing" defaultValue={stylesValue.letterSpacing} keyframeState={keyframeState('letter-spacing')} onCommit={(value) => onStyle('letter-spacing', value, stylesValue.letterSpacing)} />
        </div>
        <div className={styles.field}>
          <span className={styles.controlLabel}>Alignment</span>
          <div className={styles.alignControl}>
            {[
              ['left', AlignLeft], ['center', AlignCenter], ['right', AlignRight], ['justify', AlignJustify],
            ].map(([value, Icon]) => (
              <button key={value} type="button" aria-label={`Align ${value}`} aria-pressed={stylesValue.textAlign === value} onClick={() => onStyle('text-align', value, stylesValue.textAlign)}><Icon /></button>
            ))}
          </div>
        </div>
        <div className={styles.controlGrid}>
          <SelectField label="Case" value={stylesValue.textTransform || 'none'} onCommit={(value) => onStyle('text-transform', value, stylesValue.textTransform)}>
            <option value="none">Original</option><option value="uppercase">Uppercase</option><option value="lowercase">Lowercase</option><option value="capitalize">Title case</option>
          </SelectField>
          <SelectField label="Style" value={stylesValue.fontStyle || 'normal'} onCommit={(value) => onStyle('font-style', value, stylesValue.fontStyle)}>
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
  direct: 'Editable — keyframes and timing write back natively (CSS/WAAPI)',
  adapter: 'Adapter — timing, easing and start/end values write back through GSAP; keyframes cannot be moved or added',
  code: 'Code-driven — this animation is controlled by site scripts and is read-only here',
};

export function MotionPanel({ selected, motion, activeMotionId, onMotion, onStagger }) {
  const activeMotion = motion.find((item) => item.id === activeMotionId) || null;
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
            <Field label="Repeat delay" type="number" defaultValue={activeMotion.timing.repeatDelay} suffix="ms" disabled={activeMotion.editability !== 'adapter'} onCommit={(value) => commit('timing.repeatDelay', value, activeMotion.timing.repeatDelay)} />
          </div>
          <ToggleField label="Alternate direction" checked={activeMotion.timing.yoyo} disabled={activeMotion.editability !== 'adapter'} onCommit={(value) => commit('timing.yoyo', value, activeMotion.timing.yoyo)} />
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
            {activeMotion.editability === 'adapter' && <><option value="power2.out">Power out</option><option value="power2.inOut">Power in out</option></>}
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
}) {
  const [draggingKeyframe, setDraggingKeyframe] = useState(null);
  const [draggingStrip, setDraggingStrip] = useState(null);
  const [curveOpen, setCurveOpen] = useState(false);
  const [scrubbing, setScrubbing] = useState(null);
  const [resizingHeight, setResizingHeight] = useState(null);
  const [resizingLabels, setResizingLabels] = useState(null);
  const suppressKeyframeClick = useRef(false);
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
  const axisMax = scrollRuler ? Math.max(1, page.maxScroll) : duration;
  const timelineWidth = Math.round(Math.max(720, scrollRuler ? axisMax * 0.15 : duration * 0.42) * zoom);
  const ticks = Array.from({ length: 11 }, (_, index) => ({
    left: index * 10,
    label: scrollRuler ? `${Math.round((axisMax * index) / 10)}px` : formatTimelineTime((duration * index) / 10),
  }));
  // A time-driven clip is a POINT on the scroll axis (where it triggers) — its
  // extent is seconds, shown as a readout, not a scroll range.
  const NOMINAL_TIME_STRIP = 1.4;
  function stripGeometry(row) {
    const isScroll = row.driver === 'scroll';
    if (scrollRuler) {
      const start = Math.max(0, Math.min(axisMax, Number(row.scrollStart) || 0));
      const left = (start / axisMax) * 100;
      const width = row.scrollEnd != null
        ? Math.max(0.8, ((Math.max(start, Math.min(axisMax, Number(row.scrollEnd))) - start) / axisMax) * 100)
        : NOMINAL_TIME_STRIP;
      return { left, width };
    }
    const rowScale = Math.max(1, ...rows.map((item) => (item.delayMs || 0) + (item.durationMs || 0)));
    return {
      left: isScroll ? 0 : ((row.delayMs || 0) / rowScale) * 100,
      width: isScroll ? 100 : Math.max(1.5, ((row.durationMs || 0) / rowScale) * 100),
    };
  }
  const activeRow = rows.find((row) => row.elementId === selectedElementId) || null;
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

  function offsetAtPointer(event, rect) {
    const pointerPercent = Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100));
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

  function beginKeyframeDrag(event, track, keyframe) {
    if (!canAutoKeyframe || event.button !== 0) return;
    const canvas = event.currentTarget.closest(`.${styles.rowTrack}`);
    if (!canvas) return;
    const offset = Number(keyframe.offset) || 0;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    onSelectKeyframe({ motionId: motion.id, property: track.property, offset });
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
  function beginStripDrag(event, row, edge) {
    if (event.button !== 0) return;
    const canvas = event.currentTarget.closest(`.${styles.rowTrack}`);
    if (!canvas) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDraggingStrip({
      pointerId: event.pointerId,
      elementId: row.elementId,
      edge,
      rect: canvas.getBoundingClientRect(),
      start: Number(row.scrollStart) || 0,
      end: Number(row.scrollEnd) || 0,
      moved: false,
    });
  }

  function stripScrollAtPointer(event, rect) {
    const percent = Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100));
    return Math.round((percent / 100) * axisMax);
  }

  function updateStripDrag(event) {
    if (!draggingStrip || event.pointerId !== draggingStrip.pointerId) return;
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
    onStripEdit?.(row, finished.edge === 'start' ? { start: finished.start } : { end: finished.end });
  }

  // ---- Scrub: the playhead is DRAGGED OVER fixed strips. Clicking or dragging
  // anywhere on empty track area moves the page scroll (or the clip time),
  // never the strips themselves.
  function applyScrub(event) {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left - labelsWidth;
    const pct = Math.max(0, Math.min(1, x / Math.max(1, timelineWidth)));
    if (scrollRuler) onScrollTo?.(Math.round(pct * axisMax));
    else if (motion) onSeek?.(pct * duration);
  }

  function beginScrub(event) {
    if (event.button !== 0) return;
    if (event.target.closest('button,input,select,textarea')) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (event.clientX - rect.left < labelsWidth) return; // labels gutter is not scrubbable
    event.currentTarget.setPointerCapture?.(event.pointerId);
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
      const start = Number(activeRow.scrollStart) || 0;
      const end = Number(activeRow.scrollEnd);
      const span = Number.isFinite(end) ? Math.max(1, end - start) : Math.max(1, page.viewportHeight || 1);
      return Math.max(0, Math.min(1, ((page.scrollY || 0) - start) / span));
    }
    return Math.max(0, Math.min(1, (currentTime - delay) / clipDuration));
  }

  function seekToOffset(offset) {
    if (scrollRuler && activeRow) {
      const start = Number(activeRow.scrollStart) || 0;
      const end = Number(activeRow.scrollEnd);
      const span = Number.isFinite(end) ? Math.max(1, end - start) : Math.max(1, page.viewportHeight || 1);
      onScrollTo?.(Math.round(start + offset * span));
      return;
    }
    onSeek?.(delay + offset * clipDuration);
  }

  // A sub-row clip strip sits at its own scroll pixels when it has them,
  // otherwise it inherits the layer strip (same widget, same place).
  function clipGeometry(row, clip) {
    if (scrollRuler) {
      const start = Number(clip?.scroll?.start);
      const end = Number(clip?.scroll?.end);
      if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
        const left = (Math.max(0, Math.min(axisMax, start)) / axisMax) * 100;
        const width = Math.max(0.8, ((Math.min(axisMax, end) - Math.max(0, start)) / axisMax) * 100);
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
              style={{ left: `${left}%` }}
              title={canAutoKeyframe
                ? `${track.property}: ${keyframe.value}. Drag to move, Option-drag to duplicate.`
                : canSelectKeyframes
                  ? `${track.property}: ${keyframe.value}. Click to select and edit its value; GSAP start/end cannot be moved.`
                  : `${track.property}: ${keyframe.value}. This track is read-only.`}
              aria-label={`${track.property} keyframe at ${Math.round(offset * 100)} percent`}
              aria-pressed={isSelected}
              disabled={!canSelectKeyframes}
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
          <span className={styles.propertyValue} title={valueSource ? String(valueSource.value) : ''}>
            {valueSource ? String(valueSource.value).slice(0, 14) : ''}
          </span>
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
      <header className={styles.timelineHeader}>
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
            {selectedFrame && (
              <label className={styles.keyframeValueField} title="Value at the selected keyframe">
                <span>Keyframe value</span>
                <input
                  key={`${selectedKeyframe?.property}:${selectedKeyframe?.offset}:${selectedFrame.value}`}
                  defaultValue={selectedFrame.value}
                  onBlur={(event) => {
                    const next = event.currentTarget.value;
                    if (next !== String(selectedFrame.value)) onChangeKeyframeValue?.(selectedKeyframe, next);
                  }}
                  onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }}
                />
              </label>
            )}
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
        <div className={styles.timelineScroller}>
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
                {ticks.map((tick) => <span key={tick.left} style={{ left: `${tick.left}%` }}><i />{tick.label}</span>)}
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
              const expanded = Boolean(expandedLayers?.has?.(row.elementId)) || isActive;
              const clips = detailByRow?.[row.elementId] || null;
              const isStripDragging = draggingStrip?.elementId === row.elementId;
              const geometry = isStripDragging
                ? {
                  left: (Math.max(0, draggingStrip.start) / axisMax) * 100,
                  width: Math.max(0.8, ((draggingStrip.end - draggingStrip.start) / axisMax) * 100),
                }
                : stripGeometry(row);
              const { left, width } = geometry;
              // scrollEditable comes from the bridge: only vertical window
              // triggers with a resolved numeric range can be retargeted.
              const editableStrip = isActive && scrollRuler && row.driver === 'scroll'
                && row.scrollEditable !== false && row.scrollEnd != null && ['scroll', 'media'].includes(motion?.driver?.type);
              return (
                <Fragment key={row.elementId}>
                  <div className={styles.timelineRow} data-row-kind="layer">
                    <div className={styles.rowLabel} data-cell="layer" data-selected={isActive}>
                      <button
                        type="button"
                        className={styles.layerChevron}
                        aria-expanded={expanded}
                        aria-label={`${expanded ? 'Collapse' : 'Expand'} ${row.label}`}
                        onClick={() => onToggleLayer?.(row.elementId)}
                      ><ChevronDown /></button>
                      <button
                        type="button"
                        className={styles.layerName}
                        title={`${row.label} · ${row.count} animation${row.count === 1 ? '' : 's'} · ${row.engines.join(', ')}`}
                        onClick={() => onSelectElement?.(row.elementId)}
                      >
                        <span className={styles.viewportKind}><Icon /></span>
                        <span className={styles.viewportLabel}>{row.label}</span>
                        {row.inViewport === false && <span className={styles.offscreenMark} title="Outside the current viewport — click to scroll there" />}
                      </button>
                    </div>
                    <div className={styles.rowTrack} data-element-row={row.elementId} data-selected={isActive}>
                      <i
                        className={styles.timelineClip}
                        data-driver={row.driver}
                        data-selected={isActive}
                        style={{ left: `${left}%`, width: `${width}%` }}
                      />
                      {(row.marks || []).map((mark) => (
                        <i
                          key={mark}
                          className={styles.viewportMark}
                          style={{ left: `${left + (mark * width)}%` }}
                        />
                      ))}
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
                          onPointerMove={updateStripDrag}
                          onPointerUp={(event) => finishStripDrag(event, row)}
                          onPointerCancel={() => setDraggingStrip(null)}
                        />
                      ))}
                    </div>
                  </div>
                  {expanded && clips && clips.length > 1 && clips.map((clip) => {
                    const clipGeo = clipGeometry(row, clip);
                    const isActiveClip = isActive && clip.id === activeMotionId;
                    // A time-driven clip is a POINT on the scroll axis — when its
                    // strip is too narrow to hold text, the name sits beside it.
                    const stripPx = (clipGeo.width / 100) * timelineWidth;
                    const labelInside = stripPx >= 56;
                    return (
                      <div key={clip.id} className={styles.timelineRow} data-row-kind="clip">
                        <div className={styles.rowLabel} data-cell="clip" data-selected={isActiveClip}>
                          <span className={styles.viewportLabel}>{clip.name}</span>
                        </div>
                        <div className={styles.rowTrack} data-clip-row={clip.id}>
                          <button
                            type="button"
                            className={styles.timelineClipStrip}
                            data-selected={isActiveClip}
                            data-driver={clip.driver?.type}
                            style={{ left: `${clipGeo.left}%`, width: `${clipGeo.width}%` }}
                            title={isActive ? `Edit ${clip.name}` : `Select ${row.label}`}
                            onClick={() => { if (isActive) onActiveMotion?.(clip.id); else onSelectElement?.(row.elementId); }}
                          >{labelInside && <span>{clip.name}</span>}</button>
                          {!labelInside && (
                            <span
                              className={styles.clipStripTag}
                              data-selected={isActiveClip}
                              style={{ left: `calc(${clipGeo.left + clipGeo.width}% + 6px)` }}
                            >{clip.name}</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {isActive && motion && (motion.tracks || []).map((track) => renderPropertyRow(track))}
                  {isActive && motion && !motion.tracks.length && (
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

            <i
              className={styles.timelinePlayhead}
              data-timeline-playhead
              aria-hidden="true"
              style={{ left: labelsWidth + ((scrollRuler ? Math.min(100, ((page.scrollY || 0) / axisMax) * 100) : currentPercent) / 100) * timelineWidth }}
            ><span /></i>
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

function AssetsPanel({ assets, onSelect, onReplace }) {
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
            <article key={`${asset.elementId}:${asset.kind}:${index}`} onClick={() => onSelect(asset.elementId)}>
              <div className={styles.assetThumb}>
                {preview ? <img src={preview} alt="" /> : asset.kind === 'video' ? <Film /> : <ImageIcon />}
                <span>{asset.kind}</span>
              </div>
              <div className={styles.assetMeta}><strong>{asset.label}</strong><small>{asset.width && asset.height ? `${asset.width} × ${asset.height}` : asset.kind}</small></div>
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

function CodePanel({ selected }) {
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

export default function NativeMotionEditor() {
  const iframeRef = useRef(null);
  const stageRef = useRef(null);
  const [status, setStatus] = useState('loading');
  const [runtime, setRuntime] = useState(null);
  const [mode, setMode] = useState('edit');
  const [tool, setTool] = useState('select');
  const [device, setDevice] = useState('desktop');
  const [selected, setSelected] = useState(null);
  const [viewportRows, setViewportRows] = useState([]);
  const [viewportPage, setViewportPage] = useState(null);
  const [activeTab, setActiveTab] = useState('properties');
  const [history, setHistory] = useState([]);
  const [redo, setRedo] = useState([]);
  const [speed, setSpeed] = useState(1);
  const [saveState, setSaveState] = useState('idle');
  const [patchError, setPatchError] = useState(null);
  const [stageSize, setStageSize] = useState({ width: 1000, height: 800 });
  const [activeMotionId, setActiveMotionId] = useState(null);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [timelineZoom, setTimelineZoom] = useState(1);
  const [timelineState, setTimelineState] = useState({ currentTime: 0, duration: 1000, playState: 'idle' });
  const [autoKeyframe, setAutoKeyframe] = useState(false);
  const [selectedKeyframe, setSelectedKeyframe] = useState(null);
  // Per-row animation detail, fetched lazily (describe-element) or captured
  // from selections — the timeline's sub-rows read from here.
  const [motionDetail, setMotionDetail] = useState({});
  const [expandedLayers, setExpandedLayers] = useState(() => new Set());
  const [timelineLabelsWidth, setTimelineLabelsWidth] = useState(() => {
    if (typeof window === 'undefined') return LABELS_DEFAULT_WIDTH;
    const stored = Number(window.localStorage.getItem('uncraft-motion-labels-w'));
    return Number.isFinite(stored) && stored >= LABELS_MIN_WIDTH && stored <= LABELS_MAX_WIDTH ? stored : LABELS_DEFAULT_WIDTH;
  });
  const [timelineHeight, setTimelineHeight] = useState(() => {
    if (typeof window === 'undefined') return TIMELINE_MIN_HEIGHT;
    const stored = Number(window.localStorage.getItem('uncraft-motion-timeline-h'));
    return Number.isFinite(stored) && stored >= TIMELINE_MIN_HEIGHT && stored <= TIMELINE_MAX_HEIGHT ? stored : TIMELINE_MIN_HEIGHT;
  });

  const motion = useMemo(() => (selected?.motion || []).map(normalizeMotionClip), [selected]);
  const activeMotion = motion.find((item) => item.id === activeMotionId) || null;
  // The bridge resolves which timeline row OWNS the clicked element
  // (hostRowId) — comparing raw ids across the iframe boundary is what kept
  // site clicks from lighting up their row.
  const selectedRowId = selected ? (selected.hostRowId || selected.id) : null;
  const motionDetailRef = useRef(motionDetail);
  useEffect(() => { motionDetailRef.current = motionDetail; }, [motionDetail]);
  const timelineOffset = useMemo(() => {
    if (!activeMotion) return 0;
    const delay = Math.max(0, activeMotion.timing.delay || 0);
    const duration = Math.max(1, activeMotion.timing.duration || 1);
    return Math.max(0, Math.min(1, (timelineState.currentTime - delay) / duration));
  }, [activeMotion, timelineState.currentTime]);

  useEffect(() => {
    setActiveMotionId((current) => motion.some((item) => item.id === current) ? current : motion[0]?.id || null);
  }, [motion]);

  useEffect(() => setSelectedKeyframe(null), [activeMotionId, selected?.id]);

  useEffect(() => {
    if (!patchError) return undefined;
    const timer = window.setTimeout(() => setPatchError(null), 4500);
    return () => window.clearTimeout(timer);
  }, [patchError]);

  useEffect(() => {
    if (autoKeyframe && !(activeMotion?.capabilities?.keyframes && activeMotion?.editability === 'direct')) {
      setAutoKeyframe(false);
    }
  }, [activeMotion, autoKeyframe]);

  const deviceConfig = DEVICES[device];
  const viewportScale = useMemo(() => {
    const horizontal = Math.max(0.25, (stageSize.width - 80) / deviceConfig.width);
    const vertical = Math.max(0.25, (stageSize.height - 72) / deviceConfig.height);
    return Math.min(1, horizontal, vertical);
  }, [deviceConfig, stageSize]);

  const send = useCallback((type, payload) => {
    iframeRef.current?.contentWindow?.postMessage(command(type, payload), '*');
  }, []);

  // Selections feed the timeline: cache the element's clips for its row,
  // auto-expand the row that owns it, and fetch the host row's detail when
  // the click resolved to a child of the animated host.
  useEffect(() => {
    if (!selected?.id) return;
    setMotionDetail((current) => ({ ...current, [selected.id]: (selected.motion || []).map(normalizeMotionClip) }));
    const rowId = selected.hostRowId || selected.id;
    setExpandedLayers((current) => {
      if (current.has(rowId)) return current;
      const next = new Set(current);
      next.add(rowId);
      return next;
    });
    if (rowId !== selected.id && !motionDetailRef.current[rowId] && status === 'ready') {
      send('describe-element', { elementId: rowId });
    }
  }, [selected, send, status]);

  useEffect(() => {
    if (!stageRef.current) return undefined;
    const observer = new ResizeObserver(([entry]) => {
      setStageSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(stageRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    function onMessage(event) {
      if (event.source !== iframeRef.current?.contentWindow || !isRuntimeMessage(event.data)) return;
      const { type, payload = {} } = event.data;
      if (type === 'runtime-ready') {
        setRuntime(payload);
        setStatus('ready');
        send('set-mode', { mode });
        send('inspect-viewport', {});
        try {
          const saved = JSON.parse(localStorage.getItem(storageKey(SOURCE)) || '[]');
          if (Array.isArray(saved) && saved.length) {
            setHistory(saved);
            send('apply-patches', { patches: saved });
          }
        } catch (_) {}
      }
      if (type === 'viewport-motion-changed') {
        setViewportRows(Array.isArray(payload.rows) ? payload.rows : []);
        if (payload.page) setViewportPage(payload.page);
      }
      if (type === 'element-described' && payload.element?.id) {
        setMotionDetail((current) => ({ ...current, [payload.element.id]: (payload.element.motion || []).map(normalizeMotionClip) }));
      }
      if (type === 'selection-changed' || type === 'patch-applied' || type === 'inline-text-edit-started') {
        setSelected(payload.element || null);
      }
      if (type === 'inline-text-committed') {
        const patch = createPatch({
          elementId: payload.elementId,
          kind: 'text',
          before: payload.before,
          value: payload.value,
        });
        setHistory((current) => [...current, patch]);
        setRedo([]);
        setSelected(payload.element || null);
        setSaveState('idle');
      }
      if (type === 'inventory-changed') {
        setRuntime((current) => current ? { ...current, assets: payload.assets || [], profile: payload.profile || current.profile } : current);
      }
      if (type === 'layout-intent-committed') {
        const patch = {
          ...createPatch({ elementId: payload.elementId, kind: 'style', property: 'translate', before: payload.before, value: payload.value }),
          layoutIntent: { delta: payload.delta, originalRect: payload.originalRect },
        };
        setHistory((current) => [...current, patch]);
        setRedo([]);
        setSelected(payload.element || null);
        setSaveState('idle');
      }
      if (type === 'patches-applied' && payload.element) setSelected(payload.element);
      if (type === 'patch-rejected') {
        // The runtime refused the write — a phantom entry in history would replay
        // the same failure on every undo/save, silently.
        setHistory((current) => removeRejectedPatch(current, payload.patch));
        setPatchError(payload.error || 'The change could not be applied.');
      }
      if (type === 'playback-changed' && payload.speed) setSpeed(payload.speed);
      if (type === 'timeline-changed') {
        setTimelineState({
          currentTime: Number(payload.currentTime) || 0,
          duration: Math.max(1, Number(payload.duration) || 1),
          playState: payload.playState || 'idle',
        });
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [mode, send]);

  useEffect(() => {
    if (status === 'ready') send('set-mode', { mode });
  }, [mode, send, status]);

  useEffect(() => {
    if (status === 'ready') send('set-tool', { tool });
  }, [send, status, tool]);

  useEffect(() => {
    if (status !== 'ready') return undefined;
    send('set-timeline-active', { motionId: timelineOpen ? activeMotionId : null });
    return () => send('set-timeline-active', { motionId: null });
  }, [activeMotionId, send, status, timelineOpen]);

  function applyNewPatches(patches) {
    const changed = patches.filter((patch) => !patchValuesEqual(patch.before, patch.value));
    if (!changed.length) return;
    const groupId = changed.length > 1
      ? (globalThis.crypto?.randomUUID?.() || `group-${Date.now()}-${Math.random().toString(16).slice(2)}`)
      : null;
    const grouped = changed.map((patch) => groupId ? { ...patch, groupId } : patch);
    if (grouped.length === 1) send('apply-patch', { patch: grouped[0] });
    else send('apply-patches', { patches: grouped });
    setHistory((current) => [...current, ...grouped]);
    setRedo([]);
    setSaveState('idle');
    window.setTimeout(() => send('refresh-inventory'), 80);
  }

  function applyNewPatch(patch) {
    applyNewPatches([patch]);
  }

  function applyStyle(property, value, before) {
    if (!selected) return;
    const stylePatch = createPatch({ elementId: selected.id, kind: 'style', property, before, value });
    const normalized = animationProperty(property);
    const canKeyframe = autoKeyframe && activeMotion?.capabilities?.keyframes && activeMotion?.editability === 'direct' && AUTO_KEYFRAME_PROPERTIES.has(normalized);
    if (!canKeyframe) {
      applyNewPatch(stylePatch);
      return;
    }
    const track = activeMotion.tracks.find((item) => animationProperty(item.property) === normalized);
    const existing = track?.keyframes?.find((keyframe) => Math.abs(Number(keyframe.offset) - timelineOffset) < 0.0005);
    const keyframePatch = createPatch({
      elementId: selected.id,
      kind: 'motion',
      motionId: activeMotion.id,
      property: `keyframe.${normalized}`,
      before: existing
        ? keyframeDescriptor(existing, timelineOffset)
        : { offset: timelineOffset, exists: false },
      value: {
        offset: timelineOffset,
        value: String(value),
        ...(existing?.easing ? { easing: existing.easing } : {}),
        exists: true,
      },
    });
    applyNewPatches([stylePatch, keyframePatch]);
  }

  function applyText(value) {
    if (!selected) return;
    applyNewPatch(createPatch({ elementId: selected.id, kind: 'text', before: selected.text, value }));
  }

  function applyAttribute(property, value, before) {
    if (!selected) return;
    applyNewPatch(createPatch({ elementId: selected.id, kind: 'attribute', property, before, value }));
  }

  function applyMotion(motion, property, value, before) {
    if (!selected || !motion?.id) return;
    applyNewPatch(createPatch({
      elementId: selected.id,
      kind: 'motion',
      motionId: motion.id,
      property,
      before,
      value,
    }));
  }

  function applyStripEdit(row, next) {
    if (!selected || !activeMotion) return;
    const edits = buildStripEditPatches({ motion: activeMotion, row, next });
    if (!edits.length) return;
    applyNewPatches(edits.map((edit) => createPatch({
      elementId: selected.id, kind: 'motion', motionId: activeMotion.id, ...edit,
    })));
    // Redraw strips from the runtime's truth, not from the optimistic drag.
    window.setTimeout(() => send('inspect-viewport'), 60);
  }

  function applyStagger(members, valueMs) {
    if (!selected) return;
    const patches = applyStaggerDelays(members, valueMs).map(({ clip, delay }) => createPatch({
      elementId: selected.id,
      kind: 'motion',
      motionId: clip.id,
      property: 'timing.delay',
      before: clip.timing.delay,
      value: delay,
    }));
    applyNewPatches(patches);
  }

  async function replaceAsset(asset, file) {
    if (asset.kind === 'svg') {
      const markup = await file.text();
      applyNewPatch(createPatch({ elementId: asset.elementId, kind: 'svg', before: asset.markup || '', value: markup }));
      return;
    }
    const value = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    if (asset.kind === 'background') {
      applyNewPatch(createPatch({ elementId: asset.elementId, kind: 'style', property: 'background-image', before: `url("${asset.source}")`, value: `url("${value}")` }));
    } else {
      applyNewPatch(createPatch({ elementId: asset.elementId, kind: 'attribute', property: asset.property || 'src', before: asset.source, value }));
    }
  }

  function undo() {
    const patch = history.at(-1);
    if (!patch) return;
    let groupStart = history.length - 1;
    if (patch.groupId) {
      while (groupStart > 0 && history[groupStart - 1].groupId === patch.groupId) groupStart -= 1;
    }
    const group = history.slice(groupStart);
    send('apply-patches', { patches: group.slice().reverse().map(invertPatch) });
    setHistory((current) => current.slice(0, groupStart));
    setRedo((current) => [...current, group]);
    setSaveState('idle');
  }

  function redoPatch() {
    const entry = redo.at(-1);
    if (!entry) return;
    const group = Array.isArray(entry) ? entry : [entry];
    send('apply-patches', { patches: group });
    setRedo((current) => current.slice(0, -1));
    setHistory((current) => [...current, ...group]);
    setSaveState('idle');
  }

  function exportFramer() {
    if (!selected || !motion.length) return;
    const { code } = buildFramerExport({ label: selected.label, tag: selected.tag, clips: motion });
    const blob = new Blob([code], { type: 'text/javascript' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${String(selected.label || 'motion').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'motion'}-framer.jsx`;
    link.click();
    // Synchronous revoke races the download outside Chromium.
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function save() {
    localStorage.setItem(storageKey(SOURCE), JSON.stringify(history));
    setSaveState('saved');
    window.setTimeout(() => setSaveState('idle'), 1800);
  }

  function playback(action) {
    send('playback', { action, speed, motionId: activeMotionId });
  }

  function changeSpeed(nextSpeed) {
    setSpeed(nextSpeed);
    // Re-rate only — changing speed must never start playback.
    send('playback', { action: 'speed', speed: nextSpeed, motionId: activeMotionId });
  }

  function selectMotion(motionId) {
    setActiveMotionId(motionId);
    setTimelineOpen(true);
  }

  function seekMotion(currentTime) {
    if (!activeMotionId) return;
    setTimelineState((current) => ({ ...current, currentTime, playState: 'paused' }));
    send('seek-motion', { motionId: activeMotionId, currentTime });
  }

  function changePlaybackMode(nextMode) {
    if (!activeMotion) return;
    applyMotion(activeMotion, 'timing.playbackMode', nextMode, motionPlaybackMode(activeMotion.timing));
  }

  function toggleAutoKeyframe(nextValue) {
    if (nextValue) {
      playback('pause');
      setTimelineOpen(true);
    }
    setAutoKeyframe(nextValue);
  }

  function resolveKeyframe(selection) {
    if (!selection || !activeMotion || selection.motionId !== activeMotion.id) return null;
    const track = activeMotion.tracks.find((item) => item.property === selection.property);
    const keyframe = track?.keyframes?.find((item) => Math.abs(Number(item.offset) - Number(selection.offset)) < 0.0005);
    return track && keyframe ? { track, keyframe } : null;
  }

  function availableKeyframeOffset(track, desiredOffset, ignoredOffset = null) {
    const desired = Math.max(0, Math.min(1, Number(desiredOffset) || 0));
    const occupied = (offset) => track.keyframes.some((keyframe) => (
      Math.abs(Number(keyframe.offset) - offset) < 0.004
      && (ignoredOffset == null || Math.abs(Number(keyframe.offset) - Number(ignoredOffset)) >= 0.0005)
    ));
    if (!occupied(desired)) return desired;
    for (let step = 1; step <= 100; step += 1) {
      const distance = step * 0.01;
      const forward = desired + distance;
      const backward = desired - distance;
      if (forward <= 1 && !occupied(forward)) return forward;
      if (backward >= 0 && !occupied(backward)) return backward;
    }
    return desired;
  }

  function deleteKeyframe(selection) {
    const resolved = resolveKeyframe(selection);
    if (!resolved || !selected) return;
    applyNewPatch(createPatch({
      elementId: selected.id,
      kind: 'motion',
      motionId: activeMotion.id,
      property: `keyframe.${resolved.track.property}`,
      before: keyframeDescriptor(resolved.keyframe),
      value: keyframeDescriptor(null, resolved.keyframe.offset),
    }));
    setSelectedKeyframe(null);
  }

  function duplicateKeyframe(selection, requestedOffset = null) {
    const resolved = resolveKeyframe(selection);
    if (!resolved || !selected) return;
    const defaultStep = Math.max(0.02, Math.min(0.12, 80 / Math.max(1, activeMotion.timing.duration)));
    const preferred = requestedOffset == null
      ? (Number(resolved.keyframe.offset) + defaultStep <= 1 ? Number(resolved.keyframe.offset) + defaultStep : Number(resolved.keyframe.offset) - defaultStep)
      : requestedOffset;
    const offset = availableKeyframeOffset(resolved.track, preferred);
    const existing = resolved.track.keyframes.find((keyframe) => Math.abs(Number(keyframe.offset) - offset) < 0.0005);
    applyNewPatch(createPatch({
      elementId: selected.id,
      kind: 'motion',
      motionId: activeMotion.id,
      property: `keyframe.${resolved.track.property}`,
      before: keyframeDescriptor(existing, offset),
      value: keyframeDescriptor(resolved.keyframe, offset),
    }));
    setSelectedKeyframe({ motionId: activeMotion.id, property: resolved.track.property, offset });
    seekMotion((activeMotion.timing.delay || 0) + offset * Math.max(1, activeMotion.timing.duration));
  }

  function moveKeyframe(selection, requestedOffset) {
    const resolved = resolveKeyframe(selection);
    if (!resolved || !selected) return;
    const sourceOffset = Number(resolved.keyframe.offset) || 0;
    const offset = availableKeyframeOffset(resolved.track, requestedOffset, sourceOffset);
    if (Math.abs(offset - sourceOffset) < 0.0005) return;
    const existing = resolved.track.keyframes.find((keyframe) => Math.abs(Number(keyframe.offset) - offset) < 0.0005);
    const removeSource = createPatch({
      elementId: selected.id,
      kind: 'motion',
      motionId: activeMotion.id,
      property: `keyframe.${resolved.track.property}`,
      before: keyframeDescriptor(resolved.keyframe),
      value: keyframeDescriptor(null, sourceOffset),
    });
    const addDestination = createPatch({
      elementId: selected.id,
      kind: 'motion',
      motionId: activeMotion.id,
      property: `keyframe.${resolved.track.property}`,
      before: keyframeDescriptor(existing, offset),
      value: keyframeDescriptor(resolved.keyframe, offset),
    });
    applyNewPatches([removeSource, addDestination]);
    setSelectedKeyframe({ motionId: activeMotion.id, property: resolved.track.property, offset });
    seekMotion((activeMotion.timing.delay || 0) + offset * Math.max(1, activeMotion.timing.duration));
  }

  function changeKeyframeValue(selection, value) {
    const resolved = resolveKeyframe(selection);
    if (!resolved || !selected || String(resolved.keyframe.value) === String(value)) return;
    applyNewPatch(createPatch({
      elementId: selected.id,
      kind: 'motion',
      motionId: activeMotion.id,
      property: `keyframe.${resolved.track.property}`,
      before: keyframeDescriptor(resolved.keyframe),
      value: { ...keyframeDescriptor(resolved.keyframe), value: String(value) },
    }));
  }

  function changeKeyframeEasing(selection, easing) {
    const resolved = resolveKeyframe(selection);
    if (!resolved || !selected || resolved.keyframe.easing === easing) return;
    applyNewPatch(createPatch({
      elementId: selected.id,
      kind: 'motion',
      motionId: activeMotion.id,
      property: `keyframe.${resolved.track.property}`,
      before: { ...keyframeDescriptor(resolved.keyframe), easing: resolved.keyframe.easing || null },
      value: { ...keyframeDescriptor(resolved.keyframe), easing },
    }));
  }

  return (
    <main className={styles.editorShell}>
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
          {Object.entries(DEVICES).map(([key, value]) => {
            const Icon = value.Icon;
            return (
              <button
                key={key}
                type="button"
                aria-label={value.label}
                aria-pressed={device === key}
                onClick={() => setDevice(key)}
              ><Icon /></button>
            );
          })}
        </div>

        <div className={styles.topbarEnd}>
          <div className={styles.historyControls}>
            <button type="button" onClick={undo} disabled={!history.length} aria-label="Undo"><Undo2 /></button>
            <button type="button" onClick={redoPatch} disabled={!redo.length} aria-label="Redo"><Redo2 /></button>
          </div>
          <div className={styles.modeSwitch}>
            <button type="button" aria-pressed={mode === 'edit'} onClick={() => setMode('edit')}><MousePointer2 />Edit</button>
            <button type="button" aria-pressed={mode === 'preview'} onClick={() => setMode('preview')}><Eye />Preview</button>
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
          <button type="button" className={styles.saveButton} onClick={save}>
            {saveState === 'saved' ? <Check /> : <Save />}
            {saveState === 'saved' ? 'Saved' : 'Save changes'}
          </button>
        </div>
      </header>

      <section className={styles.workspace}>
        <div className={styles.stage} ref={stageRef}>
          <div className={styles.toolRail}>
            <button type="button" aria-pressed={mode === 'edit' && tool === 'select'} onClick={() => { setMode('edit'); setTool('select'); }} title="Select elements"><MousePointer2 /></button>
            <button type="button" aria-pressed={mode === 'edit' && tool === 'move'} onClick={() => { setMode('edit'); setTool('move'); }} title="Move freely"><Move /></button>
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
                src={SOURCE}
                sandbox="allow-scripts allow-pointer-lock"
                referrerPolicy="no-referrer"
                onLoad={() => setStatus((current) => current === 'ready' ? current : 'bridge')}
              />
            </div>
          </div>

          {patchError && <div className={styles.patchError} role="alert">{patchError}</div>}
          <div className={styles.stageStatus}>
            <span>{deviceConfig.width} × {deviceConfig.height}</span>
            <span>{Math.round(viewportScale * 100)}%</span>
            <span>{history.length} {history.length === 1 ? 'change' : 'changes'}</span>
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
          {activeTab === 'properties' && <PropertiesPanel selected={selected} runtime={runtime} activeMotion={activeMotion} timelineOffset={timelineOffset} onStyle={applyStyle} onText={applyText} onAttribute={applyAttribute} />}
          {activeTab === 'assets' && <AssetsPanel assets={runtime?.assets || []} onSelect={(elementId) => send('select-element', { elementId })} onReplace={replaceAsset} />}
          {activeTab === 'motion' && <MotionPanel selected={selected} motion={motion} activeMotionId={activeMotionId} onMotion={applyMotion} onStagger={applyStagger} />}
          {activeTab === 'code' && <CodePanel selected={selected} />}
        </aside>

        <TimelinePanel
          open={timelineOpen}
          rows={viewportRows}
          detailByRow={motionDetail}
          expandedLayers={expandedLayers}
          onToggleLayer={(elementId) => {
            const expanding = !expandedLayers.has(elementId);
            const next = new Set(expandedLayers);
            if (expanding) next.add(elementId);
            else next.delete(elementId);
            setExpandedLayers(next);
            if (expanding && !motionDetail[elementId] && status === 'ready') send('describe-element', { elementId });
          }}
          activeMotionId={activeMotionId}
          onActiveMotion={selectMotion}
          selectedElementId={selectedRowId}
          onSelectElement={(elementId) => send('focus-element', { elementId })}
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
          onScrollTo={(scrollY) => {
            // Optimistic playhead — the bridge confirms via the next debounced emit.
            setViewportPage((current) => current ? { ...current, scrollY } : current);
            send('scroll-to', { scrollY });
          }}
          onStripEdit={applyStripEdit}
          motion={activeMotion}
          state={timelineState}
          speed={speed}
          zoom={timelineZoom}
          autoKeyframe={autoKeyframe}
          selectedKeyframe={selectedKeyframe}
          onToggle={() => setTimelineOpen((current) => !current)}
          onPlayback={playback}
          onSpeed={changeSpeed}
          onSeek={seekMotion}
          onZoom={setTimelineZoom}
          onPlaybackMode={changePlaybackMode}
          onAutoKeyframe={toggleAutoKeyframe}
          onSelectKeyframe={setSelectedKeyframe}
          onMoveKeyframe={moveKeyframe}
          onDuplicateKeyframe={duplicateKeyframe}
          onDeleteKeyframe={deleteKeyframe}
          onChangeKeyframeEasing={changeKeyframeEasing}
          onChangeKeyframeValue={changeKeyframeValue}
        />
      </section>
    </main>
  );
}
