// sanitizeErrorMessage (S0.2d14; ADV.13): every line the CLI prints and every
// run-row error passes through it, so a connection string pasted in the
// wrong place never reaches a terminal or the database in full. Pure.
import { describe, expect, test } from "vitest";
import { RUN_ERROR_MAX_CHARS, sanitizeErrorMessage } from "./store";

describe("sanitizeErrorMessage (ADV.13)", () => {
  test.each([
    ["Unexpected argument 'postgresql://u:pw-XYZZY@db.example.invalid/db'"],
    // path.resolve collapses the scheme's double slash.
    ["Meta.json is missing from /Users/x/postgresql:/u:pw-XYZZY@h/db"],
    ["connect failed for u:pw-XYZZY@h:5432/db"],
    ["dial postgres://u:pw-XYZZY@h:5432/db?sslmode=require now"],
    ["mixed postgresql:///u:pw-XYZZY@h/db and u:pw-XYZZY@h"],
  ])("redacts the credentials in %s", (text) => {
    const clean = sanitizeErrorMessage(text);
    expect(clean).not.toContain("pw-XYZZY");
    expect(clean).toContain("[redacted url]");
  });

  test.each([
    "SourceFormatError: AllPrices.json.gz: malformed JSON (Unexpected token at 12:30)",
    "Error: unexpected end of file",
    "contact josh@example.com",
  ])("leaves ordinary text alone: %s", (text) => {
    expect(sanitizeErrorMessage(text)).toBe(text);
  });

  test("cuts to RUN_ERROR_MAX_CHARS after redacting", () => {
    expect(sanitizeErrorMessage("x".repeat(5_000))).toHaveLength(
      RUN_ERROR_MAX_CHARS,
    );
  });
});
