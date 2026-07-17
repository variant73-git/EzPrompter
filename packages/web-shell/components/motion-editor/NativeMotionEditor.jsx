'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  Eye,
  Film,
  Gauge,
  ImageIcon,
  Inspect,
  Monitor,
  Move,
  MousePointer2,
  Pause,
  Play,
  Redo2,
  RotateCcw,
  Save,
  Smartphone,
  Tablet,
  Undo2,
  Upload,
} from 'lucide-react';
import {
  command,
  createPatch,
  invertPatch,
  isRuntimeMessage,
  storageKey,
} from '../../lib/motion-editor/protocol.js';
import styles from './native-motion-editor.module.css';

const SOURCE = '/api/native-clone/index.html';

const DEVICES = {
  desktop: { label: 'Desktop', width: 1440, height: 900, Icon: Monitor },
  tablet: { label: 'Tablet', width: 768, height: 900, Icon: Tablet },
  mobile: { label: 'Mobile', width: 390, height: 844, Icon: Smartphone },
};

function Field({ label, defaultValue, suffix, onCommit, type = 'text', disabled = false }) {
  return (
    <label className={styles.field}>
      <span>{label}</span>
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

function ColorField({ label, value, onCommit }) {
  const safeValue = /^#[0-9a-f]{6}$/i.test(value || '') ? value : '#292926';
  return (
    <label className={styles.field}>
      <span>{label}</span>
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
      <span>Text</span>
      <span className={styles.textEditorControl}>
        <textarea value={value} onChange={(event) => setValue(event.currentTarget.value)} />
        <button type="button" disabled={!changed} onClick={() => onCommit(value)}>Apply text</button>
      </span>
    </label>
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
      <section className={styles.inspectorSection}>
        <div className={styles.sectionHeading}><span>Document colors</span><small>{profile?.colors?.length || 0}</small></div>
        <div className={styles.documentColors}>
          {(profile?.colors || []).map((color) => (
            <div key={color.value} title={`${color.value} · ${color.count} uses`}>
              <i style={{ background: color.value }} />
              <span>{color.value}</span>
            </div>
          ))}
        </div>
      </section>
      <section className={styles.inspectorSection}>
        <div className={styles.sectionHeading}><span>Typefaces</span><small>{profile?.fonts?.length || 0}</small></div>
        <div className={styles.fontList}>
          {(profile?.fonts || []).map((font) => <div key={font.value}><span style={{ fontFamily: font.value }}>Ag</span><strong>{font.value}</strong><small>{font.count}</small></div>)}
        </div>
      </section>
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

function PropertiesPanel({ selected, runtime, onStyle, onText, onAttribute }) {
  if (!selected) return <DocumentProperties runtime={runtime} />;
  const stylesValue = selected.styles || {};
  const canEditText = selected.canEditText !== false && !['img', 'video', 'canvas', 'svg', 'section'].includes(selected.tag);

  return (
    <div className={styles.panelBody}>
      <section className={styles.inspectorSection}>
        <div className={styles.sectionHeading}>
          <span>Content</span>
          <small>{selected.tag}</small>
        </div>
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
      </section>

      <section className={styles.inspectorSection}>
        <div className={styles.sectionHeading}><span>Appearance</span></div>
        <ColorField label="Text" value={stylesValue.colorHex} onCommit={(value) => onStyle('color', value, stylesValue.color)} />
        <ColorField label="Fill" value={stylesValue.backgroundColorHex} onCommit={(value) => onStyle('background-color', value, stylesValue.backgroundColor)} />
        <Field label="Opacity" defaultValue={stylesValue.opacity} onCommit={(value) => onStyle('opacity', value, stylesValue.opacity)} />
      </section>

      <section className={styles.inspectorSection}>
        <div className={styles.sectionHeading}><span>Typography</span></div>
        <Field label="Font" defaultValue={stylesValue.fontFamily} onCommit={(value) => onStyle('font-family', value, stylesValue.fontFamily)} />
        <Field label="Size" defaultValue={stylesValue.fontSize} onCommit={(value) => onStyle('font-size', value, stylesValue.fontSize)} />
        <Field label="Weight" defaultValue={stylesValue.fontWeight} onCommit={(value) => onStyle('font-weight', value, stylesValue.fontWeight)} />
        <Field label="Line height" defaultValue={stylesValue.lineHeight} onCommit={(value) => onStyle('line-height', value, stylesValue.lineHeight)} />
        <Field label="Kerning" defaultValue={stylesValue.letterSpacing} onCommit={(value) => onStyle('letter-spacing', value, stylesValue.letterSpacing)} />
        <div className={styles.field}>
          <span>Align</span>
          <div className={styles.alignControl}>
            {[
              ['left', AlignLeft], ['center', AlignCenter], ['right', AlignRight], ['justify', AlignJustify],
            ].map(([value, Icon]) => (
              <button key={value} type="button" aria-label={`Align ${value}`} aria-pressed={stylesValue.textAlign === value} onClick={() => onStyle('text-align', value, stylesValue.textAlign)}><Icon /></button>
            ))}
          </div>
        </div>
        <label className={styles.field}>
          <span>Case</span>
          <select key={`${selected.id}:${stylesValue.textTransform}`} defaultValue={stylesValue.textTransform || 'none'} onChange={(event) => onStyle('text-transform', event.currentTarget.value, stylesValue.textTransform)}>
            <option value="none">Original</option><option value="uppercase">Uppercase</option><option value="lowercase">Lowercase</option><option value="capitalize">Title case</option>
          </select>
        </label>
        <label className={styles.field}>
          <span>Style</span>
          <select key={`${selected.id}:${stylesValue.fontStyle}`} defaultValue={stylesValue.fontStyle || 'normal'} onChange={(event) => onStyle('font-style', event.currentTarget.value, stylesValue.fontStyle)}>
            <option value="normal">Normal</option><option value="italic">Italic</option><option value="oblique">Oblique</option>
          </select>
        </label>
      </section>

      <section className={styles.inspectorSection}>
        <div className={styles.sectionHeading}><span>Frame</span></div>
        <div className={styles.metricGrid}>
          {Object.entries(selected.rect || {}).map(([key, value]) => (
            <div key={key}><span>{key.toUpperCase()}</span><strong>{value}</strong></div>
          ))}
        </div>
      </section>
    </div>
  );
}

function MotionPanel({ selected, runtime, speed, onPlayback, onSpeed }) {
  const motion = selected?.motion || [];
  const origin = runtime?.profile?.origin || 'native';
  const originLabel = origin === 'webflow' ? 'Webflow interactions' : origin === 'framer' ? 'Framer effects' : 'Motion';
  return (
    <div className={styles.panelBody}>
      <section className={styles.inspectorSection}>
        <div className={styles.sectionHeading}><span>Playback</span><small>{speed}×</small></div>
        <div className={styles.playbackControls}>
          <button type="button" onClick={() => onPlayback('restart')} title="Restart"><RotateCcw /></button>
          <button type="button" onClick={() => onPlayback('pause')} title="Pause"><Pause /></button>
          <button type="button" className={styles.playPrimary} onClick={() => onPlayback('play')} title="Play"><Play /></button>
          <label>
            <Gauge aria-hidden="true" />
            <select value={speed} onChange={(event) => onSpeed(Number(event.currentTarget.value))}>
              <option value="0.25">0.25×</option>
              <option value="0.5">0.5×</option>
              <option value="1">1×</option>
              <option value="2">2×</option>
            </select>
          </label>
        </div>
      </section>

      <section className={styles.inspectorSection}>
        <div className={styles.sectionHeading}>
          <span>{originLabel}</span>
          <small>{motion.length} linked</small>
        </div>
        {!selected && <p className={styles.mutedCopy}>Select an element to see its triggers and animation actions.</p>}
        {selected && !motion.length && <p className={styles.mutedCopy}>No interaction is attached directly. Check the parent or create a new interaction.</p>}
        <div className={styles.motionList}>
          {motion.map((item) => (
            <article key={`${item.engine}:${item.id}`}>
              <span className={styles.motionEngine}>{item.engine}</span>
              <strong>{item.trigger ? 'Scroll into view' : item.name}</strong>
              <dl>
                <div><dt>State</dt><dd>{item.playState || 'linked'}</dd></div>
                {item.duration != null && <div><dt>Duration</dt><dd>{item.duration} ms</dd></div>}
                {item.trigger && <div><dt>Trigger</dt><dd>{String(item.trigger)}</dd></div>}
              </dl>
            </article>
          ))}
        </div>
        {(selected?.warnings || []).map((warning) => <p className={styles.warning} key={warning}>{warning}</p>)}
      </section>
    </div>
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
      <section className={styles.inspectorSection}>
        <div className={styles.sectionHeading}><span>Runtime locator</span></div>
        <pre className={styles.codeBlock}>{`[data-uncraft-id="${selected.id}"]`}</pre>
        <div className={styles.codeFacts}>
          <div><span>Tag</span><code>{selected.tag}</code></div>
          <div><span>ID</span><code>{selected.authoredId || 'none'}</code></div>
          <div><span>Webflow ID</span><code>{selected.webflowId || 'none'}</code></div>
          <div><span>Display</span><code>{selected.styles?.display}</code></div>
          <div><span>Position</span><code>{selected.styles?.position}</code></div>
          <div><span>Transform</span><code>{selected.styles?.transform}</code></div>
        </div>
      </section>
      <section className={styles.inspectorSection}>
        <div className={styles.sectionHeading}><span>Classes</span><small>{selected.classes?.length || 0}</small></div>
        <div className={styles.classList}>
          {(selected.classes || []).map((className) => <code key={className}>.{className}</code>)}
        </div>
      </section>
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
  const [activeTab, setActiveTab] = useState('properties');
  const [history, setHistory] = useState([]);
  const [redo, setRedo] = useState([]);
  const [speed, setSpeed] = useState(1);
  const [saveState, setSaveState] = useState('idle');
  const [stageSize, setStageSize] = useState({ width: 1000, height: 800 });

  const deviceConfig = DEVICES[device];
  const viewportScale = useMemo(() => {
    const horizontal = Math.max(0.25, (stageSize.width - 80) / deviceConfig.width);
    const vertical = Math.max(0.25, (stageSize.height - 72) / deviceConfig.height);
    return Math.min(1, horizontal, vertical);
  }, [deviceConfig, stageSize]);

  const send = useCallback((type, payload) => {
    iframeRef.current?.contentWindow?.postMessage(command(type, payload), '*');
  }, []);

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
        try {
          const saved = JSON.parse(localStorage.getItem(storageKey(SOURCE)) || '[]');
          if (Array.isArray(saved) && saved.length) {
            setHistory(saved);
            send('apply-patches', { patches: saved });
          }
        } catch (_) {}
      }
      if (type === 'selection-changed' || type === 'patch-applied') {
        setSelected(payload.element || null);
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
      if (type === 'playback-changed' && payload.speed) setSpeed(payload.speed);
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

  function applyNewPatch(patch) {
    if (String(patch.before ?? '') === String(patch.value ?? '')) return;
    send('apply-patch', { patch });
    setHistory((current) => [...current, patch]);
    setRedo([]);
    setSaveState('idle');
    window.setTimeout(() => send('refresh-inventory'), 80);
  }

  function applyStyle(property, value, before) {
    if (!selected) return;
    applyNewPatch(createPatch({ elementId: selected.id, kind: 'style', property, before, value }));
  }

  function applyText(value) {
    if (!selected) return;
    applyNewPatch(createPatch({ elementId: selected.id, kind: 'text', before: selected.text, value }));
  }

  function applyAttribute(property, value, before) {
    if (!selected) return;
    applyNewPatch(createPatch({ elementId: selected.id, kind: 'attribute', property, before, value }));
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
    send('apply-patch', { patch: invertPatch(patch) });
    setHistory((current) => current.slice(0, -1));
    setRedo((current) => [...current, patch]);
    setSaveState('idle');
  }

  function redoPatch() {
    const patch = redo.at(-1);
    if (!patch) return;
    send('apply-patch', { patch });
    setRedo((current) => current.slice(0, -1));
    setHistory((current) => [...current, patch]);
    setSaveState('idle');
  }

  function save() {
    localStorage.setItem(storageKey(SOURCE), JSON.stringify(history));
    setSaveState('saved');
    window.setTimeout(() => setSaveState('idle'), 1800);
  }

  function playback(action) {
    send('playback', { action, speed });
  }

  function changeSpeed(nextSpeed) {
    setSpeed(nextSpeed);
    send('playback', { action: 'play', speed: nextSpeed });
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
            <button type="button" onClick={() => setActiveTab('motion')} title="Inspect motion"><Gauge /></button>
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
            {['properties', 'assets', 'motion', 'code'].map((tab) => (
              <button key={tab} type="button" aria-selected={activeTab === tab} onClick={() => setActiveTab(tab)}>
                {tab[0].toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </nav>
          {activeTab === 'properties' && <PropertiesPanel selected={selected} runtime={runtime} onStyle={applyStyle} onText={applyText} onAttribute={applyAttribute} />}
          {activeTab === 'assets' && <AssetsPanel assets={runtime?.assets || []} onSelect={(elementId) => send('select-element', { elementId })} onReplace={replaceAsset} />}
          {activeTab === 'motion' && <MotionPanel selected={selected} runtime={runtime} speed={speed} onPlayback={playback} onSpeed={changeSpeed} />}
          {activeTab === 'code' && <CodePanel selected={selected} />}
        </aside>
      </section>
    </main>
  );
}
