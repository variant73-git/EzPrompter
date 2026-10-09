import { describe, expect, it, vi } from 'vitest';
import { advanceCanonicalJob, sweepCanonicalJobs } from './job-service.js';
import { ACTIVE, TERMINAL } from './job-store.js';
import { VM } from './sandbox-runner.js';

// Armazém EM MEMÓRIA com as mesmas cercas do SQL (status + geração + dono), para a máquina de estados ser
// exercitada de verdade e não por mocks soltos.
function memoryJobStore(initial) {
  const rows = new Map(initial.map((r) => [r.id, { ...r }]));
  const PATCH = ['stage', 'sandbox_name', 'command_id', 'progress_pct', 'result_bundle_id', 'error_code', 'error_detail'];
  const apply = (row, patch) => {
    for (const k of PATCH) if (patch?.[k] != null) row[k] = k === 'progress_pct' ? Math.max(row.progress_pct, patch[k]) : patch[k];
  };
  return {
    ACTIVE, TERMINAL, rows,
    async getOwnedJob({ userId, jobId }) { const r = rows.get(jobId); return r && r.user_id === userId ? { ...r } : null; },
    async acquireLease({ jobId, owner }) {
      const r = rows.get(jobId);
      if (!r || !ACTIVE.includes(r.status) || r.lease_owner) return null;
      r.lease_owner = owner; return { ...r };
    },
    async releaseLease({ jobId, owner }) { const r = rows.get(jobId); if (r && r.lease_owner === owner) r.lease_owner = null; },
    async moveJob({ jobId, owner, generation, from, to, patch }) {
      const r = rows.get(jobId);
      if (!r || r.status !== from || r.generation !== generation || r.lease_owner !== owner) return null;
      r.status = to; r.generation += 1; apply(r, patch); return { ...r };
    },
    async noteJob({ jobId, owner, generation, patch }) {
      const r = rows.get(jobId);
      if (!r || r.generation !== generation || r.lease_owner !== owner || !ACTIVE.includes(r.status)) return null;
      apply(r, patch); return { ...r };
    },
    async restartJob({ jobId, owner, generation, from }) {
      const r = rows.get(jobId);
      if (!r || r.status !== from || r.generation !== generation || r.lease_owner !== owner || r.attempt >= 2) return null;
      Object.assign(r, { status: 'queued', generation: r.generation + 1, attempt: r.attempt + 1, sandbox_name: null, command_id: null, stage: null });
      return { ...r };
    },
    async listOverdueJobs() { return [...rows.values()].filter((r) => ACTIVE.includes(r.status) && r.deadline_at < Date.now()).map((r) => ({ ...r })); },
    async failOverdueJob({ jobId, generation, from }) {
      const r = rows.get(jobId);
      // espelha `(lease_until IS NULL OR lease_until < NOW())`: aqui, trava presente = válida
      if (!r || r.status !== from || r.generation !== generation || r.lease_owner) return null;
      Object.assign(r, { status: 'failed', generation: r.generation + 1, error_code: 'timeout', lease_owner: null }); return { ...r };
    },
    async listCleanupPending() { return [...rows.values()].filter((r) => TERMINAL.has(r.status) && !r.cleanup_done).map((r) => ({ ...r })); },
    async markCleanupDone({ jobId }) { const r = rows.get(jobId); if (r && TERMINAL.has(r.status)) r.cleanup_done = true; },
  };
}

function baseJob(over = {}) {
  return {
    id: 'j1', user_id: 1, board_id: 'b1', node_id: 'n1', source_snapshot_id: 's1', native_bundle_id: 'nb1',
    status: 'queued', stage: null, progress_pct: 10, generation: 1, attempt: 1, lease_owner: null,
    sandbox_name: null, command_id: null, op_id: 'op1', result_bundle_id: null, result_snapshot_id: null,
    error_code: null, error_detail: null, cleanup_done: false, deadline_at: Date.now() + 60_000, created_at: Date.now(), ...over,
  };
}

// `vm.files` = arquivos que a MÁQUINA tem (o script escreve `iniciado` e `fim.json` — a verdade do andamento).
function setup(jobOver = {}, { vm = {} } = {}) {
  const store = memoryJobStore([baseJob(jobOver)]);
  const sandbox = { status: 'running' };
  const files = new Map(Object.entries(vm.files || {}));
  const runner = {
    ensure: vi.fn(async () => sandbox),
    find: vi.fn(async () => (vm.missing ? null : sandbox)),
    isAlive: (s) => Boolean(s) && ['pending', 'running'].includes(s.status),
    writeFiles: vi.fn(async () => {}),
    start: vi.fn(async () => 'cmd-1'),
    readFile: vi.fn(async (_s, p) => (files.has(p) ? Buffer.from(files.get(p)) : null)),
    stop: vi.fn(async () => {}),
  };
  let n = 0;
  const deps = {
    jobStore: store,
    runner,
    bundleStore: {},
    loadCodePayload: vi.fn(async () => [{ path: `${VM.code}/package.json`, content: Buffer.from('{}') }]),
    loadCapturePayload: vi.fn(async () => [{ path: `${VM.capture}/index.html`, content: Buffer.from('<html>') }]),
    loadNativeDescriptor: vi.fn(async () => ({ entryPath: 'index.html', assetIndex: [] })),
    readTarGz: vi.fn(async () => [
      { path: 'index.html', body: new TextEncoder().encode('<html>canonica</html>') },
      { path: 'motion.json', body: new TextEncoder().encode('{"versao":0,"fichas":[]}') },
    ]),
    registerNativeBundle: vi.fn(async () => ({ bundleId: 'cb1', runtimeFingerprint: `sha256:${'c'.repeat(64)}` })),
    persistNativeBundleDescriptor: vi.fn(async () => {}),
    publishCanonical: vi.fn(async ({ job }) => {
      const r = store.rows.get(job.id);
      Object.assign(r, { status: 'ready', generation: r.generation + 1, progress_pct: 100, result_bundle_id: 'cb1', result_snapshot_id: 's2', lease_owner: null });
      return { snapshotId: 's2' };
    }),
    settleOperation: vi.fn(async () => ({})),
    newOwner: () => `w${(n += 1)}`,
  };
  return { store, runner, deps, sandbox, files };
}

const advance = (deps) => advanceCanonicalJob({ sql: {}, userId: 1, jobId: 'j1', deps });
const gravando = (over = {}) => ({ status: 'recording', sandbox_name: 'uc-canon-j1-a1', command_id: 'cmd-1', progress_pct: 14, ...over });

describe('avançar a preparação', () => {
  it('fila → máquina criada pelo nome → arquivos → comando → gravando, numa consulta', async () => {
    const { store, runner, deps } = setup();
    const out = await advance(deps);
    expect(runner.ensure).toHaveBeenCalledWith('uc-canon-j1-a1');
    expect(runner.writeFiles).toHaveBeenCalled();
    expect(runner.start).toHaveBeenCalledTimes(1);
    expect(out.job).toMatchObject({ status: 'recording', progressPct: 14 });
    expect(store.rows.get('j1')).toMatchObject({ sandbox_name: 'uc-canon-j1-a1', command_id: 'cmd-1', lease_owner: null });
  });

  it('gravando: o número vem do arquivo de progresso da máquina', async () => {
    const { deps } = setup(gravando(), { vm: { files: { [VM.progress]: '{"fase":"instalando"}\n{"fase":"gravando","feitas":20,"total":40}\n' } } });
    const out = await advance(deps);
    expect(out.job).toMatchObject({ status: 'recording', progressPct: 50 });
  });

  it('script terminou bem → registra, publica, encerra a cobrança, desliga a máquina e fecha a limpeza', async () => {
    const { store, runner, deps } = setup(gravando(), { vm: { files: { [VM.done]: '{"codigo":0}', [VM.archive]: 'tgz' } } });
    const out = await advance(deps);
    expect(out.job.status).toBe('ready');
    expect(out.result).toMatchObject({ snapshotId: 's2', snapshotSource: 'canonical', bundleDescriptor: { bundleId: 'cb1' } });
    expect(deps.publishCanonical).toHaveBeenCalledWith(expect.objectContaining({ html: '<html>canonica</html>' }));
    expect(deps.settleOperation).toHaveBeenCalledWith(expect.objectContaining({ opId: 'op1', opStatus: 'settled', chargeCredits: 0 }));
    expect(runner.stop).toHaveBeenCalledWith('uc-canon-j1-a1');
    expect(store.rows.get('j1').cleanup_done).toBe(true);
  });

  it('script falhou → recording_failed, reserva devolvida, máquina desligada', async () => {
    const { runner, deps } = setup(gravando(), { vm: { files: { [VM.done]: '{"codigo":43}', [VM.errors]: 'TypeError: x' } } });
    const out = await advance(deps);
    expect(out.job).toMatchObject({ status: 'failed', errorCode: 'recording_failed' });
    expect(deps.settleOperation).toHaveBeenCalledWith(expect.objectContaining({ opStatus: 'failed', chargeCredits: 0 }));
    expect(runner.stop).toHaveBeenCalledWith('uc-canon-j1-a1');
  });

  it('máquina morreu: recomeça do zero UMA vez (desligando a velha); na segunda, sandbox_unavailable', async () => {
    const first = setup(gravando(), { vm: { missing: true } });
    const out1 = await advance(first.deps);
    expect(out1.job.status).toBe('queued');
    expect(first.store.rows.get('j1')).toMatchObject({ attempt: 2, sandbox_name: null, command_id: null });
    expect(first.runner.stop).toHaveBeenCalledWith('uc-canon-j1-a1');
    const second = setup(gravando({ attempt: 2, sandbox_name: 'uc-canon-j1-a2', command_id: 'cmd-2' }), { vm: { missing: true } });
    const out2 = await advance(second.deps);
    expect(out2.job).toMatchObject({ status: 'failed', errorCode: 'sandbox_unavailable' });
  });

  it('outra requisição com a trava: devolve a visão sem tocar a máquina', async () => {
    const { runner, deps } = setup(gravando({ lease_owner: 'outra' }));
    const out = await advance(deps);
    expect(out.job.status).toBe('recording');
    expect(runner.find).not.toHaveBeenCalled();
    expect(runner.readFile).not.toHaveBeenCalled();
  });

  it('requisição anterior morreu DEPOIS de iniciar o script e ANTES de gravar o estado: não inicia outro', async () => {
    // estado no banco: 'provisioning' sem command_id; na máquina, o script já escreveu `iniciado`
    const { runner, deps } = setup(
      { status: 'provisioning', sandbox_name: 'uc-canon-j1-a1', command_id: null, stage: 'files' },
      { vm: { files: { [VM.started]: 'iniciado\n' } } },
    );
    const out = await advance(deps);
    expect(runner.start).not.toHaveBeenCalled();
    expect(runner.writeFiles).not.toHaveBeenCalled();
    expect(out.job.status).toBe('recording');
  });

  it('trava tomada no meio do passo: a requisição velha para — não inicia, não desliga, não cobra, não falha', async () => {
    const { store, runner, deps } = setup();
    runner.writeFiles.mockImplementationOnce(async () => { store.rows.get('j1').lease_owner = 'intruso'; });
    const out = await advance(deps);
    expect(runner.start).not.toHaveBeenCalled();
    expect(runner.stop).not.toHaveBeenCalled();
    expect(deps.settleOperation).not.toHaveBeenCalled();
    expect(out.job.status).toBe('provisioning');
    expect(store.rows.get('j1').lease_owner).toBe('intruso');
  });

  it('node mudou no meio → publish_conflict com reserva devolvida', async () => {
    const { deps } = setup(gravando(), { vm: { files: { [VM.done]: '{"codigo":0}', [VM.archive]: 'tgz' } } });
    deps.publishCanonical.mockRejectedValueOnce(Object.assign(new Error('publish_conflict'), { code: 'publish_conflict' }));
    const out = await advance(deps);
    expect(out.job).toMatchObject({ status: 'failed', errorCode: 'publish_conflict' });
    expect(deps.settleOperation).toHaveBeenCalledWith(expect.objectContaining({ opStatus: 'failed' }));
  });

  it('erro DEPOIS de mudar de estado não deixa a tarefa presa (falha lê a linha atual)', async () => {
    const { deps } = setup(gravando(), { vm: { files: { [VM.done]: '{"codigo":0}', [VM.archive]: 'tgz' } } });
    deps.registerNativeBundle.mockRejectedValueOnce(new Error('blob down'));
    const out = await advance(deps);
    expect(out.job).toMatchObject({ status: 'failed', errorCode: 'internal' });
  });

  it('desligar a máquina falhou depois de pronta: limpeza fica pendente (a varredura retoma)', async () => {
    const { store, runner, deps } = setup(gravando(), { vm: { files: { [VM.done]: '{"codigo":0}', [VM.archive]: 'tgz' } } });
    runner.stop.mockRejectedValueOnce(new Error('api down'));
    const out = await advance(deps);
    expect(out.job.status).toBe('ready');
    expect(store.rows.get('j1').cleanup_done).toBe(false);
  });

  it('criar a máquina falhou → sandbox_unavailable', async () => {
    const { runner, deps } = setup();
    runner.ensure.mockRejectedValueOnce(new Error('quota'));
    const out = await advance(deps);
    expect(out.job).toMatchObject({ status: 'failed', errorCode: 'sandbox_unavailable' });
  });

  it('captura que não serve → capture_failed', async () => {
    const { deps } = setup();
    deps.loadCapturePayload.mockRejectedValueOnce(Object.assign(new Error('entry'), { code: 'capture_failed' }));
    const out = await advance(deps);
    expect(out.job).toMatchObject({ status: 'failed', errorCode: 'capture_failed' });
  });

  it('prazo vencido → timeout, máquina desligada', async () => {
    const { runner, deps } = setup(gravando({ deadline_at: Date.now() - 1 }));
    const out = await advance(deps);
    expect(out.job).toMatchObject({ status: 'failed', errorCode: 'timeout' });
    expect(runner.stop).toHaveBeenCalledWith('uc-canon-j1-a1');
  });

  it('tarefa de outro usuário: 404', async () => {
    const { deps } = setup();
    expect(await advanceCanonicalJob({ sql: {}, userId: 2, jobId: 'j1', deps })).toEqual({ error: { code: 'not_found', status: 404 } });
  });

  it('tarefa pronta devolve o resultado em toda consulta', async () => {
    const { deps } = setup({ status: 'ready', result_bundle_id: 'cb1', result_snapshot_id: 's2', progress_pct: 100, cleanup_done: true });
    const out = await advance(deps);
    expect(out.result).toMatchObject({ snapshotId: 's2' });
  });

  it('varredura: falha as vencidas e fecha a limpeza delas', async () => {
    const { store, runner, deps } = setup(gravando({ deadline_at: Date.now() - 1 }));
    expect(await sweepCanonicalJobs({ sql: {}, deps })).toEqual({ scanned: 1, failed: 1, cleaned: 1 });
    expect(runner.stop).toHaveBeenCalledWith('uc-canon-j1-a1');
    expect(deps.settleOperation).toHaveBeenCalledWith(expect.objectContaining({ opStatus: 'failed' }));
    expect(store.rows.get('j1').cleanup_done).toBe(true);
  });

  it('varredura não derruba tarefa com trava viva, mesmo vencida: a máquina que está nascendo não fica órfã', async () => {
    const { store, runner, deps } = setup();
    let soltarEnsure;
    runner.ensure.mockImplementationOnce(() => new Promise((r) => { soltarEnsure = () => r({ status: 'running' }); }));
    const emAndamento = advance(deps);                       // pega a trava e fica esperando a máquina nascer
    await new Promise((r) => setTimeout(r, 0));
    store.rows.get('j1').deadline_at = Date.now() - 1;       // o prazo vence no meio
    expect(await sweepCanonicalJobs({ sql: {}, deps })).toEqual({ scanned: 1, failed: 0, cleaned: 0 });
    expect(runner.stop).not.toHaveBeenCalled();
    soltarEnsure();
    const out = await emAndamento;
    expect(out.job.status).toBe('recording');                // a requisição dona terminou o passo e sabe da máquina
    const depois = await advance(deps);                      // a próxima consulta vê o prazo e encerra direito
    expect(depois.job).toMatchObject({ status: 'failed', errorCode: 'timeout' });
    expect(runner.stop).toHaveBeenCalledWith('uc-canon-j1-a1');
  });

  it('máquina ausente na limpeza: fica pendente até ela aparecer e ser desligada, ou até passar o prazo dela', async () => {
    const { store, runner, deps } = setup({ status: 'failed', error_code: 'timeout', sandbox_name: 'uc-canon-j1-a1', cleanup_done: false });
    runner.stop.mockResolvedValueOnce('absent');                 // a criação ficou no ar: ainda não existe
    expect(await sweepCanonicalJobs({ sql: {}, deps })).toEqual({ scanned: 0, failed: 0, cleaned: 0 });
    expect(store.rows.get('j1').cleanup_done).toBe(false);
    expect(deps.settleOperation).toHaveBeenCalledWith(expect.objectContaining({ opStatus: 'failed' })); // dinheiro não espera
    runner.stop.mockResolvedValueOnce('stopped');                // nasceu depois: a varredura seguinte desliga
    expect(await sweepCanonicalJobs({ sql: {}, deps })).toEqual({ scanned: 0, failed: 0, cleaned: 1 });
    expect(store.rows.get('j1').cleanup_done).toBe(true);
  });

  it('máquina que nunca aparece: a ausência fecha a limpeza só depois do prazo da própria máquina', async () => {
    const { store, runner, deps } = setup({ status: 'failed', sandbox_name: 'uc-canon-j1-a1', cleanup_done: false, created_at: Date.now() - 32 * 60 * 1000 });
    runner.stop.mockResolvedValueOnce('absent');
    expect(await sweepCanonicalJobs({ sql: {}, deps })).toEqual({ scanned: 0, failed: 0, cleaned: 1 });
    expect(store.rows.get('j1').cleanup_done).toBe(true);
  });

  it('varredura retoma limpeza pendente de tarefa PRONTA: desliga e encerra a cobrança como entregue', async () => {
    const { store, runner, deps } = setup({ status: 'ready', sandbox_name: 'uc-canon-j1-a1', result_bundle_id: 'cb1', result_snapshot_id: 's2', cleanup_done: false });
    expect(await sweepCanonicalJobs({ sql: {}, deps })).toEqual({ scanned: 0, failed: 0, cleaned: 1 });
    expect(runner.stop).toHaveBeenCalledWith('uc-canon-j1-a1');
    expect(deps.settleOperation).toHaveBeenCalledWith(expect.objectContaining({ opStatus: 'settled' }));
    expect(store.rows.get('j1').cleanup_done).toBe(true);
  });
});
