// Spec 2026-09-08 §4.5: cobrar só no sucesso protege o CLIENTE, não o nosso
// orçamento — cotas, teto de concorrência e disjuntor de gasto vêm ANTES de
// abrir qualquer sessão no vendor.
import { countOpenForUser, countOpenSessions, countTodayForUser, countTodaySessions } from './job-store.js';
import { getBalance } from '../billing/ledger.js';
import { estimateOp } from '../billing/pricing.js';

const num = (env, k, d) => { const n = Number(env[k]); return Number.isFinite(n) && n >= 0 ? n : d; };

export async function checkChallengeQuota({ sql, userId, purpose, env = process.env }) {
  const dailyFree = num(env, 'UNCRAFT_CHALLENGE_DAILY_FREE', 10);
  const maxOpen = num(env, 'UNCRAFT_CHALLENGE_MAX_OPEN', 2);
  const maxSessions = num(env, 'UNCRAFT_CHALLENGE_MAX_SESSIONS', 10);
  const dailySessions = num(env, 'UNCRAFT_CHALLENGE_DAILY_SESSIONS', 200);
  const reservedForEdit = num(env, 'UNCRAFT_CHALLENGE_EDIT_RESERVED', 3);

  // Disjuntor de gasto do dia: fecha o caminho inteiro (edit incluso).
  if ((await countTodaySessions({ sql })) >= dailySessions) return { ok: false, code: 'spend_breaker', status: 429 };
  // Jobs abertos por usuário.
  if ((await countOpenForUser({ sql, userId })) >= maxOpen) return { ok: false, code: 'too_many_open', status: 429 };
  // Concorrência de sessões: a referência grátis não pode tomar as reservadas
  // para o Edit pago.
  const sessions = await countOpenSessions({ sql });
  const ceiling = purpose === 'edit' ? maxSessions : Math.max(0, maxSessions - reservedForEdit);
  if (sessions >= ceiling) return { ok: false, code: 'verification_busy', status: 429 };

  if (purpose === 'reference') {
    if ((await countTodayForUser({ sql, userId, purpose: 'reference' })) >= dailyFree) {
      return { ok: false, code: 'daily_free_quota', status: 429 };
    }
    return { ok: true };
  }
  // Edit: pré-checagem de saldo AGORA (402 na hora, não depois da dança do popup).
  const estimate = estimateOp('clone.edit');
  const balance = await getBalance({ sql, userId });
  if (balance < estimate) return { ok: false, code: 'insufficient_credits', status: 402, estimate, balance };
  return { ok: true, estimate, balance };
}
