/*
 * Collapses the flat motion-clip list into semantic rows. SplitText emits one
 * tween per character, so a headline otherwise becomes ~200 identical entries;
 * timelines scatter their children; staggered card grids repeat one animation
 * per sibling. Grouping happens here — pure and testable — from the `group`
 * metadata the runtime bridge stamps on every clip.
 */

function clipDelay(clip) {
  const delay = Number(clip?.timing?.delay);
  return Number.isFinite(delay) ? delay : 0;
}

function trackSignature(clip) {
  return (clip?.tracks || [])
    .map((track) => String(track?.property || ''))
    .sort()
    .join(',');
}

function staggerOf(members) {
  const delays = members.map(clipDelay).sort((first, second) => first - second);
  if (delays.length < 2) return 0;
  const deltas = delays.slice(1).map((delay, index) => delay - delays[index]).sort((first, second) => first - second);
  const middle = Math.floor(deltas.length / 2);
  const median = deltas.length % 2 ? deltas[middle] : (deltas[middle - 1] + deltas[middle]) / 2;
  // Only a roughly UNIFORM progression is a stagger. Reporting the median of
  // scattered deltas would fabricate a spacing the page never had.
  const spread = deltas[deltas.length - 1] - deltas[0];
  if (spread > Math.max(10, median * 0.25)) return null;
  return Math.round(median);
}

function groupRow(type, key, clips) {
  const members = [...clips].sort((first, second) => clipDelay(first) - clipDelay(second));
  const representative = members[0];
  const scroll = members.some((clip) => clip.driver?.type === 'scroll' || clip.group?.timelineScroll);
  const label = type === 'text-reveal'
    ? members.find((clip) => clip.group?.splitRootLabel)?.group.splitRootLabel || 'Text reveal'
    : type === 'timeline'
      ? members.find((clip) => clip.group?.timelineLabel)?.group.timelineLabel || 'Timeline'
      : representative.name || 'Staggered animation';
  return {
    kind: 'group',
    type,
    id: `group:${key}`,
    label,
    clips: members,
    clip: representative,
    count: members.length,
    driver: scroll ? { type: 'scroll' } : representative.driver || { type: 'time' },
    stagger: staggerOf(members),
  };
}

export function groupMotionClips(clips) {
  const seen = new Set();
  const order = [];
  const buckets = new Map();

  (clips || []).forEach((clip) => {
    if (!clip || !clip.id || seen.has(clip.id)) return;
    seen.add(clip.id);
    const meta = clip.group || {};
    const key = meta.splitRootId
      ? `split:${meta.splitRootId}`
      : meta.timelineId
        ? `timeline:${meta.timelineId}`
        : null;
    if (key) {
      if (!buckets.has(key)) {
        buckets.set(key, []);
        order.push({ bucket: key });
      }
      buckets.get(key).push(clip);
    } else {
      order.push({ clip });
    }
  });

  // Loose clips that repeat the same animation across siblings of one parent
  // (same engine, duration and animated properties, 3+ members) are a stagger.
  // Scroll-driven clips never qualify: three same-shaped scroll reveals are
  // independent mappings, not one staggered entrance, and delay is meaningless
  // for a scrubbed tween.
  const staggerBuckets = new Map();
  order.forEach((entry) => {
    const meta = entry.clip?.group;
    if (!meta?.parentId) return;
    if (entry.clip.driver?.type === 'scroll') return;
    const signature = `${meta.parentId}|${entry.clip.engine}|${Number(entry.clip.timing?.duration) || 0}|${trackSignature(entry.clip)}`;
    if (!staggerBuckets.has(signature)) staggerBuckets.set(signature, []);
    staggerBuckets.get(signature).push(entry.clip);
  });
  const staggerBySignature = new Map();
  staggerBuckets.forEach((members, signature) => {
    if (members.length < 3) return;
    // A repeated target means two animations on ONE element — that is layered
    // motion on a single node, never a stagger across siblings.
    const targets = members.map((member) => member.group?.targetId).filter(Boolean);
    if (new Set(targets).size !== members.length) return;
    members.forEach((member) => staggerBySignature.set(member.id, signature));
  });

  const rows = [];
  const emittedStaggers = new Set();
  order.forEach((entry) => {
    if (entry.bucket) {
      const members = buckets.get(entry.bucket);
      if (members.length < 2) {
        rows.push({ kind: 'single', clip: members[0] });
        return;
      }
      rows.push(groupRow(entry.bucket.startsWith('split:') ? 'text-reveal' : 'timeline', entry.bucket, members));
      return;
    }
    const signature = staggerBySignature.get(entry.clip.id);
    if (!signature) {
      rows.push({ kind: 'single', clip: entry.clip });
      return;
    }
    if (emittedStaggers.has(signature)) return;
    emittedStaggers.add(signature);
    rows.push(groupRow('stagger', `stagger:${signature}`, staggerBuckets.get(signature)));
  });
  return rows;
}

export function applyStaggerDelays(members, staggerMs) {
  const ordered = [...(members || [])].sort((first, second) => clipDelay(first) - clipDelay(second));
  const step = Math.max(0, Number(staggerMs) || 0);
  const base = ordered.length ? clipDelay(ordered[0]) : 0;
  return ordered.map((clip, index) => ({ clip, delay: base + index * step }));
}
