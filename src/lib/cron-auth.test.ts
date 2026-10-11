// T1 (AC-1; S0.3d3, S0.3d24): the fail-closed CRON_SECRET guard. An unset,
// blank or placeholder secret, or one that is padded, not printable ASCII or
// shorter than 32 characters, refuses everything with 500 and names the
// problem; anything but exactly `Bearer <secret>` is 401; the comparison
// checks byte lengths first and then uses crypto.timingSafeEqual, which is
// never called on unequal lengths.
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  checkCronSecret,
  CRON_SECRET_MIN_LENGTH,
  CRON_SECRET_PLACEHOLDER,
  cronSecretConfigured,
  cronSecretProblem,
  type CronSecretProblem,
} from "./cron-auth";

const SECRET =
  "0f4c2a9e7b1d3c5e8a6f0b2d4c6e8a0f1b3d5c7e9a1b3c5d7e9f1a3b5c7d9e1f";
const MULTIBYTE = "s3cret-ünïcødé-🔑-0123456789abcdef0123456789";
/** Every printable ASCII character but the space (0x21 to 0x7e). */
const PRINTABLE = Array.from({ length: 0x7e - 0x21 + 1 }, (_, i) =>
  String.fromCharCode(0x21 + i),
).join("");

/** CRON_SECRET's value in the committed .env.example. */
function examplePlaceholder(): string {
  const example = readFileSync(
    path.resolve(__dirname, "..", "..", ".env.example"),
    "utf8",
  );
  const line = example.split("\n").find((l) => l.startsWith("CRON_SECRET="));
  return line!.slice("CRON_SECRET=".length).replace(/^"(.*)"$/, "$1");
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("a configured secret and the exact header (T1 happy)", () => {
  test.each([
    ["`openssl rand -hex 32` (64 hex)", SECRET],
    [
      "exactly 32 printable ASCII characters, punctuation included",
      "!#$%&()*+,-./0123456789:;<=>?@AZ",
    ],
    ["the whole printable range", PRINTABLE],
  ])("Bearer <secret> is allowed for %s", (_label, secret) => {
    expect(cronSecretProblem(secret)).toBeNull();
    expect(cronSecretConfigured(secret)).toBe(true);
    expect(checkCronSecret(`Bearer ${secret}`, secret)).toEqual({ ok: true });
  });

  test("the minimum is 32 characters", () => {
    expect(CRON_SECRET_MIN_LENGTH).toBe(32);
    expect(cronSecretProblem("x".repeat(32))).toBeNull();
    expect(cronSecretProblem("x".repeat(31))).toBe("short");
  });
});

describe("an unusable secret is 500 whatever the header, with its problem (T1, S0.3d24)", () => {
  test("the placeholder is .env.example's value", () => {
    expect(examplePlaceholder()).toBe(CRON_SECRET_PLACEHOLDER);
  });

  const cases: [string, string | undefined, CronSecretProblem][] = [
    ["undefined", undefined, "unset"],
    ["empty", "", "unset"],
    ["whitespace", "   ", "unset"],
    ["a newline", "\n", "unset"],
    ["the .env.example placeholder", examplePlaceholder(), "placeholder"],
    [
      "the placeholder with spaces",
      ` ${CRON_SECRET_PLACEHOLDER} `,
      "placeholder",
    ],
    [
      "the placeholder pasted with its double quotes",
      `"${CRON_SECRET_PLACEHOLDER}"`,
      "placeholder",
    ],
    [
      "the placeholder in single quotes",
      `'${CRON_SECRET_PLACEHOLDER}'`,
      "placeholder",
    ],
    [
      "a real secret with a trailing newline (piped from openssl into vercel env add)",
      `${SECRET}\n`,
      "whitespace",
    ],
    ["a real secret with a trailing CRLF", `${SECRET}\r\n`, "whitespace"],
    ["a real secret with leading spaces", `  ${SECRET}`, "whitespace"],
    ["a real secret padded both sides", ` ${SECRET} `, "whitespace"],
    ["a multi-byte secret", MULTIBYTE, "charset"],
    ["a long secret with one non-ASCII letter", `${SECRET}ü`, "charset"],
    [
      "a secret with an inner space",
      `${SECRET.slice(0, 32)} ${SECRET}`,
      "charset",
    ],
    [
      "a secret with a tab inside",
      `${SECRET.slice(0, 32)}\t${SECRET}`,
      "charset",
    ],
    ["a one-character secret", "a", "short"],
    ["a short real-looking secret", "short-real-secret", "short"],
    ["31 characters", SECRET.slice(0, 31), "short"],
  ];

  test.each(cases)("%s → 500 (%s)", (_label, secret, problem) => {
    expect(cronSecretProblem(secret)).toBe(problem);
    expect(cronSecretConfigured(secret)).toBe(false);
    for (const header of [
      null,
      "",
      `Bearer ${secret ?? ""}`,
      `Bearer ${(secret ?? "").trim()}`,
      `Bearer ${SECRET}`,
      "Bearer replace-me",
    ]) {
      expect(checkCronSecret(header, secret)).toEqual({
        ok: false,
        status: 500,
        problem,
      });
    }
  });

  test("why: a padded or non-ASCII secret can never be matched by a real request header", () => {
    // Fetch strips a header value's surrounding whitespace, so the header
    // Vercel builds from a value ending in a newline arrives without it.
    const padded = new Headers({ Authorization: `Bearer ${SECRET}\n` });
    expect(padded.get("authorization")).toBe(`Bearer ${SECRET}`);
    // Header values are bytes; a character over 255 cannot be sent at all.
    expect(
      () => new Headers({ Authorization: `Bearer ${MULTIBYTE}` }),
    ).toThrow();
  });
});

describe("a wrong or malformed header is 401 (T1)", () => {
  const wrong: [string, string | null | undefined][] = [
    ["missing (null)", null],
    ["missing (undefined)", undefined],
    ["empty", ""],
    ["Bearer alone", "Bearer"],
    ["Bearer and a space", "Bearer "],
    ["lower-case scheme", `bearer ${SECRET}`],
    ["Basic scheme", `Basic ${SECRET}`],
    ["two spaces", `Bearer  ${SECRET}`],
    ["a trailing space", `Bearer ${SECRET} `],
    ["the secret without the scheme", SECRET],
    ["a same-length wrong secret", `Bearer ${SECRET.slice(0, -1)}0`],
    ["one byte shorter", `Bearer ${SECRET.slice(0, -1)}`],
    ["one byte longer", `Bearer ${SECRET}0`],
    ["a prefix of the secret", `Bearer ${SECRET.slice(0, 10)}`],
    ["a suffix of the secret", `Bearer ${SECRET.slice(-10)}`],
  ];

  test.each(wrong)("%s → 401", (_label, header) => {
    expect(checkCronSecret(header, SECRET)).toEqual({
      ok: false,
      status: 401,
    });
  });
});

describe("constant-time comparison (T1)", () => {
  test("timingSafeEqual is never called on a byte-length mismatch", () => {
    const spy = vi.spyOn(crypto, "timingSafeEqual");
    for (const header of [
      `Bearer ${SECRET}0`,
      `Bearer ${SECRET.slice(0, -1)}`,
      "Bearer",
      SECRET,
    ]) {
      expect(checkCronSecret(header, SECRET)).toEqual({
        ok: false,
        status: 401,
      });
    }
    expect(spy).not.toHaveBeenCalled();
  });

  test("timingSafeEqual is called exactly once on equal lengths, right or wrong", () => {
    const spy = vi.spyOn(crypto, "timingSafeEqual");
    expect(checkCronSecret(`Bearer ${SECRET}`, SECRET)).toEqual({ ok: true });
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockClear();
    expect(checkCronSecret(`Bearer ${SECRET.slice(0, -1)}0`, SECRET)).toEqual({
      ok: false,
      status: 401,
    });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  test("a header with the secret's character count but a different UTF-8 byte length is 401 without a throw", () => {
    const spy = vi.spyOn(crypto, "timingSafeEqual");
    // One multi-byte character in place of the first: same length in
    // characters, one more byte (a latin1-decoded header can carry it).
    const header = `Bearer ü${SECRET.slice(1)}`;
    expect(header.length).toBe(`Bearer ${SECRET}`.length);
    expect(Buffer.byteLength(header)).not.toBe(
      Buffer.byteLength(`Bearer ${SECRET}`),
    );
    expect(() => checkCronSecret(header, SECRET)).not.toThrow();
    expect(checkCronSecret(header, SECRET)).toEqual({
      ok: false,
      status: 401,
    });
    expect(spy).not.toHaveBeenCalled();
  });
});
