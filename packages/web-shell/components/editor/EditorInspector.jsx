'use client';

import { useState, useEffect, useMemo } from 'react';

/**
 * EditorInspector — read/write a small set of CSS properties on the
 * iframe's selected element. Direct DOM access (same-origin iframe).
 *
 * v1 fields: color, background-color, font-family, font-size, font-weight,
 * line-height, letter-spacing, text-align, padding, margin, border-radius,
 * width, height, opacity. Plus tag/id/classes header.
 */

const FIELDS = [
  { key: 'color', label: 'Color', type: 'color' },
  { key: 'backgroundColor', label: 'Background', type: 'color' },
  { key: 'fontFamily', label: 'Font', type: 'text' },
  { key: 'fontSize', label: 'Size', type: 'text' },
  { key: 'fontWeight', label: 'Weight', type: 'text' },
  { key: 'lineHeight', label: 'Line height', type: 'text' },
  { key: 'letterSpacing', label: 'Letter sp.', type: 'text' },
  { key: 'textAlign', label: 'Align', type: 'select', options: ['left', 'center', 'right', 'justify'] },
  { key: 'padding', label: 'Padding', type: 'text' },
  { key: 'margin', label: 'Margin', type: 'text' },
  { key: 'borderRadius', label: 'Radius', type: 'text' },
  { key: 'width', label: 'Width', type: 'text' },
  { key: 'height', label: 'Height', type: 'text' },
  { key: 'opacity', label: 'Opacity', type: 'text' },
];

function rgbToHex(rgb) {
  const m = rgb?.match?.(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (!m) return '#000000';
  const h = (n) => Number(n).toString(16).padStart(2, '0');
  return `#${h(m[1])}${h(m[2])}${h(m[3])}`;
}

export default function EditorInspector({ iframe, selectedEl, onChange }) {
  const [, setTick] = useState(0);  // force re-read of computed styles
  const cs = useMemo(() => {
    if (!selectedEl) return null;
    const win = iframe?.contentWindow;
    if (!win?.getComputedStyle) return null;
    return win.getComputedStyle(selectedEl);
  }, [selectedEl, iframe]);

  if (!selectedEl) {
    return (
      <aside className="editor-panel inspector-panel">
        <div className="panel-handle"><span className="panel-title">Inspector</span></div>
        <div className="panel-body empty">Select an element to inspect.</div>
      </aside>
    );
  }

  function set(key, value) {
    if (!selectedEl) return;
    selectedEl.style[key] = value;
    setTick((n) => n + 1);
    onChange?.();
  }

  const tag = selectedEl.tagName.toLowerCase();
  const id = selectedEl.id;
  const classes = typeof selectedEl.className === 'string' ? selectedEl.className.trim().split(/\s+/).filter(Boolean) : [];

  return (
    <aside className="editor-panel inspector-panel">
      <div className="panel-handle">
        <span className="panel-title">Inspector</span>
      </div>
      <div className="panel-body">
        <div className="ins-element-header">
          <div className="ins-tag">&lt;{tag}&gt;</div>
          {id && <div className="ins-id">#{id}</div>}
          {classes.length > 0 && (
            <div className="ins-classes">
              {classes.map((c) => <span key={c} className="ins-class-chip">.{c}</span>)}
            </div>
          )}
        </div>

        <div className="ins-fields">
          {FIELDS.map((f) => (
            <InspectorField key={f.key} field={f} cs={cs} setValue={(v) => set(f.key, v)} />
          ))}
        </div>
      </div>
    </aside>
  );
}

function InspectorField({ field, cs, setValue }) {
  const raw = cs?.[field.key] || '';
  const value = field.type === 'color' ? rgbToHex(raw) : raw;
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);

  return (
    <label className="ins-field">
      <span className="ins-label">{field.label}</span>
      {field.type === 'color' ? (
        <div className="ins-color-row">
          <input type="color" value={draft} onChange={(e) => { setDraft(e.target.value); setValue(e.target.value); }} />
          <input type="text" value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={() => setValue(draft)} />
        </div>
      ) : field.type === 'select' ? (
        <select value={draft} onChange={(e) => { setDraft(e.target.value); setValue(e.target.value); }}>
          {field.options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : (
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => setValue(draft)}
          onKeyDown={(e) => e.key === 'Enter' && (e.target.blur())}
          placeholder={field.label}
        />
      )}
    </label>
  );
}
