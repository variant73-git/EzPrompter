/**
 * Credits — MVP stub. No enforcement: every user has unlimited credits.
 *
 * Wire Stripe checkout + a `users.credits_cents` column to enforce. This
 * module's surface (getUserCredits / deductCredits / hasEnoughCredits) is
 * already the right shape for that future change — POST /api/chat already
 * calls hasEnoughCredits before starting a run, so flipping enforcement
 * on is a 5-line change inside this file.
 */

export async function getUserCredits({ userId }) {
  return Number.MAX_SAFE_INTEGER;
}

export async function deductCredits({ userId, cents }) {
  // No-op for MVP. Returns the same "unlimited" balance.
  return Number.MAX_SAFE_INTEGER;
}

export async function hasEnoughCredits({ userId, cents }) {
  return true;
}
