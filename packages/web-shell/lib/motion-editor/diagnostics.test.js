import { describe, expect, it, vi } from 'vitest';
import {
  DiagnosticValidationError,
  createMotionDiagnosticBatcher,
  diagnosticFiltersFromUrl,
  motionControlGenerationDiagnosticEvents,
  normalizeDiagnosticControlKind,
  pruneExpiredMotionDiagnostics,
  queryMotionDiagnostics,
  sanitizeMotionDiagnosticBatch,
  sanitizeMotionDiagnosticEvent,
} from './diagnostics.js';

const SESSION_ID = '10000000-0000-4000-8000-000000000001';

function fakeSql(results = []) {
  let index = 0;
  const calls = [];
  const sql = (strings, ...values) => {
    calls.push({ text: Array.isArray(strings) ? strings.join(' ') : String(strings), values });
    return Promise.resolve(results[index++] || []);
  };
  sql.calls = calls;
  return sql;
}

describe('motion diagnostics', () => {
  it('keeps only bounded technical fields and drops user content and secrets', () => {
    const event = sanitizeMotionDiagnosticEvent({
      schemaVersion: 1,
      source: 'runtime',
      transition: 'failure-detected',
      code: 'target_missing',
      failureClass: 'stale-binding',
      controlId: 'motion-speed',
      operation: 'reinspect',
      attempt: 2,
      recovered: false,
      device: 'mobile',
      viewportWidth: 390,
      viewportHeight: 844,
      message: 'Authorization: Bearer secret-token',
      stack: 'Error at /Users/alice/private/site.js?token=secret:42',
      selector: '#customer-name',
      html: '<form>private value</form>',
      prompt: 'private prompt',
      url: 'https://private.example/path?token=secret',
      appVersion: 'sk-secret-value',
      adapterVersion: 'authorization-token',
    });

    expect(event).toMatchObject({
      schemaVersion: 1,
      source: 'runtime',
      transition: 'failure-detected',
      failureCode: 'target_missing',
      controlId: 'motion-speed',
      operation: 'reinspect',
      attempt: 2,
      finalOutcome: 'failed',
      device: 'mobile',
      viewportWidth: 390,
      viewportHeight: 844,
    });
    expect(JSON.stringify(event)).not.toMatch(/secret|alice|private|selector|html|prompt|authorization/i);
  });

  it('groups failure evidence by a sanitized fingerprint when one is available', async () => {
    const sql = fakeSql([[{}], [], []]);
    await queryMotionDiagnostics(sql, {
      view: 'failures',
      from: '2026-07-20T00:00:00.000Z',
      to: '2026-07-27T00:00:00.000Z',
      control: null,
      runtime: null,
      device: null,
      siteClass: null,
      appVersion: null,
      adapterVersion: null,
      validationStage: null,
      finalOutcome: null,
      origin: null,
    });

    expect(sql.calls[1].text).toMatch(/COALESCE\(aggregation_fingerprint, stack_fingerprint, failure_code\)/i);
    expect(sql.calls[1].text).toMatch(/final_outcome = 'supported'/i);
  });

  it('rejects unknown schemas, oversized batches, and invalid sessions', () => {
    expect(() => sanitizeMotionDiagnosticEvent({ schemaVersion: 99 })).toThrow(DiagnosticValidationError);
    expect(() => sanitizeMotionDiagnosticBatch({ sessionId: 'not-a-session', events: [] }))
      .toThrow(/session/i);
    expect(() => sanitizeMotionDiagnosticBatch({
      sessionId: SESSION_ID,
      events: Array.from({ length: 26 }, () => ({ schemaVersion: 1 })),
    })).toThrow(/batch/i);
  });

  it('normalizes manifest ladder and binding families for coverage', () => {
    expect(normalizeDiagnosticControlKind({ ladder: 'known-library', binding: { kind: 'known-runtime' } }))
      .toBe('known');
    expect(normalizeDiagnosticControlKind({ ladder: 'declarative-adapter', binding: { kind: 'dom-attribute' } }))
      .toBe('declarative');
    expect(normalizeDiagnosticControlKind({ binding: { kind: 'typed-command' } })).toBe('direct');

    const [rejected, accepted] = motionControlGenerationDiagnosticEvents({
      diagnostics: [{ code: 'no_effect', stage: 'effect', candidateId: 'candidate-1', ladder: 'custom-adapter' }],
      manifest: {
        controls: [{
          id: 'speed',
          scope: 'animation',
          ladder: 'known-library',
          binding: { kind: 'known-runtime' },
        }],
      },
    });
    expect(rejected).toMatchObject({ failureCode: 'no_effect', controlKind: 'custom' });
    expect(accepted).toMatchObject({ failureCode: 'control_validated', controlKind: 'known' });
  });

  it('batches browser events and never surfaces transport failure to editing', async () => {
    const scheduled = [];
    const fetcher = vi.fn(async () => { throw new Error('offline'); });
    const reporter = createMotionDiagnosticBatcher({
      getSessionId: () => SESSION_ID,
      fetcher,
      schedule: (callback) => { scheduled.push(callback); return scheduled.length; },
      clearSchedule: vi.fn(),
      delayMs: 5,
    });

    expect(reporter.enqueue({ schemaVersion: 1, code: 'bridge_timeout' })).toBe(true);
    await scheduled[0]();

    expect(fetcher).toHaveBeenCalledOnce();
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ sessionId: SESSION_ID });
    await expect(reporter.flush()).resolves.toBe(false);
  });

  it('caps detailed queries at the approved 30-day window', () => {
    const filters = diagnosticFiltersFromUrl(new URL(
      'https://uncraft.test/api/admin/motion-diagnostics?view=failures&from=2020-01-01T00:00:00.000Z&device=mobile',
    ), new Date('2026-07-27T12:00:00.000Z'));

    expect(filters.view).toBe('failures');
    expect(filters.device).toBe('mobile');
    expect(new Date(filters.to).getTime() - new Date(filters.from).getTime())
      .toBe(30 * 24 * 60 * 60 * 1000);
  });

  it('purges only expired diagnostic storage', async () => {
    const sql = fakeSql();
    await pruneExpiredMotionDiagnostics(sql, new Date('2026-07-27T12:00:00.000Z'));
    const statement = sql.calls.map((call) => call.text).join('\n');

    expect(statement).toMatch(/DELETE FROM motion_diagnostic_events/i);
    expect(statement).toMatch(/motion_diagnostic_daily_aggregates/i);
    expect(statement).not.toMatch(/DELETE FROM snapshots|DELETE FROM native_bundles/i);
  });

  it('expires linked evidence 30 days from the sanitized occurrence time', async () => {
    const sql = fakeSql();
    const context = {
      user_id: 7,
      board_id: '20000000-0000-4000-8000-000000000001',
      node_id: '30000000-0000-4000-8000-000000000001',
      snapshot_id: '40000000-0000-4000-8000-000000000001',
      edit_session_id: SESSION_ID,
    };
    const { persistMotionDiagnosticEvents } = await import('./diagnostics.js');
    await persistMotionDiagnosticEvents(sql, context, [sanitizeMotionDiagnosticEvent({
      occurredAt: '2026-07-27T10:00:00.000Z',
      code: 'bridge_timeout',
    }, { now: new Date('2026-07-27T10:00:00.000Z') })]);

    expect(sql.calls[0].text).toMatch(/occurredAt[\s\S]+INTERVAL '30 days'/i);
  });
});
