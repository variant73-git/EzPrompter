// Máquina descartável que monta a cópia (spec 2026-10-09 §4.2). Uma tarefa por máquina; nome determinístico
// (gravado ANTES de criar, para nunca ficar órfã); nenhuma credencial entra nela — o servidor escreve os
// arquivos, dispara o comando destacado e lê o resultado.
export const VM = Object.freeze({
  root: '/vercel/sandbox',
  code: '/vercel/sandbox/c',
  capture: '/vercel/sandbox/captura',
  out: '/vercel/sandbox/out',
  progress: '/vercel/sandbox/out/progresso.jsonl',
  archive: '/vercel/sandbox/out/canonica.tgz',
  errors: '/vercel/sandbox/out/erro.txt',
  lock: '/vercel/sandbox/out/.run',
  started: '/vercel/sandbox/out/iniciado',
  done: '/vercel/sandbox/out/fim.json',
  script: '/vercel/sandbox/run.sh',
});
export const SANDBOX_VCPUS = 4;
export const SANDBOX_TIMEOUT_MS = 30 * 60 * 1000;
const ALIVE = new Set(['pending', 'running']);
export const EXIT_MEANING = Object.freeze({
  40: 'payload_missing', 41: 'install_failed', 42: 'browser_install_failed', 43: 'normalize_failed', 44: 'archive_failed',
});

export function sandboxNameFor(jobId, attempt) {
  return `uc-canon-${jobId}-a${attempt}`;
}

// Na Vercel o SDK usa o token OIDC do deploy; fora dela (dev), as três variáveis explícitas.
export function sandboxCredentials(env = process.env) {
  const token = env.UNCRAFT_SANDBOX_TOKEN;
  const teamId = env.UNCRAFT_SANDBOX_TEAM_ID;
  const projectId = env.UNCRAFT_SANDBOX_PROJECT_ID;
  return token && teamId && projectId ? { token, teamId, projectId } : {};
}

// O script é a verdade do andamento: a trava atômica (mkdir) faz uma segunda execução sair sem tocar em nada; o
// `fim.json` (código de saída) é escrito pelo próprio script ao terminar, por qualquer caminho.
export function buildRunScript() {
  return [
    '#!/usr/bin/env bash',
    'set -u',
    `mkdir -p ${VM.out}`,
    `mkdir ${VM.lock} 2>/dev/null || exit 0`,
    `trap 'echo "{\\"codigo\\":$?}" > ${VM.done}' EXIT`,
    `echo iniciado > ${VM.started}`,
    `P=${VM.progress}`,
    `echo '{"fase":"instalando"}' >> "$P"`,
    `cd ${VM.code} || exit 40`,
    `npm install --no-audit --no-fund > ${VM.out}/install.log 2>&1 || exit 41`,
    `PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64 npx playwright install --with-deps chromium >> ${VM.out}/install.log 2>&1 || exit 42`,
    `UNCRAFT_PROGRESSO="$P" node scripts/normalizar-clone.mjs --captura ${VM.capture} --saida ${VM.out}/canonica --movimento=decl+leitura --sem-plano > ${VM.out}/relatorio.json 2> ${VM.errors} || exit 43`,
    `tar -czf ${VM.archive} -C ${VM.out}/canonica . || exit 44`,
    'exit 0',
    '',
  ].join('\n');
}

export function parseExitFile(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  try {
    const codigo = JSON.parse(text).codigo;
    return Number.isInteger(codigo) ? codigo : null;
  } catch {
    return null;
  }
}

function isNotFound(error) {
  return error?.response?.status === 404 || error?.status === 404 || /not.?found/i.test(String(error?.message || ''));
}

export function createSandboxRunner({ sdkLoader = () => import('@vercel/sandbox'), env = process.env } = {}) {
  const creds = () => sandboxCredentials(env);
  const sdk = async () => (await sdkLoader()).Sandbox;
  const runner = {
    async ensure(name) {
      const Sandbox = await sdk();
      return Sandbox.getOrCreate({
        name, resources: { vcpus: SANDBOX_VCPUS }, timeout: SANDBOX_TIMEOUT_MS, persistent: false, ...creds(),
      });
    },
    async find(name) {
      const Sandbox = await sdk();
      try { return await Sandbox.get({ name, ...creds() }); } catch (error) { if (isNotFound(error)) return null; throw error; }
    },
    isAlive(sandbox) {
      return Boolean(sandbox) && ALIVE.has(sandbox.status);
    },
    async writeFiles(sandbox, files) {
      await sandbox.writeFiles(files);
    },
    async start(sandbox) {
      const cmd = await sandbox.runCommand({ cmd: 'bash', args: [VM.script], detached: true });
      return cmd.cmdId;
    },
    async readFile(sandbox, path) {
      return sandbox.readFileToBuffer({ path });
    },
    // 'stopped' = estava viva e desligamos; 'not-alive' = existe e já parou; 'absent' = não existe (AINDA — uma
    // criação que ficou no ar pode terminar depois; quem chama decide o que a ausência prova).
    async stop(name) {
      const sandbox = await runner.find(name);
      if (!sandbox) return 'absent';
      if (!runner.isAlive(sandbox)) return 'not-alive';
      await sandbox.stop();
      return 'stopped';
    },
  };
  return runner;
}
