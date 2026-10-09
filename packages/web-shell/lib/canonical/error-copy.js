// Texto de produto (inglês) para cada falha tipada da preparação (spec 2026-10-09 §4.4).
const DETAIL = Object.freeze({
  capture_failed: "We couldn't read the captured page.",
  sandbox_unavailable: 'Our build machine is unavailable right now.',
  recording_failed: "We couldn't record this site's motion.",
  timeout: 'This took longer than expected.',
  publish_conflict: 'This node changed while the copy was being prepared.',
});

export function canonicalErrorCopy(code) {
  return { title: "Couldn't prepare the editable copy", detail: DETAIL[code] || 'Something went wrong while preparing it.' };
}
