// F1's canonical fixtures (S1.2d14): worked examples A–G, A-rising, D-buy and
// D0 with their exact Tier-1 outputs. One copy for S1.2's suite, S1.3's
// reason matrix and S3.1's Tier-2 fixtures. A param change that flips a
// fixture updates its expected values here, in the same PR (F1 W2).
// Test support only: imports types only, and no app code imports it.
import type {
  Confidence,
  Finish,
  MarketSnapshot,
  PriceSnapshot,
  RecommendationInput,
  RecommendationKind,
} from "./types";

/** The request date every fixture uses; history ends the day before. */
export const FIXTURE_AS_OF = "2026-10-10";

/** synced_at of the newest fixture row (passed through, never read by F1). */
export const FIXTURE_LATEST_SNAPSHOT_AT = new Date("2026-10-09T06:00:00Z");

/** A stand-in Scryfall card ID; the engine never reads it. */
export const FIXTURE_CARD_ID = "2a3d3a51-24c4-4a3a-b4ea-d9b0d4e6a6f2";

/** The F1 copy-table insufficient_data sentence, verbatim. */
export const INSUFFICIENT_DATA_SENTENCE =
  "We don't have enough pricing data on this printing to give a recommendation — try a different printing.";

/**
 * Daily snapshots on consecutive UTC dates ending at asOf − 1, oldest first:
 * values[values.length − 1] is dated asOf − 1. asOf must be 'YYYY-MM-DD'.
 */
export function dailyHistory(
  asOf: string,
  values: readonly number[],
): PriceSnapshot[] {
  const [year, month, day] = asOf.split("-").map(Number);
  return values.map((priceCents, i) => ({
    date: new Date(Date.UTC(year, month - 1, day - (values.length - i)))
      .toISOString()
      .slice(0, 10),
    priceCents,
  }));
}

/** n copies of one price. */
export const flat = (n: number, priceCents: number): number[] =>
  Array.from({ length: n }, () => priceCents);

/** n prices from start, stepping by step cents a day. */
export const ramp = (n: number, start: number, step: number): number[] =>
  Array.from({ length: n }, (_, d) => start + step * d);

export function fixtureInput(
  askingPriceCents: number,
  finish: Finish = "normal",
): RecommendationInput {
  return { askingPriceCents, cardId: FIXTURE_CARD_ID, finish };
}

export function fixtureMarket(
  currentPriceCents: number | null,
  values: readonly number[],
  options: { appliedFinish?: Finish; asOf?: string } = {},
): MarketSnapshot {
  const asOf = options.asOf ?? FIXTURE_AS_OF;
  return {
    appliedFinish: options.appliedFinish ?? "normal",
    currentPriceCents,
    history: dailyHistory(asOf, values),
    asOf,
    source: "scryfall",
    latestSnapshotAt: FIXTURE_LATEST_SNAPSHOT_AT,
  };
}

export interface CanonicalFixture {
  readonly name: string;
  readonly input: RecommendationInput;
  readonly market: MarketSnapshot;
  readonly expected: {
    readonly kind: RecommendationKind;
    readonly confidence: Confidence;
    readonly deltaBp: number | null;
    readonly reason: string;
  };
}

const fixture = (
  name: string,
  asking: number,
  market: number | null,
  values: readonly number[],
  expected: CanonicalFixture["expected"],
): CanonicalFixture => ({
  name,
  input: fixtureInput(asking),
  market: fixtureMarket(market, values),
  expected,
});

/** F1 "Worked examples", Tier 1, in the design's order. */
export const CANONICAL_FIXTURES: readonly CanonicalFixture[] = [
  fixture("A", 7400, 8150, flat(30, 8150), {
    kind: "buy",
    confidence: "high",
    deltaBp: -920,
    reason: "9% below market.",
  }),
  fixture("A-rising", 7600, 8000, ramp(30, 7304, 48), {
    kind: "fair",
    confidence: "high",
    deltaBp: -500,
    reason: "Within 5% of market.",
  }),
  fixture("B", 8000, 8150, flat(30, 8150), {
    kind: "fair",
    confidence: "high",
    deltaBp: -184,
    reason: "Within 2% of market.",
  }),
  fixture("C", 7400, 8150, ramp(30, 8696, -48), {
    kind: "buy",
    confidence: "high",
    deltaBp: -920,
    reason: "9% below market.",
  }),
  fixture("D", 5000, 4200, flat(10, 4200), {
    kind: "wait",
    confidence: "low",
    deltaBp: 1905,
    reason: "19% above market; only 10 price snapshots.",
  }),
  fixture("D-buy", 3600, 4200, flat(10, 4200), {
    kind: "buy",
    confidence: "low",
    deltaBp: -1429,
    reason: "14% below market; only 10 price snapshots.",
  }),
  fixture("D0", 5000, 4200, flat(6, 4200), {
    kind: "insufficient_data",
    confidence: "low",
    deltaBp: 1905,
    reason: INSUFFICIENT_DATA_SENTENCE,
  }),
  fixture("E", 2000, null, flat(30, 2000), {
    kind: "insufficient_data",
    confidence: "low",
    deltaBp: null,
    reason: INSUFFICIENT_DATA_SENTENCE,
  }),
  fixture("F", 9000, 8150, flat(30, 8150), {
    kind: "wait",
    confidence: "high",
    deltaBp: 1043,
    reason: "10% above market.",
  }),
  fixture("G", 8000, 8150, flat(20, 8150), {
    kind: "fair",
    confidence: "medium",
    deltaBp: -184,
    reason: "Within 2% of market.",
  }),
];

/** One canonical fixture by name; throws on an unknown name. */
export function canonicalFixture(name: string): CanonicalFixture {
  const found = CANONICAL_FIXTURES.find((f) => f.name === name);
  if (!found) throw new Error(`no canonical fixture named ${name}`);
  return found;
}
