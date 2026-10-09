import { describe, expect, it, vi } from 'vitest';
import { SANDBOX_VCPUS, VM, buildRunScript, createSandboxRunner, parseExitFile, sandboxCredentials, sandboxNameFor } from './sandbox-runner.js';

function fakeSdk({ found = null } = {}) {
  const sandbox = {
    status: 'running',
    writeFiles: vi.fn(async () => {}),
    runCommand: vi.fn(async () => ({ cmdId: 'cmd-1' })),
    readFileToBuffer: vi.fn(async () => Buffer.from('x')),
    stop: vi.fn(async () => ({})),
  };
  const Sandbox = {
    getOrCreate: vi.fn(async () => sandbox),
    get: vi.fn(async () => { if (found === 'missing') throw Object.assign(new Error('Sandbox not found'), { response: { status: 404 } }); return sandbox; }),
  };
  return { Sandbox, sandbox, loader: async () => ({ Sandbox }) };
}

describe('sandbox runner', () => {
  it('nome determinístico por tarefa e tentativa', () => {
    expect(sandboxNameFor('j1', 1)).toBe('uc-canon-j1-a1');
    expect(sandboxNameFor('j1', 2)).toBe('uc-canon-j1-a2');
  });

  it('credenciais explícitas só com as três; senão OIDC da Vercel', () => {
    expect(sandboxCredentials({})).toEqual({});
    expect(sandboxCredentials({ UNCRAFT_SANDBOX_TOKEN: 't', UNCRAFT_SANDBOX_TEAM_ID: 'team' })).toEqual({});
    expect(sandboxCredentials({ UNCRAFT_SANDBOX_TOKEN: 't', UNCRAFT_SANDBOX_TEAM_ID: 'team', UNCRAFT_SANDBOX_PROJECT_ID: 'p' }))
      .toEqual({ token: 't', teamId: 'team', projectId: 'p' });
  });

  it('o script roda o protocolo padrão, decl+leitura, sem plano e sem segredo', () => {
    const s = buildRunScript();
    expect(s).toContain('PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64');
    expect(s).toContain('--movimento=decl+leitura');
    expect(s).toContain('--sem-plano');
    expect(s).toContain(`UNCRAFT_PROGRESSO="$P"`);
    expect(s).toContain(`tar -czf ${VM.archive}`);
    expect(s).not.toMatch(/UNCRAFT_ASSENTAR_MS|UNCRAFT_LACOS_AGRUPADOS|TOKEN|SECRET|DATABASE_URL/);
  });

  it('o script recusa uma segunda execução ANTES de mexer em qualquer arquivo, e anota início e fim', () => {
    const linhas = buildRunScript().split('\n');
    const trava = linhas.findIndex((l) => l === `mkdir ${VM.lock} 2>/dev/null || exit 0`);
    const fim = linhas.findIndex((l) => l.startsWith('trap ') && l.includes(VM.done));
    const inicio = linhas.findIndex((l) => l === `echo iniciado > ${VM.started}`);
    const progresso = linhas.findIndex((l) => l.includes('"fase":"instalando"'));
    expect(trava).toBeGreaterThan(0);
    expect(fim).toBeGreaterThan(trava);      // a 2ª execução sai pela trava sem reescrever o fim.json da 1ª
    expect(inicio).toBeGreaterThan(fim);
    expect(progresso).toBeGreaterThan(inicio);
  });

  it('lê o código de saída que o script grava', () => {
    expect(parseExitFile('{"codigo":0}\n')).toBe(0);
    expect(parseExitFile('{"codigo":43}')).toBe(43);
    expect(parseExitFile('')).toBeNull();
    expect(parseExitFile('{"codigo":')).toBeNull();
    expect(parseExitFile(null)).toBeNull();
  });

  it('ensure cria com 4 vCPU, sem disco persistente, pelo nome', async () => {
    const { Sandbox, loader } = fakeSdk();
    const runner = createSandboxRunner({ sdkLoader: loader, env: {} });
    await runner.ensure('uc-canon-j1-a1');
    expect(Sandbox.getOrCreate).toHaveBeenCalledWith(expect.objectContaining({
      name: 'uc-canon-j1-a1', resources: { vcpus: SANDBOX_VCPUS }, persistent: false, timeout: 30 * 60 * 1000,
    }));
  });

  it('start destacado', async () => {
    const { sandbox, loader } = fakeSdk();
    const runner = createSandboxRunner({ sdkLoader: loader, env: {} });
    expect(await runner.start(sandbox)).toBe('cmd-1');
    expect(sandbox.runCommand).toHaveBeenCalledWith({ cmd: 'bash', args: [VM.script], detached: true });
  });

  it('find devolve null para máquina inexistente; stop só para a viva e diz o que encontrou', async () => {
    const missing = fakeSdk({ found: 'missing' });
    const semMaquina = createSandboxRunner({ sdkLoader: missing.loader, env: {} });
    expect(await semMaquina.find('x')).toBeNull();
    expect(await semMaquina.stop('x')).toBe('absent');
    const { sandbox, loader } = fakeSdk();
    const runner = createSandboxRunner({ sdkLoader: loader, env: {} });
    expect(await runner.stop('uc-canon-j1-a1')).toBe('stopped');
    expect(sandbox.stop).toHaveBeenCalledTimes(1);
    sandbox.status = 'stopped';
    expect(await runner.stop('uc-canon-j1-a1')).toBe('not-alive');
    expect(sandbox.stop).toHaveBeenCalledTimes(1);
  });
});
