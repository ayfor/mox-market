// The fail-closed CRON_SECRET guard (S0.3d3, AC-1). Standards' narrow
// exception (Josh, 2026-10-05) lets a cron route write on GET only behind
// this guard, and any later cron route reuses it. It is the reverse of V1's
// guard: an unset secret refuses everything instead of skipping the check.
//
// - The secret unset, empty, whitespace only, or the .env.example placeholder
//   (so a copied example file can never authorize anything) → 500.
// - Otherwise the Authorization header must be exactly `Bearer <secret>`:
//   both are compared as UTF-8 bytes, the byte lengths first (a mismatch is
//   401 without calling timingSafeEqual, which throws on unequal lengths),
//   then in constant time with crypto.timingSafeEqual → 401 on any
//   difference.
//
// The secret is never logged, echoed or put in a response.
import crypto from "node:crypto";

/** The `.env.example` value, which never counts as a configured secret. */
export const CRON_SECRET_PLACEHOLDER = "replace-me";

export type CronAuthResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly status: 500 | 401 };

/** True when the secret is set to something other than blank or the placeholder. */
export function cronSecretConfigured(
  secret: string | undefined,
): secret is string {
  if (secret === undefined) return false;
  const trimmed = secret.trim();
  return trimmed !== "" && trimmed !== CRON_SECRET_PLACEHOLDER;
}

/**
 * Checks a request's Authorization header against CRON_SECRET, read per
 * request by the caller.
 */
export function checkCronSecret(
  authorization: string | null | undefined,
  secret: string | undefined,
): CronAuthResult {
  if (!cronSecretConfigured(secret)) return { ok: false, status: 500 };
  if (typeof authorization !== "string" || authorization === "") {
    return { ok: false, status: 401 };
  }
  const expected = Buffer.from(`Bearer ${secret}`, "utf8");
  const received = Buffer.from(authorization, "utf8");
  if (received.length !== expected.length) return { ok: false, status: 401 };
  return crypto.timingSafeEqual(received, expected)
    ? { ok: true }
    : { ok: false, status: 401 };
}
