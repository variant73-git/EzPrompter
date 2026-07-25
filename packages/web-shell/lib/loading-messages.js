export const PATIENCE_SUFFIX = 'Please wait — it’ll be worth the wait.';

const MESSAGE_POOLS = {
  checking: [
    'This website is deciding whether to let us in.',
    'We are knocking on this website’s door.',
    'This website is playing a tiny game of hard to get.',
  ],
  shy: [
    'This website is shy. We are giving it a little pep talk.',
    'This website is hiding behind the curtains. We are coaxing it back onstage.',
    'This website got shy at the last second. Good thing we brought snacks.',
  ],
  launching: [
    'We are taking the scenic route to this website.',
    'The website is being invited backstage.',
    'A secret door has opened. We are stepping through it.',
  ],
  navigating: [
    'The website is getting ready for its close-up.',
    'We are giving the page a moment to compose itself.',
    'The website is finding its good side.',
  ],
  capturing: [
    'The website is packing its best pixels.',
    'We are teaching this website how to travel.',
    'The page is folding itself neatly for the canvas.',
  ],
  thumbnailing: [
    'The pixels are lining up for inspection.',
    'We are making sure every pixel brought its passport.',
    'The website is squeezing into its canvas outfit.',
  ],
  thinking: [
    'The machine is plotting something rather clever.',
    'A little digital mischief is underway.',
    'The pixels are having a private strategy meeting.',
  ],
  finalizing: [
    'Almost there. The website is fixing its hair.',
    'The final pixels are finding their seats.',
    'The website is practicing its grand entrance.',
  ],
  image: [
    'The pixels are dressing for the occasion.',
    'A fresh image is learning how to exist.',
    'The canvas ordered something visual and bold.',
  ],
  extracting: [
    'We are looking for the good stuff.',
    'The useful bits are coming out of hiding.',
    'We are separating the signal from the confetti.',
  ],
  composing: [
    'Something bold is taking shape.',
    'The pieces are learning how to work together.',
    'The canvas is cooking. No peeking yet.',
  ],
  generic: [
    'The machine is doing its mysterious thing.',
    'Something useful is happening behind the curtain.',
    'A small amount of digital sorcery is in progress.',
  ],
};

function stableIndex(seed, length) {
  const text = String(seed || 'uncraft');
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash) % length;
}

export function normalizeLoadingStage(stage, kind = '') {
  const value = String(stage || '').toLowerCase();
  if (/check|preflight|embed/.test(value)) return 'checking';
  if (/shy|block|workaround/.test(value)) return 'shy';
  if (/launch|open|browser/.test(value)) return 'launching';
  if (/navigat|load|visit/.test(value)) return 'navigating';
  if (/captur|snapshot|pack/.test(value)) return 'capturing';
  if (/thumbnail|render|pixel/.test(value)) return 'thumbnailing';
  if (/think|reconstruct|plan/.test(value)) return 'thinking';
  if (/final|finish|polish/.test(value)) return 'finalizing';
  if (/extract/.test(value)) return 'extracting';
  if (/compos|generat|creat|build|run/.test(value)) return kind === 'image' || kind === 'asset' ? 'image' : 'composing';
  if (kind === 'image' || kind === 'asset') return 'image';
  return 'generic';
}

export function playfulLoadingMessage({ nodeId, stage, kind } = {}) {
  const normalizedStage = normalizeLoadingStage(stage, kind);
  const pool = MESSAGE_POOLS[normalizedStage] || MESSAGE_POOLS.generic;
  const line = pool[stableIndex(`${nodeId}:${normalizedStage}`, pool.length)];
  return `${line} ${PATIENCE_SUFFIX}`;
}
