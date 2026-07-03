// lib/billing/rate-limit.js
/**
 * Anti-flood fences (spec §5, §7.5). Counters read the tables we already
 * write — usage_events for chat turns, credit_ledger for charges — so there
 * is no extra infrastructure and limits survive restarts/instances.
 */
const CHAT_PER_MIN = () => parseInt(process.env.UNCRAFT_CHAT_PER_MIN ?? '10', 10);
const LIGHT_PER_DAY = () => parseInt(process.env.UNCRAFT_LIGHT_TURNS_PER_DAY ?? '150', 10);
const OPS_PER_MIN = () => parseInt(process.env.UNCRAFT_OPS_PER_MIN ?? '6', 10);

export async function checkChatRate({ sql, userId }) {
  const minute = await sql`
    SELECT COUNT(*)::int AS n FROM usage_events
    WHERE user_id = ${userId} AND op = 'chat' AND created_at > NOW() - make_interval(mins => 1)
  `;
  if (Number(minute[0]?.n ?? 0) >= CHAT_PER_MIN()) return { allowed: false, reason: 'chat_per_minute' };
  const day = await sql`
    SELECT COUNT(*)::int AS n FROM usage_events
    WHERE user_id = ${userId} AND op = 'chat' AND charged = FALSE AND created_at > NOW() - make_interval(hours => 24)
  `;
  if (Number(day[0]?.n ?? 0) >= LIGHT_PER_DAY()) return { allowed: false, reason: 'daily_light_turns' };
  return { allowed: true };
}

export async function checkOpsRate({ sql, userId }) {
  const minute = await sql`
    SELECT COUNT(*)::int AS n FROM credit_ledger
    WHERE user_id = ${userId} AND reason = 'charge' AND created_at > NOW() - make_interval(mins => 1)
  `;
  return { allowed: Number(minute[0]?.n ?? 0) < OPS_PER_MIN() };
}
