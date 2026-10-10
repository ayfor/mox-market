// T14 (AC-9): *.test.ts runs in node; only *.test.tsx gets jsdom.
import { describe, expect, test } from "vitest";

describe("unit environment", () => {
  test("has no DOM", () => {
    expect(typeof window).toBe("undefined");
    expect(typeof document).toBe("undefined");
  });
});
