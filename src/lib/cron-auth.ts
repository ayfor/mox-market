// The fail-closed CRON_SECRET guard (S0.3d3, AC-1). Standards' narrow
// exception (Josh, 2026-10-05) lets a cron route write on GET only behind
// this guard, and any later cron route reuses it. It is the reverse of V1's
// guard: an unset secret refuses everything instead of skipping the check.
//
// - The secret is usable only when it is at least CRON_SECRET_MIN_LENGTH
//   printable ASCII characters (0x21 to 0x7e) with no surrounding whitespace
//   and is not the .env.example placeholder, quoted or not (S0.3d24). Anything
//   else → 500, with a reason the handler logs: unset or blank, the
//   placeholder, surrounding whitespace (a pasted or piped trailing newline),
//   a character outside printable ASCII, or too short. A padded or non-ASCII
//   value could never match a real request (Fetch and Node strip header
//   whitespace and read header bytes as latin1), so it would otherwise fail
//   every day as a misleading 401; a short one could be guessed on a public
//   URL whose GET writes.
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

/** `openssl rand -hex 32` gives 64; anything under 32 is refused (S0.3d24). */
export const CRON_SECRET_MIN_LENGTH = 32;

/** Printable ASCII without the space: what survives an HTTP header intact. */
const PRINTABLE_ASCII = /^[\x21-\x7e]+$/;

/** Why a CRON_SECRET value is unusable. */
export type CronSecretProblem =
  | "unset"
  | "placeholder"
  | "whitespace"
  | "charset"
  | "short";

export type CronAuthResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly status: 500;
      readonly problem: CronSecretProblem;
    }
  | { readonly ok: false; readonly status: 401 };

/** Null when the secret is usable, else why it is not. */
export function cronSecretProblem(
  secret: string | undefined,
): CronSecretProblem | null {
  if (secret === undefined) return "unset";
  const trimmed = secret.trim();
  if (trimmed === "") return "unset";
  if (trimmed.replace(/^(["'])(.*)\1$/, "$2") === CRON_SECRET_PLACEHOLDER) {
    return "placeholder";
  }
  if (secret !== trimmed) return "whitespace";
  if (!PRINTABLE_ASCII.test(secret)) return "charset";
  if (secret.length < CRON_SECRET_MIN_LENGTH) return "short";
  return null;
}

/** True when the secret is usable (cronSecretProblem is null). */
export function cronSecretConfigured(
  secret: string | undefined,
): secret is string {
  return cronSecretProblem(secret) === null;
}

/**
 * Checks a request's Authorization header against CRON_SECRET, read per
 * request by the caller.
 */
export function checkCronSecret(
  authorization: string | null | undefined,
  secret: string | undefined,
): CronAuthResult {
  const problem = cronSecretProblem(secret);
  if (problem !== null || secret === undefined) {
    return { ok: false, status: 500, problem: problem ?? "unset" };
  }
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
