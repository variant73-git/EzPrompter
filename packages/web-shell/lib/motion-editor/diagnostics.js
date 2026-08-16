import { classifyFailureCode, normalizeFailureCode } from './failure-codes.js';

export const MOTION_DIAGNOSTIC_SCHEMA_VERSION = 1;
export const MOTION_DIAGNOSTIC_MAX_BATCH = 25;
export const MOTION_DIAGNOSTIC_MAX_BYTES = 64 * 1024;
export const MOTION_DIAGNOSTIC_RAW_RETENTION_DAYS = 30;
export const MOTION_DIAGNOSTIC_AGGREGATE_RETENTION_MONTHS = 12;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_IDENTIFIER = /^[a-z0-9][a-z0-9._:@+-]{0,95}$/i;
const SAFE_HASH = /^(?:sha256:)?[0-9a-f]{12,64}$/i;
const SENSITIVE_IDENTIFIER = /(?:^|[._:@+-])(?:authorization|bearer|cookie|password|passwd|secret|token|api[-_]?key)(?:[._:@+-]|$)/i;
const SECRET_PREFIX = /^(?:sk|ghp|github_pat|xox[baprs]|AIza)[-_:]/i;
const VIEWS = new Set(['coverage', 'failures', 'smoke']);
const SOURCES = new Set(['runtime', 'binding', 'recovery', 'smoke']);
const TRANSITIONS = new Set([
  'failure-detected',
  'recovery-started',
  'recovery-step',
  'recovery-succeeded',
  'recovery-exhausted',
  'control-disabled',
  'control-ready',
  'validation-passed',
  'validation-failed',
  'runtime-reopened',
  'snapshot-restored',
]);
const VALIDATION_STAGES = new Set([
  'unknown', 'read', 'write', 'effect', 'safety', 'restore', 'repair', 'schema', 'runtime',
]);
const FINAL_OUTCOMES = new Set([
  'pending', 'supported', 'recovered', 'disabled', 'failed', 'restored',
]);
const CONTROL_SCOPES = new Set(['unknown', 'site', 'group', 'animation', 'element']);
const CONTROL_KINDS = new Set(['unknown', 'direct', 'known', 'declarative', 'custom', 'code']);
const DEVICES = new Set(['unknown', 'desktop', 'tablet', 'mobile']);
const ORIGINS = new Set(['production', 'smoke']);
const AUTOMATIC_STEPS = new Set([
  'retry', 'reinspect', 'rebind', 'reload', 'regenerate', 'disable', 'restore-snapshot',
]);
const CONTROL_KIND_ALIASES = new Map([
  ['direct', 'direct'],
  ['typed-command', 'direct'],
  ['known', 'known'],
  ['known-library', 'known'],
  ['known-runtime', 'known'],
  ['declarative', 'declarative'],
  ['declarative-adapter', 'declarative'],
  ['dom-attribute', 'declarative'],
  ['custom', 'custom'],
  ['custom-adapter', 'custom'],
  ['custom-capability', 'custom'],
  ['code', 'code'],
  ['code-only', 'code'],
]);

export class DiagnosticValidationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'DiagnosticValidationError';
    this.code = code;
  }
}

function safeIdentifier(value) {
  return typeof value === 'string'
    && SAFE_IDENTIFIER.test(value)
    && !SENSITIVE_IDENTIFIER.test(value)
    && !SECRET_PREFIX.test(value)
    ? value
    : null;
}

function safeHash(value) {
  return typeof value === 'string' && SAFE_HASH.test(value) ? value.toLowerCase() : null;
}

function boundedInteger(value, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= min ? Math.min(max, number) : null;
}

function enumValue(values, value, fallback) {
  const normalized = typeof value === 'string' ? value.toLowerCase() : '';
  return values.has(normalized) ? normalized : fallback;
}

function inferSource(input) {
  if (SOURCES.has(input.source)) return input.source;
  if (input.transition?.startsWith('recovery') || input.transition === 'snapshot-restored') return 'recovery';
  if (String(input.code || '').includes('binding') || input.code === 'target_missing') return 'binding';
  return 'runtime';
}

function inferOutcome(input, transition) {
  const explicit = enumValue(FINAL_OUTCOMES, input.finalOutcome, null);
  if (explicit) return explicit;
  if (transition === 'control-ready' || transition === 'validation-passed') return 'supported';
  if (transition === 'control-disabled') return 'disabled';
  if (transition === 'snapshot-restored') return 'restored';
  if (transition === 'recovery-succeeded' || input.recovered === true) return 'recovered';
  if (transition === 'recovery-started' || transition === 'recovery-step' || transition === 'runtime-reopened') {
    return 'pending';
  }
  return 'failed';
}

function safeOccurredAt(value, now = new Date()) {
  const parsed = new Date(value || now);
  if (Number.isNaN(parsed.getTime())) return now.toISOString();
  const delta = parsed.getTime() - now.getTime();
  if (delta > 5 * 60 * 1000 || delta < -24 * 60 * 60 * 1000) return now.toISOString();
  return parsed.toISOString();
}

export function normalizeDiagnosticControlKind(input) {
  const candidate = typeof input === 'string'
    ? input
    : input?.ladder || input?.binding?.kind || input?.kind;
  return CONTROL_KIND_ALIASES.get(String(candidate || '').toLowerCase()) || 'unknown';
}

export function sanitizeMotionDiagnosticEvent(input = {}, { now = new Date() } = {}) {
  if (Number(input.schemaVersion ?? MOTION_DIAGNOSTIC_SCHEMA_VERSION) !== MOTION_DIAGNOSTIC_SCHEMA_VERSION) {
    throw new DiagnosticValidationError('unknown_schema', 'Unknown diagnostic schema version.');
  }
  const transition = enumValue(TRANSITIONS, input.transition, 'failure-detected');
  const successfulValidation = transition === 'control-ready' || transition === 'validation-passed';
  const failureCode = successfulValidation
    ? (safeIdentifier(input.failureCode || input.code) || 'control_validated')
    : normalizeFailureCode(input.failureCode || input.code);
  const source = inferSource({ ...input, transition });
  const event = {
    schemaVersion: MOTION_DIAGNOSTIC_SCHEMA_VERSION,
    occurredAt: safeOccurredAt(input.occurredAt, now),
    source,
    transition,
    failureCode,
    failureClass: successfulValidation ? 'none' : classifyFailureCode(failureCode),
    validationStage: enumValue(VALIDATION_STAGES, input.validationStage, 'unknown'),
    finalOutcome: inferOutcome(input, transition),
    controlScope: enumValue(CONTROL_SCOPES, input.controlScope, 'unknown'),
    controlKind: normalizeDiagnosticControlKind(input.controlKind),
    device: enumValue(DEVICES, input.device, 'unknown'),
    origin: enumValue(ORIGINS, input.origin, source === 'smoke' ? 'smoke' : 'production'),
  };
  const optionalIdentifiers = {
    controlId: input.controlId,
    operation: input.operation,
    buildVersion: input.buildVersion,
    engine: input.engine,
    engineVersion: input.engineVersion,
    adapterVersion: input.adapterVersion,
    appVersion: input.appVersion,
    siteClass: input.siteClass,
  };
  Object.entries(optionalIdentifiers).forEach(([key, value]) => {
    const safe = safeIdentifier(value);
    if (safe) event[key] = safe;
  });
  const hashFields = {
    stackFingerprint: input.stackFingerprint,
    runtimeFingerprint: input.runtimeFingerprint,
    aggregationFingerprint: input.aggregationFingerprint,
  };
  Object.entries(hashFields).forEach(([key, value]) => {
    const safe = safeHash(value);
    if (safe) event[key] = safe;
  });
  const attempt = boundedInteger(input.attempt, { max: 99 });
  const durationMs = boundedInteger(input.durationMs, { max: 600_000 });
  const viewportWidth = boundedInteger(input.viewportWidth, { min: 1, max: 8192 });
  const viewportHeight = boundedInteger(input.viewportHeight, { min: 1, max: 8192 });
  if (attempt != null) event.attempt = attempt;
  if (durationMs != null) event.durationMs = durationMs;
  if (viewportWidth != null) event.viewportWidth = viewportWidth;
  if (viewportHeight != null) event.viewportHeight = viewportHeight;
  const steps = Array.isArray(input.automaticSteps)
    ? input.automaticSteps.map((step) => enumValue(AUTOMATIC_STEPS, step, null)).filter(Boolean).slice(0, 8)
    : [];
  if (steps.length) event.automaticSteps = [...new Set(steps)];
  if (typeof input.recovered === 'boolean') event.recovered = input.recovered;
  return event;
}

export function sanitizeMotionDiagnosticBatch(input = {}, options = {}) {
  if (!UUID.test(input.sessionId || '')) {
    throw new DiagnosticValidationError('invalid_session', 'A valid diagnostic session is required.');
  }
  if (!Array.isArray(input.events) || input.events.length < 1 || input.events.length > MOTION_DIAGNOSTIC_MAX_BATCH) {
    throw new DiagnosticValidationError('invalid_batch', 'Diagnostic batch size is invalid.');
  }
  const serialized = JSON.stringify(input);
  if (serialized.length > MOTION_DIAGNOSTIC_MAX_BYTES) {
    throw new DiagnosticValidationError('oversized_batch', 'Diagnostic batch is too large.');
  }
  return {
    sessionId: input.sessionId,
    events: input.events.map((event) => sanitizeMotionDiagnosticEvent(event, options)),
  };
}

export function motionControlGenerationDiagnosticEvents(generated = {}) {
  const rejected = (generated.diagnostics || []).map((item) => sanitizeMotionDiagnosticEvent({
    schemaVersion: 1,
    source: 'binding',
    transition: 'validation-failed',
    code: item.code,
    validationStage: item.stage,
    controlId: item.candidateId,
    controlKind: normalizeDiagnosticControlKind(item.ladder),
    finalOutcome: 'failed',
  }));
  const accepted = (generated.manifest?.controls || []).map((control) => sanitizeMotionDiagnosticEvent({
    schemaVersion: 1,
    source: 'binding',
    transition: 'control-ready',
    code: 'control_validated',
    validationStage: 'restore',
    controlId: control.id,
    controlKind: normalizeDiagnosticControlKind(control),
    controlScope: control.scope,
    finalOutcome: 'supported',
  }));
  return [...rejected, ...accepted];
}

export function createMotionDiagnosticBatcher({
  getSessionId,
  fetcher = (...args) => globalThis.fetch(...args),
  schedule = (callback, delay) => globalThis.setTimeout(callback, delay),
  clearSchedule = (token) => globalThis.clearTimeout(token),
  delayMs = 750,
} = {}) {
  let queue = [];
  let timer = null;
  let flushing = false;
  let disposed = false;

  function scheduleFlush() {
    if (timer != null || disposed) return;
    timer = schedule(() => {
      timer = null;
      return flush();
    }, delayMs);
  }

  function enqueue(input) {
    if (disposed) return false;
    let event;
    try {
      event = sanitizeMotionDiagnosticEvent(input);
    } catch {
      return false;
    }
    queue.push(event);
    if (queue.length >= MOTION_DIAGNOSTIC_MAX_BATCH && getSessionId?.()) void flush();
    else scheduleFlush();
    return true;
  }

  async function flush({ keepalive = false } = {}) {
    if (flushing || disposed || queue.length === 0) return false;
    const sessionId = getSessionId?.();
    if (!UUID.test(sessionId || '')) {
      return false;
    }
    if (timer != null) {
      clearSchedule(timer);
      timer = null;
    }
    const events = queue.splice(0, MOTION_DIAGNOSTIC_MAX_BATCH);
    flushing = true;
    try {
      const response = await fetcher('/api/motion-diagnostics/events', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId, events }),
        keepalive,
      });
      if (!response?.ok) throw new Error('diagnostic_ingestion_failed');
      return true;
    } catch {
      // Diagnostics are deliberately fail-open. A telemetry failure must never
      // change history, persistence, recovery, or the visible editing state.
      return false;
    } finally {
      flushing = false;
      if (queue.length && !disposed) scheduleFlush();
    }
  }

  function resume() {
    if (queue.length) void flush();
  }

  function dispose() {
    if (timer != null) clearSchedule(timer);
    timer = null;
    if (queue.length) void flush({ keepalive: true });
    disposed = true;
  }

  return { enqueue, flush, resume, dispose, get pending() { return queue.length; } };
}

export function diagnosticFiltersFromUrl(url, now = new Date()) {
  const toCandidate = new Date(url.searchParams.get('to') || now);
  const to = Number.isNaN(toCandidate.getTime()) || toCandidate > now ? now : toCandidate;
  const earliest = new Date(to.getTime() - MOTION_DIAGNOSTIC_RAW_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const fromCandidate = new Date(url.searchParams.get('from') || (to.getTime() - 7 * 24 * 60 * 60 * 1000));
  const from = Number.isNaN(fromCandidate.getTime()) || fromCandidate < earliest
    ? earliest
    : fromCandidate > to ? new Date(to.getTime() - 24 * 60 * 60 * 1000) : fromCandidate;
  const safeFilter = (name) => safeIdentifier(url.searchParams.get(name));
  return {
    view: enumValue(VIEWS, url.searchParams.get('view'), 'coverage'),
    from: from.toISOString(),
    to: to.toISOString(),
    control: safeFilter('control'),
    runtime: safeFilter('runtime'),
    device: enumValue(DEVICES, url.searchParams.get('device'), null),
    siteClass: safeFilter('siteClass'),
    appVersion: safeFilter('appVersion'),
    adapterVersion: safeFilter('adapterVersion'),
    validationStage: enumValue(VALIDATION_STAGES, url.searchParams.get('validationStage'), null),
    finalOutcome: enumValue(FINAL_OUTCOMES, url.searchParams.get('finalOutcome'), null),
    origin: enumValue(ORIGINS, url.searchParams.get('origin'), null),
  };
}

export async function resolveOwnedDiagnosticContext(sql, { userId, sessionId }) {
  const rows = await sql`
    SELECT e.user_id, n.board_id, e.node_id, e.base_snapshot_id AS snapshot_id,
           e.id AS edit_session_id, nb.runtime_fingerprint, nb.content_hash
      FROM native_motion_edit_sessions e
      JOIN nodes n ON n.id = e.node_id
      JOIN boards b ON b.id = n.board_id AND b.user_id = e.user_id
      JOIN snapshots s ON s.id = e.base_snapshot_id AND s.node_id = e.node_id
      JOIN native_bundles nb ON nb.bundle_id = s.native_bundle_id
     WHERE e.id = ${sessionId}
       AND e.user_id = ${userId}
     LIMIT 1
  `;
  return rows[0] || null;
}

export async function persistMotionDiagnosticEvents(sql, context, events) {
  const payload = events.map((event) => ({
    ...event,
    runtimeFingerprint: context.runtime_fingerprint,
    bundleHashPrefix: String(context.content_hash || '').slice(0, 19),
  }));
  await sql`
    INSERT INTO motion_diagnostic_events (
      schema_version, user_id, board_id, node_id, snapshot_id, edit_session_id,
      occurred_at, source, transition, failure_code, failure_class,
      validation_stage, operation, attempt, stack_fingerprint, automatic_steps, final_outcome,
      runtime_fingerprint, bundle_hash_prefix, build_version, engine,
      engine_version, adapter_version, app_version, control_id, control_scope,
      control_kind, device, viewport_width, viewport_height,
      aggregation_fingerprint, duration_ms, origin, site_class, expires_at
    )
    SELECT
      1, ${context.user_id}, ${context.board_id}, ${context.node_id},
      ${context.snapshot_id}, ${context.edit_session_id || null},
      COALESCE((item->>'occurredAt')::timestamptz, NOW()),
      item->>'source', item->>'transition', item->>'failureCode',
      item->>'failureClass', item->>'validationStage',
      NULLIF(item->>'operation', ''), NULLIF(item->>'attempt', '')::smallint,
      NULLIF(item->>'stackFingerprint', ''),
      COALESCE(item->'automaticSteps', '[]'::jsonb), item->>'finalOutcome',
      NULLIF(item->>'runtimeFingerprint', ''), NULLIF(item->>'bundleHashPrefix', ''),
      NULLIF(item->>'buildVersion', ''), NULLIF(item->>'engine', ''),
      NULLIF(item->>'engineVersion', ''), NULLIF(item->>'adapterVersion', ''),
      NULLIF(item->>'appVersion', ''), NULLIF(item->>'controlId', ''),
      item->>'controlScope', item->>'controlKind', item->>'device',
      NULLIF(item->>'viewportWidth', '')::smallint,
      NULLIF(item->>'viewportHeight', '')::smallint,
      NULLIF(item->>'aggregationFingerprint', ''),
      NULLIF(item->>'durationMs', '')::integer, item->>'origin',
      NULLIF(item->>'siteClass', ''),
      COALESCE((item->>'occurredAt')::timestamptz, NOW()) + INTERVAL '30 days'
      FROM jsonb_array_elements(${JSON.stringify(payload)}::jsonb) AS item
  `;
}

export async function pruneExpiredMotionDiagnostics(sql, now = new Date()) {
  await sql`
    WITH expired AS (
      DELETE FROM motion_diagnostic_events
       WHERE expires_at <= ${now.toISOString()}
       RETURNING occurred_at, source, failure_code, validation_stage,
                 final_outcome, control_kind, device, origin
    ), grouped AS (
      SELECT date_trunc('day', occurred_at)::date AS event_day,
             source, failure_code, validation_stage, final_outcome,
             control_kind, device, origin, COUNT(*)::bigint AS event_count
        FROM expired
       GROUP BY 1,2,3,4,5,6,7,8
      HAVING COUNT(*) >= 10
    ), retained AS (
      INSERT INTO motion_diagnostic_daily_aggregates (
        event_day, source, failure_code, validation_stage, final_outcome,
        control_kind, device, origin, event_count, expires_at
      )
      SELECT event_day, source, failure_code, validation_stage, final_outcome,
             control_kind, device, origin, event_count,
             event_day + INTERVAL '12 months'
        FROM grouped
      ON CONFLICT (event_day, source, failure_code, validation_stage,
                   final_outcome, control_kind, device, origin)
      DO UPDATE SET event_count = motion_diagnostic_daily_aggregates.event_count + EXCLUDED.event_count
      RETURNING id
    )
    DELETE FROM motion_diagnostic_daily_aggregates
     WHERE expires_at <= ${now.toISOString()}
  `;
}

function groupQuery(sql, filters) {
  const common = [
    filters.from, filters.to, filters.control, filters.runtime, filters.device,
    filters.siteClass, filters.appVersion, filters.adapterVersion,
    filters.validationStage, filters.finalOutcome, filters.origin,
  ];
  if (filters.view === 'failures') {
    return sql`
      SELECT COALESCE(aggregation_fingerprint, stack_fingerprint, failure_code) AS key,
             failure_code AS label, COUNT(*)::bigint AS count,
             COUNT(*) FILTER (WHERE final_outcome = 'supported')::bigint AS supported,
             COUNT(*) FILTER (WHERE final_outcome = 'recovered')::bigint AS recovered,
             COUNT(*) FILTER (WHERE final_outcome = 'disabled')::bigint AS disabled,
             COUNT(*) FILTER (WHERE final_outcome IN ('failed','restored'))::bigint AS failed
        FROM motion_diagnostic_events e
       WHERE e.occurred_at >= ${common[0]} AND e.occurred_at <= ${common[1]}
         AND (${common[2]}::text IS NULL OR e.control_id = ${common[2]})
         AND (${common[3]}::text IS NULL OR e.runtime_fingerprint = ${common[3]} OR e.engine = ${common[3]})
         AND (${common[4]}::text IS NULL OR e.device = ${common[4]})
         AND (${common[5]}::text IS NULL OR e.site_class = ${common[5]})
         AND (${common[6]}::text IS NULL OR e.app_version = ${common[6]})
         AND (${common[7]}::text IS NULL OR e.adapter_version = ${common[7]})
         AND (${common[8]}::text IS NULL OR e.validation_stage = ${common[8]})
         AND (${common[9]}::text IS NULL OR e.final_outcome = ${common[9]})
         AND (${common[10]}::text IS NULL OR e.origin = ${common[10]})
       GROUP BY 1, failure_code ORDER BY count DESC, failure_code LIMIT 100
    `;
  }
  if (filters.view === 'smoke') {
    return sql`
      SELECT COALESCE(NULLIF(control_id, ''), control_kind) AS key,
             COALESCE(NULLIF(control_id, ''), control_kind) AS label,
             COUNT(*)::bigint AS count,
             COUNT(*) FILTER (WHERE final_outcome = 'supported')::bigint AS supported,
             COUNT(*) FILTER (WHERE final_outcome = 'recovered')::bigint AS recovered,
             COUNT(*) FILTER (WHERE final_outcome = 'disabled')::bigint AS disabled,
             COUNT(*) FILTER (WHERE final_outcome IN ('failed','restored'))::bigint AS failed
        FROM motion_diagnostic_events e
       WHERE e.occurred_at >= ${common[0]} AND e.occurred_at <= ${common[1]}
         AND e.origin = 'smoke'
         AND (${common[2]}::text IS NULL OR e.control_id = ${common[2]})
         AND (${common[3]}::text IS NULL OR e.runtime_fingerprint = ${common[3]} OR e.engine = ${common[3]})
         AND (${common[4]}::text IS NULL OR e.device = ${common[4]})
         AND (${common[5]}::text IS NULL OR e.site_class = ${common[5]})
         AND (${common[6]}::text IS NULL OR e.app_version = ${common[6]})
         AND (${common[7]}::text IS NULL OR e.adapter_version = ${common[7]})
         AND (${common[8]}::text IS NULL OR e.validation_stage = ${common[8]})
         AND (${common[9]}::text IS NULL OR e.final_outcome = ${common[9]})
       GROUP BY 1 ORDER BY count DESC, label LIMIT 100
    `;
  }
  return sql`
    SELECT COALESCE(NULLIF(control_id, ''), control_kind) AS key,
           COALESCE(NULLIF(control_id, ''), control_kind) AS label,
           COUNT(*)::bigint AS count,
           COUNT(*) FILTER (WHERE final_outcome = 'supported')::bigint AS supported,
           COUNT(*) FILTER (WHERE final_outcome = 'recovered')::bigint AS recovered,
           COUNT(*) FILTER (WHERE final_outcome = 'disabled')::bigint AS disabled,
           COUNT(*) FILTER (WHERE final_outcome IN ('failed','restored'))::bigint AS failed
      FROM motion_diagnostic_events e
     WHERE e.occurred_at >= ${common[0]} AND e.occurred_at <= ${common[1]}
       AND (${common[2]}::text IS NULL OR e.control_id = ${common[2]})
       AND (${common[3]}::text IS NULL OR e.runtime_fingerprint = ${common[3]} OR e.engine = ${common[3]})
       AND (${common[4]}::text IS NULL OR e.device = ${common[4]})
       AND (${common[5]}::text IS NULL OR e.site_class = ${common[5]})
       AND (${common[6]}::text IS NULL OR e.app_version = ${common[6]})
       AND (${common[7]}::text IS NULL OR e.adapter_version = ${common[7]})
       AND (${common[8]}::text IS NULL OR e.validation_stage = ${common[8]})
       AND (${common[9]}::text IS NULL OR e.final_outcome = ${common[9]})
       AND (${common[10]}::text IS NULL OR e.origin = ${common[10]})
     GROUP BY 1 ORDER BY count DESC, label LIMIT 100
  `;
}

export async function queryMotionDiagnostics(sql, filters) {
  const smokeOnly = filters.view === 'smoke';
  const summaryRows = await sql`
    SELECT COUNT(*)::bigint AS total,
           COUNT(*) FILTER (WHERE final_outcome = 'recovered')::bigint AS recovered,
           COUNT(*) FILTER (WHERE final_outcome = 'disabled')::bigint AS disabled,
           COUNT(*) FILTER (WHERE final_outcome IN ('failed','restored'))::bigint AS failed
      FROM motion_diagnostic_events e
     WHERE e.occurred_at >= ${filters.from} AND e.occurred_at <= ${filters.to}
       AND (${filters.control}::text IS NULL OR e.control_id = ${filters.control})
       AND (${filters.runtime}::text IS NULL OR e.runtime_fingerprint = ${filters.runtime} OR e.engine = ${filters.runtime})
       AND (${filters.device}::text IS NULL OR e.device = ${filters.device})
       AND (${filters.siteClass}::text IS NULL OR e.site_class = ${filters.siteClass})
       AND (${filters.appVersion}::text IS NULL OR e.app_version = ${filters.appVersion})
       AND (${filters.adapterVersion}::text IS NULL OR e.adapter_version = ${filters.adapterVersion})
       AND (${filters.validationStage}::text IS NULL OR e.validation_stage = ${filters.validationStage})
       AND (${filters.finalOutcome}::text IS NULL OR e.final_outcome = ${filters.finalOutcome})
       AND (${filters.origin}::text IS NULL OR e.origin = ${filters.origin})
       AND (${smokeOnly}::boolean = false OR e.origin = 'smoke')
  `;
  const groups = await groupQuery(sql, filters);
  const events = await sql`
    SELECT id, occurred_at, source, transition, failure_code, failure_class,
           validation_stage, operation, attempt, stack_fingerprint,
           automatic_steps, final_outcome, runtime_fingerprint,
           bundle_hash_prefix, aggregation_fingerprint, build_version,
           engine, engine_version, adapter_version, app_version, control_id,
           control_scope, control_kind, device, viewport_width, viewport_height,
           duration_ms, origin, site_class, user_id, board_id, node_id
      FROM motion_diagnostic_events e
     WHERE e.occurred_at >= ${filters.from} AND e.occurred_at <= ${filters.to}
       AND (${filters.control}::text IS NULL OR e.control_id = ${filters.control})
       AND (${filters.runtime}::text IS NULL OR e.runtime_fingerprint = ${filters.runtime} OR e.engine = ${filters.runtime})
       AND (${filters.device}::text IS NULL OR e.device = ${filters.device})
       AND (${filters.siteClass}::text IS NULL OR e.site_class = ${filters.siteClass})
       AND (${filters.appVersion}::text IS NULL OR e.app_version = ${filters.appVersion})
       AND (${filters.adapterVersion}::text IS NULL OR e.adapter_version = ${filters.adapterVersion})
       AND (${filters.validationStage}::text IS NULL OR e.validation_stage = ${filters.validationStage})
       AND (${filters.finalOutcome}::text IS NULL OR e.final_outcome = ${filters.finalOutcome})
       AND (${filters.origin}::text IS NULL OR e.origin = ${filters.origin})
       AND (${smokeOnly}::boolean = false OR e.origin = 'smoke')
     ORDER BY e.occurred_at DESC
     LIMIT 200
  `;
  return { summary: summaryRows[0] || {}, groups, events };
}
