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

// --- S3.1: Tier-2 fixtures (F3 W1, W2; plan Test Manifest T1 to T10) --------

/** What a fixture asserts about one tier. */
export interface TierExpectation {
  readonly kind: RecommendationKind;
  readonly confidence: Confidence;
  readonly reason: string;
}

/** Tier 2 also pins the adjusted band and thresholds (signals, in percent). */
export interface Tier2Expectation extends TierExpectation {
  readonly buyThresholdPct: number;
  readonly waitThresholdPct: number;
  readonly bandPct: number;
  readonly wideningFactor: number;
}

export interface Tier2Fixture {
  readonly name: string;
  readonly input: RecommendationInput;
  readonly market: MarketSnapshot;
  readonly expected: {
    readonly tier1: TierExpectation;
    /** Null only when tier1 is insufficient_data (F3 Engine API). */
    readonly tier2: Tier2Expectation | null;
  };
}

/** A canonical fixture reused as is: its input, market and Tier-1 result. */
function fromCanonical(
  name: string,
  tier2: Tier2Expectation | null,
): Tier2Fixture {
  const f = canonicalFixture(name);
  const { kind, confidence, reason } = f.expected;
  return {
    name,
    input: f.input,
    market: f.market,
    expected: { tier1: { kind, confidence, reason }, tier2 },
  };
}

function tier2Fixture(
  name: string,
  asking: number,
  market: number,
  values: readonly number[],
  tier1: TierExpectation,
  tier2: Tier2Expectation | null,
): Tier2Fixture {
  return {
    name,
    input: fixtureInput(asking),
    market: fixtureMarket(market, values),
    expected: { tier1, tier2 },
  };
}

/** Example C's re-pinned history: −0.6 %/day, falling 18% over 30 days. */
const C_HISTORY = ramp(30, 8696, -48);
/** A-rising's history: +0.6 %/day, rising 18% over 30 days. */
const A_RISING_HISTORY = ramp(30, 7304, 48);

/** Tier-2 band and thresholds at full history, shifted by a clamped +5 (rising). */
const RISING_FULL = {
  buyThresholdPct: -3.33,
  waitThresholdPct: 10,
  bandPct: 5,
  wideningFactor: 1,
} as const;
/** The same, shifted by a clamped −5 (falling). */
const FALLING_FULL = {
  buyThresholdPct: -13.33,
  waitThresholdPct: 0,
  bandPct: 5,
  wideningFactor: 1,
} as const;
/** No shift at full history: Tier 1's thresholds. */
const UNSHIFTED_FULL = {
  buyThresholdPct: -8.33,
  waitThresholdPct: 5,
  bandPct: 5,
  wideningFactor: 1,
} as const;
/** Low confidence, no shift: the band widened 1.5×. */
const UNSHIFTED_LOW = {
  buyThresholdPct: -12.5,
  waitThresholdPct: 7.5,
  bandPct: 7.5,
  wideningFactor: 1.5,
} as const;

/**
 * S3.1's Tier-2 fixtures (plan T1 to T10), each with its exact Tier-1 and
 * Tier-2 kind, confidence and reason, and Tier 2's band and thresholds. The
 * canonical entries are reused from CANONICAL_FIXTURES, never copied. A param
 * change that flips one updates it here, in the same PR (F1 W2); S3.2's
 * volatility widening changes M's thresholds (CV 0.173).
 */
export const TIER2_FIXTURES: readonly Tier2Fixture[] = [
  // T1, AC-1: C. The −9 shift clamps to −5.
  fromCanonical("C", {
    kind: "fair",
    confidence: "high",
    reason: "9% below market; 30-day trend is falling 18%.",
    ...FALLING_FULL,
  }),
  // T2, AC-2: A-rising. The +9 shift clamps to +5.
  fromCanonical("A-rising", {
    kind: "buy",
    confidence: "high",
    reason: "5% below market; 30-day trend is rising 18%.",
    ...RISING_FULL,
  }),
  // T3, AC-3(a): no Tier 2 without a verdict.
  fromCanonical("D0", null),
  fromCanonical("E", null),
  // T4, AC-3(b): thin data inside the dead zone.
  fromCanonical("D", {
    kind: "wait",
    confidence: "low",
    reason: "19% above market; only 10 price snapshots.",
    ...UNSHIFTED_LOW,
  }),
  fromCanonical("D-buy", {
    kind: "buy",
    confidence: "low",
    reason: "14% below market; only 10 price snapshots.",
    ...UNSHIFTED_LOW,
  }),
  tier2Fixture(
    "Z10",
    8000,
    8000,
    ramp(10, 7820, 40),
    {
      kind: "fair",
      confidence: "low",
      reason: "At market price; only 10 price snapshots.",
    },
    {
      kind: "fair",
      confidence: "low",
      reason: "At market price; only 10 price snapshots.",
      ...UNSHIFTED_LOW,
    },
  ),
  ...[7, 13].map((n) =>
    tier2Fixture(
      `D-${n}`,
      5000,
      4200,
      flat(n, 4200),
      {
        kind: "wait",
        confidence: "low",
        reason: `19% above market; only ${n} price snapshots.`,
      },
      {
        kind: "wait",
        confidence: "low",
        reason: `19% above market; only ${n} price snapshots.`,
        ...UNSHIFTED_LOW,
      },
    ),
  ),
  tier2Fixture(
    "D-14",
    5000,
    4200,
    flat(14, 4200),
    { kind: "wait", confidence: "medium", reason: "19% above market." },
    {
      kind: "wait",
      confidence: "medium",
      reason: "19% above market.",
      ...UNSHIFTED_FULL,
    },
  ),
  // T5: widening flips the verdict; equality at a widened threshold is Fair.
  ...(
    [
      [4500, "wait", "7% above market", "fair", "Within 7% of market"],
      [4515, "wait", "8% above market", "fair", "Within 8% of market"],
      [4516, "wait", "8% above market", "wait", "8% above market"],
      [3675, "buy", "13% below market", "fair", "13% below market"],
      [3674, "buy", "13% below market", "buy", "13% below market"],
    ] as const
  ).map(([asking, kind1, clause1, kind2, clause2]) =>
    tier2Fixture(
      `D-wide-${asking}`,
      asking,
      4200,
      flat(10, 4200),
      {
        kind: kind1,
        confidence: "low",
        reason: `${clause1}; only 10 price snapshots.`,
      },
      {
        kind: kind2,
        confidence: "low",
        reason: `${clause2}; only 10 price snapshots.`,
        ...UNSHIFTED_LOW,
      },
    ),
  ),
  // T6: thin data with a trend: widen, then the asymmetry, then the clamped shift.
  ...(
    [
      [7600, "Within 5% of market", "fair", "Within 5% of market"],
      [7599, "5% below market", "buy", "5% below market"],
    ] as const
  ).map(([asking, clause1, kind2, clause2]) =>
    tier2Fixture(
      `D-rising-${asking}`,
      asking,
      8000,
      ramp(10, 7784, 48),
      {
        kind: "fair",
        confidence: "low",
        reason: `${clause1}; only 10 price snapshots.`,
      },
      {
        kind: kind2,
        confidence: "low",
        reason: `${clause2}; 30-day trend is rising 18%; only 10 price snapshots.`,
        buyThresholdPct: -5,
        waitThresholdPct: 15,
        bandPct: 7.5,
        wideningFactor: 1.5,
      },
    ),
  ),
  tier2Fixture(
    "C7",
    7400,
    8150,
    ramp(7, 8144, -48),
    {
      kind: "buy",
      confidence: "low",
      reason: "9% below market; only 7 price snapshots.",
    },
    {
      kind: "fair",
      confidence: "low",
      reason:
        "9% below market; 30-day trend is falling 18%; only 7 price snapshots.",
      buyThresholdPct: -20,
      waitThresholdPct: 0,
      bandPct: 7.5,
      wideningFactor: 1.5,
    },
  ),
  // T7, AC-6: the strict rule holds after the shift (−1333 bp is Fair).
  ...(
    [
      [26000, "fair"],
      [25999, "buy"],
    ] as const
  ).map(([asking, kind2]) =>
    tier2Fixture(
      `C-30000-${asking}`,
      asking,
      30000,
      C_HISTORY,
      { kind: "buy", confidence: "high", reason: "13% below market." },
      {
        kind: kind2,
        confidence: "high",
        reason: "13% below market; 30-day trend is falling 18%.",
        ...FALLING_FULL,
      },
    ),
  ),
  // T8, AC-6: the monster trend clamps; the reason cites the raw slope.
  tier2Fixture(
    "M",
    7600,
    8000,
    ramp(30, 5680, 160),
    { kind: "fair", confidence: "high", reason: "Within 5% of market." },
    {
      kind: "buy",
      confidence: "high",
      reason: "5% below market; 30-day trend is rising 60%.",
      ...RISING_FULL,
    },
  ),
  // T9: the dead-zone edge at full history (±0.5 %/day is flat).
  ...(
    [
      ["Z30", ramp(30, 7420, 40)],
      ["Z30-falling", ramp(30, 8580, -40)],
    ] as const
  ).map(([name, values]) =>
    tier2Fixture(
      name,
      8000,
      8000,
      values,
      { kind: "fair", confidence: "high", reason: "At market price." },
      {
        kind: "fair",
        confidence: "high",
        reason: "At market price.",
        ...UNSHIFTED_FULL,
      },
    ),
  ),
  tier2Fixture(
    "R41",
    8000,
    8000,
    ramp(30, 7406, 41),
    { kind: "fair", confidence: "high", reason: "At market price." },
    {
      kind: "fair",
      confidence: "high",
      reason: "At market price; 30-day trend is rising 15%.",
      ...RISING_FULL,
    },
  ),
  // T10: the fair frames Tier 2 makes reachable.
  tier2Fixture(
    "A-rising-8560",
    8560,
    8000,
    A_RISING_HISTORY,
    { kind: "wait", confidence: "high", reason: "7% above market." },
    {
      kind: "fair",
      confidence: "high",
      reason: "7% above market; 30-day trend is rising 18%.",
      ...RISING_FULL,
    },
  ),
  ...(
    [
      [8150, "fair", "At market price"],
      [8151, "wait", "0% above market"],
    ] as const
  ).map(([asking, kind2, clause2]) =>
    tier2Fixture(
      `C-${asking}`,
      asking,
      8150,
      C_HISTORY,
      { kind: "fair", confidence: "high", reason: "At market price." },
      {
        kind: kind2,
        confidence: "high",
        reason: `${clause2}; 30-day trend is falling 18%.`,
        ...FALLING_FULL,
      },
    ),
  ),
];

// --- S3.1 adversarial review: unhappy market data (ADV SPEC-2, TC-2, TC-3,
// UB-1) ---------------------------------------------------------------------

/** A Tier-2 fixture with its own input and market (any finish or history). */
function dataEdgeFixture(
  name: string,
  input: RecommendationInput,
  market: MarketSnapshot,
  tier1: TierExpectation,
  tier2: Tier2Expectation | null,
): Tier2Fixture {
  return { name, input, market, expected: { tier1, tier2 } };
}

/** The window's 30 indexes, oldest first, with the rows kept by keep(i). */
function sparseHistory(
  values: readonly number[],
  keep: (index: number) => boolean,
): PriceSnapshot[] {
  return dailyHistory(FIXTURE_AS_OF, values).filter((_, i) => keep(i));
}

/** 14 real rows at window indexes 0..7 and 24..29, falling; gaps between. */
const GAPPED_FALLING_VALUES = Array.from({ length: 30 }, (_, i) =>
  i <= 7 ? 9000 - 20 * i : 7000 - 60 * (i - 24),
);

/** C's history behind superseded duplicates and rows outside the window. */
function cWithNoise(): PriceSnapshot[] {
  return [
    // 40 dates ending asOf − 1: the oldest 10 sit before the window, the
    // rest are superseded by the later entries for the same dates.
    ...dailyHistory(FIXTURE_AS_OF, flat(40, 100)),
    ...dailyHistory(FIXTURE_AS_OF, flat(30, 99999)),
    ...dailyHistory(FIXTURE_AS_OF, C_HISTORY),
    // asOf itself is outside the window (it ends at asOf − 1).
    { date: FIXTURE_AS_OF, priceCents: 1 },
  ];
}

/** Low confidence, the −7.5 shift at the widened band: −20 / 0. */
const FALLING_LOW = {
  buyThresholdPct: -20,
  waitThresholdPct: 0,
  bandPct: 7.5,
  wideningFactor: 1.5,
} as const;

/**
 * Unhappy market data through both tiers (S3.1 adversarial review): the
 * finish fallback and an unusable applied finish (SPEC-2, TC-3), a gapped
 * and a sparse history whose slope is interpolated (TC-2, F1 W1), duplicate
 * and out-of-window rows, and crashes whose monthly trend passes −100%
 * (UB-1, S3.1d16). The S1.2 results of these cases are recorded in
 * __snapshots__/tiered-parity.s1.2-data-edges.json from the engine at
 * 97b4bba. S3.2's volatility widening changes the crash and surge
 * thresholds (their CV is far above 0.15); S3.2 updates them (F1 W2).
 */
export const TIER2_DATA_EDGE_FIXTURES: readonly Tier2Fixture[] = [
  dataEdgeFixture(
    "fallback-foil-A",
    fixtureInput(7400, "foil"),
    fixtureMarket(8150, flat(30, 8150)),
    { kind: "buy", confidence: "high", reason: "9% below market." },
    {
      kind: "buy",
      confidence: "high",
      reason: "9% below market.",
      ...UNSHIFTED_FULL,
    },
  ),
  dataEdgeFixture(
    "fallback-foil-C",
    fixtureInput(7400, "foil"),
    fixtureMarket(8150, C_HISTORY),
    { kind: "buy", confidence: "high", reason: "9% below market." },
    {
      kind: "fair",
      confidence: "high",
      reason: "9% below market; 30-day trend is falling 18%.",
      ...FALLING_FULL,
    },
  ),
  dataEdgeFixture(
    "fallback-etched-A-rising",
    fixtureInput(7600, "etched"),
    fixtureMarket(8000, A_RISING_HISTORY),
    { kind: "fair", confidence: "high", reason: "Within 5% of market." },
    {
      kind: "buy",
      confidence: "high",
      reason: "5% below market; 30-day trend is rising 18%.",
      ...RISING_FULL,
    },
  ),
  dataEdgeFixture(
    "fallback-foil-D",
    fixtureInput(5000, "foil"),
    fixtureMarket(4200, flat(10, 4200)),
    {
      kind: "wait",
      confidence: "low",
      reason: "19% above market; only 10 price snapshots.",
    },
    {
      kind: "wait",
      confidence: "low",
      reason: "19% above market; only 10 price snapshots.",
      ...UNSHIFTED_LOW,
    },
  ),
  dataEdgeFixture(
    "applied-foil-C",
    fixtureInput(7400, "foil"),
    fixtureMarket(8150, C_HISTORY, { appliedFinish: "foil" }),
    { kind: "buy", confidence: "high", reason: "9% below market." },
    {
      kind: "fair",
      confidence: "high",
      reason: "9% below market; 30-day trend is falling 18%.",
      ...FALLING_FULL,
    },
  ),
  dataEdgeFixture(
    "unusable-etched-for-foil",
    fixtureInput(7400, "foil"),
    fixtureMarket(8150, C_HISTORY, { appliedFinish: "etched" }),
    {
      kind: "insufficient_data",
      confidence: "low",
      reason: INSUFFICIENT_DATA_SENTENCE,
    },
    null,
  ),
  dataEdgeFixture(
    "gap-falling-14",
    fixtureInput(6500),
    {
      ...fixtureMarket(7000, []),
      history: sparseHistory(GAPPED_FALLING_VALUES, (i) => i <= 7 || i >= 24),
    },
    { kind: "fair", confidence: "medium", reason: "7% below market." },
    {
      kind: "fair",
      confidence: "medium",
      reason: "7% below market; 30-day trend is falling 34%.",
      ...FALLING_FULL,
    },
  ),
  dataEdgeFixture(
    "gap-C-sparse-20",
    fixtureInput(7400),
    {
      ...fixtureMarket(8150, []),
      history: sparseHistory(C_HISTORY, (i) => i % 3 !== 1),
    },
    { kind: "buy", confidence: "medium", reason: "9% below market." },
    {
      kind: "fair",
      confidence: "medium",
      reason: "9% below market; 30-day trend is falling 18%.",
      ...FALLING_FULL,
    },
  ),
  dataEdgeFixture(
    "window-C-duplicates-outside",
    fixtureInput(7400),
    { ...fixtureMarket(8150, []), history: cWithNoise() },
    { kind: "buy", confidence: "high", reason: "9% below market." },
    {
      kind: "fair",
      confidence: "high",
      reason: "9% below market; 30-day trend is falling 18%.",
      ...FALLING_FULL,
    },
  ),
  dataEdgeFixture(
    "crash-ramp-30",
    fixtureInput(450),
    fixtureMarket(500, ramp(30, 5000, -155)),
    { kind: "buy", confidence: "high", reason: "10% below market." },
    {
      kind: "fair",
      confidence: "high",
      reason: "10% below market; 30-day trend is falling 99%.",
      ...FALLING_FULL,
    },
  ),
  dataEdgeFixture(
    "crash-step-30",
    fixtureInput(450),
    fixtureMarket(500, [...flat(20, 5000), ...flat(10, 500)]),
    { kind: "buy", confidence: "high", reason: "10% below market." },
    {
      kind: "fair",
      confidence: "high",
      reason: "10% below market; 30-day trend is falling 99%.",
      ...FALLING_FULL,
    },
  ),
  dataEdgeFixture(
    "crash-ramp-7",
    fixtureInput(450),
    fixtureMarket(500, ramp(7, 5000, -750)),
    {
      kind: "buy",
      confidence: "low",
      reason: "10% below market; only 7 price snapshots.",
    },
    {
      kind: "fair",
      confidence: "low",
      reason:
        "10% below market; 30-day trend is falling 99%; only 7 price snapshots.",
      ...FALLING_LOW,
    },
  ),
  dataEdgeFixture(
    "surge-ramp-30",
    fixtureInput(4800),
    fixtureMarket(5000, ramp(30, 500, 155)),
    { kind: "fair", confidence: "high", reason: "Within 4% of market." },
    {
      kind: "buy",
      confidence: "high",
      reason: "4% below market; 30-day trend is rising 169%.",
      ...RISING_FULL,
    },
  ),
];

/** One Tier-2 fixture by name; throws on an unknown name. */
export function tier2FixtureNamed(name: string): Tier2Fixture {
  const found = TIER2_FIXTURES.find((f) => f.name === name);
  if (!found) throw new Error(`no Tier-2 fixture named ${name}`);
  return found;
}
