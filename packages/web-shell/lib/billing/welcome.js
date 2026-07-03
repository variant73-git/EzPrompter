// lib/billing/welcome.js
/**
 * Welcome pack + anti-bot-farm identity gates (spec §6-7). Every gate lives
 * on IDENTITY or BUDGET — never on usage milestones (free exploration is
 * sacred). Ledger meta records email_norm/ip/device so the window checks
 * query the ledger itself (no extra table).
 */
import { DISPOSABLE_DOMAINS } from './disposable-domains.js';
import { grantCredits } from './ledger.js';

export const WELCOME_CREDITS = 500;
const WINDOW_DAYS = 30;

export function normalizeEmail(email) {
  const [local = '', domain = ''] = String(email || '').toLowerCase().trim().split('@');
  return `${local.split('+')[0]}@${domain}`;
}

export function isDisposableEmail(email) {
  const domain = String(email || '').toLowerCase().split('@')[1] || '';
  return DISPOSABLE_DOMAINS.has(domain);
}

export async function grantWelcomeIfEligible({ sql, userId, email, ip = null, deviceHash = null }) {
  if (isDisposableEmail(email)) return { granted: false, credits: 0, reason: 'disposable_email' };
  const emailNorm = normalizeEmail(email);

  const prior = await sql`
    SELECT 1 FROM credit_ledger
    WHERE reason = 'welcome' AND meta->>'email_norm' = ${emailNorm}
    LIMIT 1
  `;
  if (prior.length) return { granted: false, credits: 0, reason: 'email_already_granted' };

  const windowHit = await sql`
    SELECT 1 AS n FROM credit_ledger
    WHERE reason = 'welcome'
      AND created_at > NOW() - make_interval(days => ${WINDOW_DAYS})
      AND ((${ip}::text IS NOT NULL AND meta->>'ip' = ${ip}) OR (${deviceHash}::text IS NOT NULL AND meta->>'device' = ${deviceHash}))
    LIMIT 1
  `;
  if (windowHit.length) return { granted: false, credits: 0, reason: 'identity_window' };

  const budget = parseInt(process.env.WELCOME_BUDGET_MONTHLY_CREDITS ?? '0', 10);
  if (budget > 0) {
    const spent = await sql`
      SELECT COALESCE(SUM(delta_credits), 0) AS total FROM credit_ledger
      WHERE reason = 'welcome' AND created_at > date_trunc('month', NOW())
    `;
    if (Number(spent[0]?.total ?? 0) + WELCOME_CREDITS > budget) {
      console.warn('[welcome] monthly budget exhausted — new signup got no pack');
      return { granted: false, credits: 0, reason: 'budget_exhausted' };
    }
  }

  await grantCredits({ sql, userId, credits: WELCOME_CREDITS, reason: 'welcome', meta: { email_norm: emailNorm, ip, device: deviceHash } });
  return { granted: true, credits: WELCOME_CREDITS, reason: 'ok' };
}
