// Consulta da preparação (spec 2026-10-09 §4): uma por vez — a próxima só sai depois da resposta, porque cada
// consulta pode ser o passo que trabalha (até minutos). Erro de rede passageiro continua; cinco seguidos desistem.
// A conclusão de cada execução é idempotente: `stop()` no meio de uma consulta pendente resolve como cancelado e a
// resposta que chegar depois é ignorada.
export function createCanonicalPoller({
  advance,
  intervalMs = 2000,
  maxErrors = 5,
  schedule = (fn, ms) => setTimeout(fn, ms),
  cancel = (t) => clearTimeout(t),
  onUpdate = () => {},
}) {
  let timer = null;
  let active = null; // conclusão da execução corrente

  function clearTimer() {
    if (timer != null) cancel(timer);
    timer = null;
  }

  function stop() {
    clearTimer();
    if (active) active({ ok: false, code: 'cancelled' });
  }

  function run(jobId) {
    let errors = 0;
    return new Promise((resolve) => {
      let done = false;
      const finish = (value) => {
        if (done) return;
        done = true;
        if (active === finish) active = null;
        clearTimer();
        resolve(value);
      };
      active = finish;
      const tick = async () => {
        timer = null;
        if (done) return;
        let out;
        try {
          out = await advance(jobId);
          errors = 0;
        } catch (e) {
          if (done) return;
          errors += 1;
          if (errors >= maxErrors || e?.code === 'not_found') { finish({ ok: false, code: e?.code || 'internal' }); return; }
          timer = schedule(tick, intervalMs);
          return;
        }
        if (done) return;
        const job = out?.job;
        if (job) onUpdate(job);
        if (job?.status === 'ready' && out.result) { finish({ ok: true, job, result: out.result }); return; }
        if (job?.status === 'failed') { finish({ ok: false, code: job.errorCode || 'internal', job }); return; }
        timer = schedule(tick, intervalMs);
      };
      tick();
    });
  }

  return { run, stop };
}
