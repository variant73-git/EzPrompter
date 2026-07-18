export const STUDIO_MODES = {
  builder: {
    label: 'Builder',
    short: 'Build',
    eyebrow: 'From an idea',
    question: 'What do you want to create?',
    description: 'Describe the website and add any references you want Uncraft to use.',
    accent: '#2966EA',
    action: 'Build preview',
    progress: ['Reading your brief', 'Mapping the experience', 'Composing the website', 'Preparing the canvas'],
  },
  clone: {
    label: 'Clone / Recreate',
    short: 'Recreate',
    eyebrow: 'From an existing site',
    question: 'What should Uncraft recreate?',
    description: 'Start from a live URL or screenshot, then choose how faithfully it should be rebuilt.',
    accent: '#F97316',
    action: 'Recreate preview',
    progress: ['Reading the reference', 'Recovering structure', 'Rebuilding components', 'Preparing the canvas'],
  },
  style: {
    label: 'Style Transplant',
    short: 'Restyle',
    eyebrow: 'From two references',
    question: 'Where should this visual language move?',
    description: 'Choose a target website and a style reference. You decide what stays intact.',
    accent: '#EEA665',
    action: 'Transplant style',
    progress: ['Reading both websites', 'Extracting visual language', 'Preserving target structure', 'Preparing the canvas'],
  },
};

export const BUILDER_STARTERS = [
  'A portfolio for an independent type designer',
  'A launch site for a new spatial audio product',
  'A research archive with editorial navigation',
];

export function isStudioMode(value) {
  return Object.prototype.hasOwnProperty.call(STUDIO_MODES, value);
}

export function defaultStudioDrafts() {
  return {
    builder: { brief: '', referenceUrl: '', referenceName: '', direction: 'Editorial and precise' },
    clone: { sourceType: 'url', url: '', screenshotName: '', fidelity: 'Balanced', notes: '' },
    style: { targetUrl: '', styleUrl: '', targetName: '', styleName: '', preservation: 'Structure + content', notes: '' },
  };
}

export function validateStudioInput(mode, draft) {
  if (mode === 'builder') {
    if (!draft?.brief?.trim()) return 'Describe the website you want to build.';
    if (draft.brief.trim().length < 12) return 'Add a little more detail so the preview has a clear direction.';
  }
  if (mode === 'clone') {
    if (draft?.sourceType === 'upload' && !draft?.screenshotName) return 'Choose a screenshot to recreate.';
    if (draft?.sourceType !== 'upload' && !looksLikeUrl(draft?.url)) return 'Enter a complete website URL.';
  }
  if (mode === 'style') {
    const hasTarget = looksLikeUrl(draft?.targetUrl) || Boolean(draft?.targetName);
    const hasStyle = looksLikeUrl(draft?.styleUrl) || Boolean(draft?.styleName);
    if (!hasTarget) return 'Add the target website or a target screenshot.';
    if (!hasStyle) return 'Add the style reference website or screenshot.';
  }
  return null;
}

function looksLikeUrl(value) {
  try {
    const url = new URL(value || '');
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch { return false; }
}

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function suggestStudioProjectName(mode, draft) {
  if (mode === 'builder') {
    const clean = (draft?.brief || '').trim().replace(/^(a|an|the)\s+/i, '');
    return clean ? clean.split(/\s+/).slice(0, 5).join(' ') : 'New website';
  }
  if (mode === 'clone') {
    if (draft?.url) {
      try { return `Recreate ${new URL(draft.url).hostname.replace(/^www\./, '')}`; } catch { /* noop */ }
    }
    return `Recreate ${draft?.screenshotName || 'reference'}`;
  }
  if (draft?.targetUrl) {
    try { return `Restyle ${new URL(draft.targetUrl).hostname.replace(/^www\./, '')}`; } catch { /* noop */ }
  }
  return `Restyle ${draft?.targetName || 'website'}`;
}

function resultCopy(mode, draft) {
  if (mode === 'builder') {
    return {
      kicker: 'Independent practice · 2026',
      title: 'Ideas deserve a shape you can feel.',
      deck: draft.brief || 'A thoughtful website, composed from your brief and references.',
      primary: 'Explore selected work',
      secondary: 'Start a conversation',
    };
  }
  if (mode === 'clone') {
    return {
      kicker: 'Faithfully rebuilt · fully editable',
      title: 'The reference, recovered as a living system.',
      deck: `A ${String(draft.fidelity || 'balanced').toLowerCase()} recreation that preserves the original rhythm without becoming a flattened screenshot.`,
      primary: 'View the recreation',
      secondary: 'Inspect the system',
    };
  }
  return {
    kicker: 'Structure preserved · language transplanted',
    title: 'A familiar story, told in a new visual voice.',
    deck: `${draft.preservation || 'Structure and content'} from the target, recomposed with the atmosphere of the style reference.`,
    primary: 'See the transformation',
    secondary: 'Compare sources',
  };
}

export function createMockSiteHtml(mode, draft = {}) {
  const copy = resultCopy(mode, draft);
  const isClone = mode === 'clone';
  const isStyle = mode === 'style';
  const bg = isClone ? '#F2EFE8' : isStyle ? '#13130F' : '#EEEDE6';
  const ink = isClone ? '#191917' : isStyle ? '#F0E9D8' : '#1A1A18';
  const accent = isClone ? '#C54E31' : isStyle ? '#EEA665' : '#2966EA';
  const panel = isStyle ? '#1E1E18' : '#FFFFFF';
  const safe = Object.fromEntries(Object.entries(copy).map(([key, value]) => [key, escapeHtml(value)]));

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
*{box-sizing:border-box}html,body{margin:0;min-height:100%;font-family:Inter,Arial,sans-serif;background:${bg};color:${ink}}
body{padding:24px}.shell{min-height:calc(100vh - 48px);border:1px solid ${isStyle ? '#37372E' : '#CFCBC0'};border-radius:22px;overflow:hidden;background:${bg}}
nav{height:70px;display:flex;align-items:center;padding:0 34px;border-bottom:1px solid ${isStyle ? '#37372E' : '#D7D3C8'};gap:24px}.mark{font-family:Arial,sans-serif;font-weight:400;letter-spacing:0;font-size:21px}.links{margin-left:auto;display:flex;gap:24px;font-size:12px}.pill{padding:10px 14px;border-radius:999px;background:${ink};color:${bg}}
.hero{min-height:550px;display:grid;grid-template-columns:1.35fr .65fr;padding:72px 54px 44px;gap:48px}.eyebrow{font-family:Arial,sans-serif;color:${accent};font-size:11px;font-weight:400;text-transform:uppercase;letter-spacing:.09em}
h1{max-width:820px;margin:18px 0 22px;font-family:Georgia,serif;font-size:clamp(52px,7vw,104px);font-weight:400;line-height:.91;letter-spacing:-.055em}.deck{max-width:580px;font-size:17px;line-height:1.55;opacity:.68}
.actions{display:flex;align-items:center;gap:14px;margin-top:36px}.actions a{padding:13px 18px;border:1px solid currentColor;border-radius:999px;font-size:12px}.actions .primary{border-color:${accent};background:${accent};color:${isStyle ? '#191917' : '#fff'}}
.artifact{align-self:end;min-height:370px;padding:24px;border-radius:18px;background:${panel};color:${isStyle ? '#F0E9D8' : '#191917'};box-shadow:0 32px 70px rgba(0,0,0,.16);transform:rotate(2deg)}
.artifact-head{display:flex;justify-content:space-between;font-size:10px;text-transform:uppercase;letter-spacing:.1em;opacity:.5}.number{margin-top:75px;font-family:Georgia,serif;font-size:110px;color:${accent};line-height:1}.artifact p{max-width:260px;font-size:13px;line-height:1.5;opacity:.65}
.rail{display:grid;grid-template-columns:repeat(3,1fr);border-top:1px solid ${isStyle ? '#37372E' : '#D7D3C8'}}.rail article{min-height:132px;padding:22px 26px;border-right:1px solid ${isStyle ? '#37372E' : '#D7D3C8'}}.rail article:last-child{border:0}.rail small{font-size:9px;text-transform:uppercase;letter-spacing:.1em;opacity:.5}.rail h2{font-family:Georgia,serif;font-size:24px;font-weight:400}
@media(max-width:760px){body{padding:10px}.shell{border-radius:14px}.links{display:none}.hero{grid-template-columns:1fr;padding:48px 24px}.artifact{display:none}.rail{grid-template-columns:1fr}.rail article{border-right:0;border-bottom:1px solid #ccc}h1{font-size:54px}}
</style></head><body><main class="shell"><nav><span class="mark">UN/01</span><span>Selected work</span><div class="links"><span>Archive</span><span>About</span><span class="pill">Get in touch</span></div></nav>
<section class="hero"><div><div class="eyebrow">${safe.kicker}</div><h1>${safe.title}</h1><p class="deck">${safe.deck}</p><div class="actions"><a class="primary">${safe.primary}</a><a>${safe.secondary}</a></div></div><aside class="artifact"><div class="artifact-head"><span>Edition 04</span><span>Uncraft</span></div><div class="number">24</div><p>Collected fragments become an original composition: traceable, editable, and ready to keep evolving.</p></aside></section>
<section class="rail"><article><small>01 · Structure</small><h2>Clear hierarchy</h2></article><article><small>02 · Character</small><h2>Quiet confidence</h2></article><article><small>03 · System</small><h2>Built to adapt</h2></article></section></main></body></html>`;
}

export function createSourcePreviewHtml(mode, draft = {}) {
  const label = mode === 'builder' ? 'Your material' : mode === 'clone' ? 'Original reference' : 'Target website';
  const source = draft.url || draft.targetUrl || draft.referenceUrl || draft.screenshotName || draft.targetName || 'Reference supplied by you';
  return `<!doctype html><html><head><style>*{box-sizing:border-box}body{margin:0;background:#e7e4dc;color:#20201e;font-family:Arial,sans-serif;padding:34px}.nav{display:flex;justify-content:space-between;padding-bottom:24px;border-bottom:1px solid #bcb8ae;font-size:12px}.hero{padding:80px 0}.ey{font-size:10px;text-transform:uppercase;letter-spacing:.14em;color:#706d65}h1{max-width:680px;margin:20px 0;font:400 76px/.96 Georgia,serif;letter-spacing:-.05em}.source{margin-top:80px;padding:18px;border:1px solid #bbb6ab;border-radius:10px;font-size:12px}</style></head><body><div class="nav"><b>SOURCE / 01</b><span>Before transformation</span></div><section class="hero"><div class="ey">${escapeHtml(label)}</div><h1>The existing material, before Uncraft.</h1><div class="source">${escapeHtml(source)}</div></section></body></html>`;
}
