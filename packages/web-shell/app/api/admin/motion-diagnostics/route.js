import { requireAdmin } from '../../../../lib/admin-auth.js';
import { db } from '../../../../lib/db.js';
import {
  diagnosticFiltersFromUrl,
  queryMotionDiagnostics,
} from '../../../../lib/motion-editor/diagnostics.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function eventJson(row, adminUserId) {
  const canOpenAffectedNode = Number(row.user_id) === Number(adminUserId)
    && Boolean(row.board_id && row.node_id);
  return {
    id: row.id,
    occurredAt: row.occurred_at,
    source: row.source,
    transition: row.transition,
    failureCode: row.failure_code,
    failureClass: row.failure_class,
    validationStage: row.validation_stage,
    operation: row.operation,
    attempt: row.attempt == null ? null : number(row.attempt),
    stackFingerprint: row.stack_fingerprint,
    automaticSteps: Array.isArray(row.automatic_steps) ? row.automatic_steps : [],
    finalOutcome: row.final_outcome,
    runtimeFingerprint: row.runtime_fingerprint,
    bundleHashPrefix: row.bundle_hash_prefix,
    aggregationFingerprint: row.aggregation_fingerprint,
    buildVersion: row.build_version,
    engine: row.engine,
    engineVersion: row.engine_version,
    adapterVersion: row.adapter_version,
    appVersion: row.app_version,
    controlId: row.control_id,
    controlScope: row.control_scope,
    controlKind: row.control_kind,
    device: row.device,
    viewportWidth: row.viewport_width == null ? null : number(row.viewport_width),
    viewportHeight: row.viewport_height == null ? null : number(row.viewport_height),
    durationMs: row.duration_ms == null ? null : number(row.duration_ms),
    origin: row.origin,
    siteClass: row.site_class,
    canOpenAffectedNode,
    ...(canOpenAffectedNode
      ? { affectedNodeHref: `/canvas/${encodeURIComponent(row.board_id)}?focusNode=${encodeURIComponent(row.node_id)}` }
      : {}),
  };
}

function resultJson(result, filters, adminUserId) {
  return {
    view: filters.view,
    filters,
    retention: { linkedDays: 30, anonymousAggregateMonths: 12 },
    summary: {
      total: number(result.summary.total),
      recovered: number(result.summary.recovered),
      disabled: number(result.summary.disabled),
      failed: number(result.summary.failed),
    },
    groups: result.groups.map((row) => ({
      key: row.key || 'unknown',
      label: row.label || row.key || 'Unknown',
      count: number(row.count),
      supported: number(row.supported),
      recovered: number(row.recovered),
      disabled: number(row.disabled),
      failed: number(row.failed),
    })),
    events: result.events.map((row) => eventJson(row, adminUserId)),
  };
}

function csvCell(value) {
  const text = value == null ? '' : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function csvExport(events) {
  const columns = [
    'occurredAt', 'source', 'failureCode', 'validationStage', 'finalOutcome',
    'controlId', 'controlKind', 'device', 'origin', 'appVersion', 'adapterVersion',
    'durationMs', 'affectedNodeHref',
  ];
  return [
    columns.join(','),
    ...events.map((event) => columns.map((column) => csvCell(event[column])).join(',')),
  ].join('\n');
}

export async function GET(request) {
  const { user, error } = await requireAdmin(request);
  if (error) return error;
  try {
    const url = new URL(request.url);
    const filters = diagnosticFiltersFromUrl(url);
    const sql = await db();
    const result = resultJson(await queryMotionDiagnostics(sql, filters), filters, user.id);
    if (url.searchParams.get('format') === 'csv') {
      return new Response(csvExport(result.events), {
        headers: {
          'content-type': 'text/csv; charset=utf-8',
          'content-disposition': 'attachment; filename="motion-diagnostics.csv"',
          'cache-control': 'no-store',
        },
      });
    }
    const download = url.searchParams.get('download') === '1';
    return new Response(JSON.stringify(result), {
      headers: {
        'content-type': 'application/json',
        'cache-control': 'no-store',
        ...(download ? { 'content-disposition': 'attachment; filename="motion-diagnostics.json"' } : {}),
      },
    });
  } catch {
    return new Response(JSON.stringify({ error: 'temporarily_unavailable' }), {
      status: 503,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
  }
}
