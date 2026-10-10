// T2 (S1.3, AC-1; S1.3d6): the engine builds every reason from copy.ts at run
// time and keeps no duplicate of the text. With the copy module mocked so each
// Tier-1 template is a sentinel, every reason comes back in sentinel words.
import { describe, expect, test, vi } from "vitest";
import { computeRecommendation } from "./engine";
import { canonicalFixture } from "./fixtures";
import { buildReason } from "./reason";

vi.mock("./copy", async (importOriginal) => {
  const original = await importOriginal<typeof import("./copy")>();
  return {
    ...original,
    REASON_COPY: Object.freeze({
      ...original.REASON_COPY,
      below: "BELOW {X} PCT",
      within: "FAIR WITHIN {X}",
      atMarket: "AT PAR",
      above: "ABOVE {X}",
      thinData: "THIN {n}",
      insufficientData: "NO DATA",
    }),
  };
});

const SENTINEL_REASONS: [string, string][] = [
  ["A", "BELOW 9 PCT."],
  ["B", "FAIR WITHIN 2."],
  ["D", "ABOVE 19; THIN 10."],
  ["D-buy", "BELOW 14 PCT; THIN 10."],
  ["D0", "NO DATA"],
  ["F", "ABOVE 10."],
];

describe("reasons come only from copy.ts (T2)", () => {
  test.each(SENTINEL_REASONS)("fixture %s gives %j", (name, reason) => {
    const f = canonicalFixture(name);
    const r = computeRecommendation(f.input, f.market);
    expect(r.reason).toBe(reason);
    expect(r.kind).toBe(f.expected.kind);
  });

  test("fair at deltaBp 0 gives the at-market sentinel", () => {
    expect(
      buildReason({
        kind: "fair",
        deltaBp: 0,
        bandPct: 5,
        confidence: "high",
        snapshotCount30d: 30,
      }),
    ).toBe("AT PAR.");
  });

  test("no reason keeps the real copy's words", () => {
    const reasons = [
      ...SENTINEL_REASONS.map(([name]) => {
        const f = canonicalFixture(name);
        return computeRecommendation(f.input, f.market).reason;
      }),
      buildReason({
        kind: "fair",
        deltaBp: 0,
        bandPct: 5,
        confidence: "low",
        snapshotCount30d: 7,
      }),
    ];
    for (const reason of reasons) {
      expect(reason).not.toMatch(/market/i);
      expect(reason).not.toMatch(/snapshots/i);
    }
  });
});
