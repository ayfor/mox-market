// The MTGJson transform (S0.2d6, S0.2d8 to S0.2d10; AC-1 to AC-3): the
// identifier map with one preferred UUID per Scryfall id, then per AllPrices
// entry the window, integer cents and the gate. Pure: no I/O, no clock (the
// caller passes runDate), no database. S0.3's daily sync reuses it unchanged
// for AllPricesToday.
import {
  GATE_MAX_EDHREC_RANK,
  GATE_MIN_PRICE_CENTS,
  HISTORY_WINDOW_DAYS,
} from "./consts";
import type { PriceEntry, RawIdentifier, RetailFinish } from "./parse";

// --- dates (S0.2d6): UTC only, never local time ------------------------------

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A real calendar date written 'YYYY-MM-DD' (2026-02-30, 2026-9-05 and
 * 20261005 are not). Year 0000 is refused: JavaScript accepts it, Postgres
 * does not (S0.1d6).
 */
export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return false;
  if (value.startsWith("0000")) return false;
  const time = Date.parse(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === value
  );
}

/** The UTC calendar date of an instant, 'YYYY-MM-DD'. */
export function utcDateOf(instant: Date): string {
  return instant.toISOString().slice(0, 10);
}

/** A calendar date plus `days` (negative to go back), computed in UTC. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** runDate − 30 … runDate, ascending: the 31 dates F0 keeps (S0.2d6). */
export function windowDates(runDate: string): string[] {
  return Array.from({ length: HISTORY_WINDOW_DAYS + 1 }, (_, i) =>
    addDays(runDate, i - HISTORY_WINDOW_DAYS),
  );
}

// --- money (S0.2d8, AC-2) ----------------------------------------------------

/** Postgres int4's maximum: price_cents and edhrec_rank are int4. */
export const INT4_MAX = 2_147_483_647;

/** The largest storable price_cents. */
export const MAX_PRICE_CENTS = INT4_MAX;

/**
 * An MTGJson price (a JSON number of dollars) in integer cents, or null when
 * it is not usable: not a number (a string is invalid too), not finite, or
 * rounding to under 1 or over int4's maximum. F0's rule, verbatim:
 * Math.round(price * 100), with the skip applied after rounding (C2-A.13),
 * so 0.004 is skipped and 0.005 becomes 1.
 */
export function toCents(price: unknown): number | null {
  if (typeof price !== "number" || !Number.isFinite(price)) return null;
  const cents = Math.round(price * 100);
  if (!Number.isSafeInteger(cents)) return null;
  return cents >= 1 && cents <= MAX_PRICE_CENTS ? cents : null;
}

// --- identifiers (S0.2d10, AC-3) ---------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A lower-case UUID (the parsers lower-case keys and Scryfall ids). */
export const isUuid = (value: unknown): value is string =>
  typeof value === "string" && UUID.test(value);

/** An EDHREC rank F0 uses: a positive int4, else unranked (null). */
export function normalizeRank(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 1 &&
    value <= INT4_MAX
    ? value
    : null;
}

/** A face side: a non-empty string, else null. */
export function normalizeSide(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/** One mtgjson_identifiers row. */
export interface IdentifierRow {
  readonly mtgjsonUuid: string;
  readonly scryfallId: string;
  readonly side: string | null;
  readonly edhrecRank: number | null;
}

export interface IdentifierStats {
  /** Entries read from AllIdentifiers (objects only). */
  identifiersRead: number;
  /** No identifiers.scryfallId, a non-UUID one, or a non-UUID key. */
  invalidIdentifiers: number;
  /** A UUID key seen twice in AllIdentifiers: the first is kept. */
  duplicateIdentifierUuids: number;
}

export const emptyIdentifierStats = (): IdentifierStats => ({
  identifiersRead: 0,
  invalidIdentifiers: 0,
  duplicateIdentifierUuids: 0,
});

/** Lower sorts first: side null, then "a", "b", …, then the UUID. */
function prefers(a: IdentifierRow, b: IdentifierRow): boolean {
  const sa = a.side ?? "";
  const sb = b.side ?? "";
  if (sa !== sb) return sa < sb;
  return a.mtgjsonUuid < b.mtgjsonUuid;
}

/**
 * The identifier map: every valid AllIdentifiers entry (all are stored, not
 * only priced ones, because S0.3 maps AllPricesToday through the table), and
 * one preferred UUID per Scryfall id, chosen before any price row is emitted
 * (C2-A.6): side null, else `a`, else the lowest side, ties by the lowest
 * UUID.
 */
export class IdentifierIndex {
  readonly stats: IdentifierStats = emptyIdentifierStats();
  private readonly byUuid = new Map<string, IdentifierRow>();
  private readonly preferred = new Map<string, IdentifierRow>();

  add(raw: RawIdentifier): void {
    this.stats.identifiersRead += 1;
    if (!isUuid(raw.uuid) || !isUuid(raw.scryfallId)) {
      this.stats.invalidIdentifiers += 1;
      return;
    }
    if (this.byUuid.has(raw.uuid)) {
      this.stats.duplicateIdentifierUuids += 1;
      return;
    }
    const row: IdentifierRow = {
      mtgjsonUuid: raw.uuid,
      scryfallId: raw.scryfallId,
      side: normalizeSide(raw.side),
      edhrecRank: normalizeRank(raw.edhrecRank),
    };
    this.byUuid.set(row.mtgjsonUuid, row);
    const current = this.preferred.get(row.scryfallId);
    if (current === undefined || prefers(row, current)) {
      this.preferred.set(row.scryfallId, row);
    }
  }

  get(uuid: string): IdentifierRow | undefined {
    return this.byUuid.get(uuid);
  }

  /** True when this UUID is its Scryfall id's preferred one. */
  isPreferred(row: IdentifierRow): boolean {
    return this.preferred.get(row.scryfallId)?.mtgjsonUuid === row.mtgjsonUuid;
  }

  get size(): number {
    return this.byUuid.size;
  }

  get printings(): number {
    return this.preferred.size;
  }

  /** Every stored row, in insertion order. */
  rows(): IterableIterator<IdentifierRow> {
    return this.byUuid.values();
  }
}

// --- prices (S0.2d6, S0.2d9; AC-1) -------------------------------------------

/** One price_history row. */
export interface PriceRow {
  readonly scryfallId: string;
  readonly finish: RetailFinish;
  readonly date: string;
  readonly priceCents: number;
}

/** A series the gate kept, with its newest valid price (the basis sample's input). */
export interface KeptSeries {
  readonly scryfallId: string;
  readonly finish: RetailFinish;
  readonly newestDate: string;
  readonly newestCents: number;
}

export interface GateBreakdown {
  /** Kept on rank alone (price under the floor). */
  rankOnly: number;
  /** Kept on price alone (unranked or ranked over the cap). */
  priceOnly: number;
  /** Kept on both. */
  both: number;
  /** Dropped: neither rule holds. */
  dropped: number;
  /** Dropped: no valid price on or before runDate in the file. */
  noValidPrice: number;
  /**
   * Kept by the gate (and counted above) but with no valid price inside the
   * window, so no row is emitted and the series is not a basis candidate
   * (ADV.9): its newest price is older than runDate − 30.
   */
  keptNoWindowRows: number;
}

export interface PriceStats {
  /** AllPrices entries read (objects only). */
  priceEntries: number;
  /** Entries whose UUID is not in the identifier map. */
  unmappedUuids: number;
  /** Entries dropped because their UUID is not their Scryfall id's preferred one. */
  scryfallCollisions: number;
  /** Scryfall ids whose preferred UUID had no retail series while a dropped one did. */
  collisionLosses: number;
  /** A UUID key repeated in the file: dropped the second time. */
  duplicateUuids: number;
  /** A TCGplayer block whose currency is not USD: ignored. */
  nonUsdCurrency: number;
  /** In-window points with an unusable price (S0.2d8). */
  invalidPrices: number;
  /** Date keys that are not real YYYY-MM-DD dates. */
  invalidDates: number;
  /** Points dated before runDate − 30 (not emitted). */
  beforeWindow: number;
  /** Points dated after runDate (not emitted, not gated on). */
  afterRunDate: number;
  gate: GateBreakdown;
  /** Emitted rows by finish. */
  rowsByFinish: Record<RetailFinish, number>;
  /** Emitted rows by date (window dates only). */
  rowsByDate: Map<string, number>;
  /** Series (Scryfall id, finish) that emitted at least one row. */
  distinctSeries: number;
  /** Scryfall ids that emitted at least one row. */
  distinctPrintings: number;
}

export const emptyPriceStats = (): PriceStats => ({
  priceEntries: 0,
  unmappedUuids: 0,
  scryfallCollisions: 0,
  collisionLosses: 0,
  duplicateUuids: 0,
  nonUsdCurrency: 0,
  invalidPrices: 0,
  invalidDates: 0,
  beforeWindow: 0,
  afterRunDate: 0,
  gate: {
    rankOnly: 0,
    priceOnly: 0,
    both: 0,
    dropped: 0,
    noValidPrice: 0,
    keptNoWindowRows: 0,
  },
  rowsByFinish: { normal: 0, foil: 0, etched: 0 },
  rowsByDate: new Map(),
  distinctSeries: 0,
  distinctPrintings: 0,
});

/** Total rows emitted. */
export const rowsEmitted = (stats: PriceStats): number =>
  stats.rowsByFinish.normal +
  stats.rowsByFinish.foil +
  stats.rowsByFinish.etched;

/**
 * Turns AllPrices entries into price_history rows for one runDate. Call
 * `rowsFor` once per entry in file order, then `finish()` once.
 */
export class PriceTransform {
  readonly stats: PriceStats = emptyPriceStats();
  readonly runDate: string;
  readonly windowStart: string;
  private readonly seenUuids = new Set<string>();
  private readonly printingsWithRows = new Set<string>();
  private readonly preferredWithRetail = new Set<string>();
  private readonly droppedWithRetail = new Set<string>();

  constructor(
    private readonly identifiers: IdentifierIndex,
    runDate: string,
    private readonly onKeptSeries?: (series: KeptSeries) => void,
  ) {
    if (!isCalendarDate(runDate)) throw new TypeError("runDate must be a date");
    this.runDate = runDate;
    this.windowStart = addDays(runDate, -HISTORY_WINDOW_DAYS);
  }

  /** The rows one entry emits (none when it is unmapped, dropped or gated out). */
  rowsFor(entry: PriceEntry): PriceRow[] {
    const stats = this.stats;
    stats.priceEntries += 1;
    if (this.seenUuids.has(entry.uuid)) {
      stats.duplicateUuids += 1;
      return [];
    }
    this.seenUuids.add(entry.uuid);
    if (entry.nonUsdCurrency) stats.nonUsdCurrency += 1;

    const identifier = this.identifiers.get(entry.uuid);
    if (identifier === undefined) {
      stats.unmappedUuids += 1;
      return [];
    }
    const hasRetail = entry.series.length > 0;
    if (!this.identifiers.isPreferred(identifier)) {
      stats.scryfallCollisions += 1;
      if (hasRetail) this.droppedWithRetail.add(identifier.scryfallId);
      return [];
    }
    if (hasRetail) this.preferredWithRetail.add(identifier.scryfallId);

    const rows: PriceRow[] = [];
    for (const series of entry.series) {
      const inWindow: { date: string; cents: number }[] = [];
      let newest: { date: string; cents: number } | null = null;
      for (const [date, price] of Object.entries(series.prices)) {
        if (!isCalendarDate(date)) {
          stats.invalidDates += 1;
          continue;
        }
        if (date > this.runDate) {
          stats.afterRunDate += 1;
          continue;
        }
        const cents = toCents(price);
        if (date < this.windowStart) {
          stats.beforeWindow += 1;
        } else if (cents === null) {
          stats.invalidPrices += 1;
        } else {
          inWindow.push({ date, cents });
        }
        if (cents !== null && (newest === null || date > newest.date)) {
          newest = { date, cents };
        }
      }
      if (newest === null) {
        stats.gate.noValidPrice += 1;
        continue;
      }
      const rankOk =
        identifier.edhrecRank !== null &&
        identifier.edhrecRank <= GATE_MAX_EDHREC_RANK;
      const priceOk = newest.cents >= GATE_MIN_PRICE_CENTS;
      if (!rankOk && !priceOk) {
        stats.gate.dropped += 1;
        continue;
      }
      if (rankOk && priceOk) stats.gate.both += 1;
      else if (rankOk) stats.gate.rankOnly += 1;
      else stats.gate.priceOnly += 1;
      if (inWindow.length === 0) {
        stats.gate.keptNoWindowRows += 1;
        continue;
      }
      // Only a series that stores rows is a basis candidate, so a months-old
      // MTGJson price is never compared with today's Scryfall price (ADV.9).
      this.onKeptSeries?.({
        scryfallId: identifier.scryfallId,
        finish: series.finish,
        newestDate: newest.date,
        newestCents: newest.cents,
      });
      inWindow.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
      stats.distinctSeries += 1;
      this.printingsWithRows.add(identifier.scryfallId);
      for (const { date, cents } of inWindow) {
        rows.push({
          scryfallId: identifier.scryfallId,
          finish: series.finish,
          date,
          priceCents: cents,
        });
        stats.rowsByFinish[series.finish] += 1;
        stats.rowsByDate.set(date, (stats.rowsByDate.get(date) ?? 0) + 1);
      }
    }
    stats.distinctPrintings = this.printingsWithRows.size;
    return rows;
  }

  /** Final counts that need the whole file (collisionLosses). */
  finish(): PriceStats {
    let losses = 0;
    for (const id of this.droppedWithRetail) {
      if (!this.preferredWithRetail.has(id)) losses += 1;
    }
    this.stats.collisionLosses = losses;
    this.stats.distinctPrintings = this.printingsWithRows.size;
    return this.stats;
  }
}
