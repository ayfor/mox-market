// T1 (AC-1; S0.3d3): the fail-closed CRON_SECRET guard. An unset, blank or
// placeholder secret refuses everything with 500; anything but exactly
// `Bearer <secret>` is 401; the comparison checks byte lengths first and
// then uses crypto.timingSafeEqual, which is never called on unequal lengths.
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  checkCronSecret,
  CRON_SECRET_PLACEHOLDER,
  cronSecretConfigured,
} from "./cron-auth";

const SECRET =
  "0f4c2a9e7b1d3c5e8a6f0b2d4c6e8a0f1b3d5c7e9a1b3c5d7e9f1a3b5c7d9e1f";
const MULTIBYTE = "s3cret-ünïcødé-🔑";

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
    ["an ASCII secret", SECRET],
    ["a multi-byte secret", MULTIBYTE],
  ])("Bearer <secret> is allowed for %s", (_label, secret) => {
    expect(checkCronSecret(`Bearer ${secret}`, secret)).toEqual({ ok: true });
  });
});

describe("an unconfigured secret is 500 whatever the header (T1)", () => {
  test("the placeholder is .env.example's value", () => {
    expect(examplePlaceholder()).toBe(CRON_SECRET_PLACEHOLDER);
  });

  test.each([
    ["undefined", undefined],
    ["empty", ""],
    ["whitespace", "   "],
    ["the .env.example placeholder", examplePlaceholder()],
    ["the placeholder with spaces", ` ${CRON_SECRET_PLACEHOLDER} `],
  ])("%s → 500", (_label, secret) => {
    expect(cronSecretConfigured(secret)).toBe(false);
    for (const header of [
      null,
      "",
      `Bearer ${secret ?? ""}`,
      `Bearer ${SECRET}`,
      "Bearer replace-me",
    ]) {
      expect(checkCronSecret(header, secret)).toEqual({
        ok: false,
        status: 500,
      });
    }
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

  test("a secret with the same character count but a different UTF-8 byte length is 401 without a throw", () => {
    const spy = vi.spyOn(crypto, "timingSafeEqual");
    const ascii = "x".repeat([...MULTIBYTE].length);
    expect(ascii.length).not.toBe(Buffer.byteLength(MULTIBYTE));
    expect(() => checkCronSecret(`Bearer ${ascii}`, MULTIBYTE)).not.toThrow();
    expect(checkCronSecret(`Bearer ${ascii}`, MULTIBYTE)).toEqual({
      ok: false,
      status: 401,
    });
    expect(spy).not.toHaveBeenCalled();
  });
});
