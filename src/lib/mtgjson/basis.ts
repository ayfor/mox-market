// F0 Open Question 3, the price basis (S0.2d20; AC-12 c). F1 measures the
// asking-price delta against Scryfall's prices.usd / usd_foil (F2's
// currentPriceCents), while range, median and trend come from MTGJson's
// TCGplayer retail series. `--basis-sample N` (dry-run only) compares the
// two for N kept series and reports the median gap; over 2% becomes an open
// ruling for Josh, and no pricing code changes here.
//
// The sample is a seeded reservoir of 4×N kept normal/foil series (etched is
// hidden in Phase 1, C1.08 = A), walked in order until N have a Scryfall
// price. Requests go through src/lib/scryfall.ts, whose throttle keeps them
// at least 100 ms apart and which sends the app's User-Agent and
// `Accept: application/json` (Scryfall's guidance).
import { priceCentsFor } from "../printings";
import { getCardById, ScryfallApiError } from "../scryfall";
import type { KeptSeries } from "./transform";

/** A median absolute gap over this many basis points (2%) is flagged. */
export const BASIS_FLAG_BP = 200;

/** The reservoir holds this many candidates per requested pair. */
export const BASIS_RESERVOIR_FACTOR = 4;

/** mulberry32: a small seeded PRNG, uniform on [0, 1). */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The default seed: the source date's digits (2026-10-10 → 20261010). */
export function seedFromDate(date: string | null): number {
  const digits = (date ?? "").replace(/\D/g, "");
  return digits === "" ? 1 : Number(digits.slice(0, 9));
}

/**
 * Algorithm R over kept normal and foil series in file order: every series
 * has the same chance to be held, and the same seed and file give the same
 * sample.
 */
export class BasisReservoir {
  private readonly held: KeptSeries[] = [];
  private seen = 0;
  private readonly random: () => number;

  constructor(
    readonly capacity: number,
    readonly seed: number,
  ) {
    this.random = seededRandom(seed);
  }

  offer(series: KeptSeries): void {
    if (series.finish === "etched") return;
    this.seen += 1;
    if (this.held.length < this.capacity) {
      this.held.push(series);
      return;
    }
    const slot = Math.floor(this.random() * this.seen);
    if (slot < this.capacity) this.held[slot] = series;
  }

  /** How many eligible series were offered. */
  get offered(): number {
    return this.seen;
  }

  candidates(): readonly KeptSeries[] {
    return this.held;
  }
}

export interface BasisPair {
  readonly scryfallId: string;
  readonly finish: "normal" | "foil";
  readonly mtgjsonCents: number;
  readonly mtgjsonDate: string;
  readonly scryfallCents: number;
  readonly scryfallDate: string;
  /** (MTGJson − Scryfall) ÷ Scryfall, in basis points. */
  readonly gapBp: number;
}

export interface BasisResult {
  readonly requested: number;
  readonly seed: number;
  readonly eligibleSeries: number;
  readonly pairs: readonly BasisPair[];
  readonly skippedNotFound: number;
  readonly skippedNoPrice: number;
  readonly skippedErrors: number;
  /**
   * Set when Scryfall answered 429 (rate limited): the walk stops at once,
   * per Scryfall's guidance to back off, and the sample is incomplete.
   */
  readonly stoppedOnRateLimit: boolean;
  readonly medianAbsGapBp: number | null;
  readonly medianSignedGapBp: number | null;
  /** True when the median absolute gap exceeds 2% (an open ruling for Josh). */
  readonly flagged: boolean;
  /** True when fewer pairs than requested were found: no verdict (ADV.9). */
  readonly incomplete: boolean;
}

/** The median of a list (the mean of the middle two for an even count). */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** (MTGJson − Scryfall) ÷ Scryfall in basis points. */
export const gapBp = (mtgjsonCents: number, scryfallCents: number): number =>
  ((mtgjsonCents - scryfallCents) * 10_000) / scryfallCents;

export interface BasisDeps {
  /** Scryfall's card by id, null on 404 (default: src/lib/scryfall.ts). */
  readonly fetchCard?: typeof getCardById;
  /** The UTC date of the Scryfall request, for the report. */
  readonly today: string;
  readonly log?: (line: string) => void;
}

/** Walks the reservoir until `size` series have a Scryfall price. */
export async function runBasisSample(
  reservoir: BasisReservoir,
  size: number,
  { fetchCard = getCardById, today, log }: BasisDeps,
): Promise<BasisResult> {
  const pairs: BasisPair[] = [];
  let skippedNotFound = 0;
  let skippedNoPrice = 0;
  let skippedErrors = 0;
  let stoppedOnRateLimit = false;
  for (const series of reservoir.candidates()) {
    if (pairs.length >= size) break;
    if (series.finish === "etched") continue;
    let card: Awaited<ReturnType<typeof getCardById>>;
    try {
      card = await fetchCard(series.scryfallId);
    } catch (error) {
      if (error instanceof ScryfallApiError && error.status === 429) {
        stoppedOnRateLimit = true;
        log?.("  basis: Scryfall answered 429 (rate limited); the walk stops");
        break;
      }
      skippedErrors += 1;
      log?.(
        `  basis: Scryfall request failed (${error instanceof Error ? error.name : "error"}), skipped`,
      );
      continue;
    }
    if (card === null) {
      skippedNotFound += 1;
      continue;
    }
    const scryfallCents = priceCentsFor(card, series.finish);
    if (scryfallCents === null) {
      skippedNoPrice += 1;
      continue;
    }
    pairs.push({
      scryfallId: series.scryfallId,
      finish: series.finish,
      mtgjsonCents: series.newestCents,
      mtgjsonDate: series.newestDate,
      scryfallCents,
      scryfallDate: today,
      gapBp: gapBp(series.newestCents, scryfallCents),
    });
  }
  const medianAbs = median(pairs.map((p) => Math.abs(p.gapBp)));
  return {
    requested: size,
    seed: reservoir.seed,
    eligibleSeries: reservoir.offered,
    pairs,
    skippedNotFound,
    skippedNoPrice,
    skippedErrors,
    stoppedOnRateLimit,
    medianAbsGapBp: medianAbs,
    medianSignedGapBp: median(pairs.map((p) => p.gapBp)),
    flagged: medianAbs !== null && medianAbs > BASIS_FLAG_BP,
    incomplete: pairs.length < size,
  };
}
