// F2 §Default printing (S2.1d7; C1.26, C1.46 = A): which printing the result
// page evaluates when the user names only a card. Pure: no fetch, no clock.
import type { ShownFinish } from "@/lib/recommendation/ui-copy";
import { isScryfallId } from "@/lib/scryfall-id";
import type { ScryfallCard } from "@/types/scryfall";

/** Set types never picked by default (C1.46 = A adds box). */
const EXCLUDED_SET_TYPES: ReadonlySet<string> = new Set([
  "promo",
  "memorabilia",
  "token",
  "minigame",
  "box",
]);

/** Scryfall's finish name for each shown finish: normal → nonfoil. */
const SCRYFALL_FINISH = {
  normal: "nonfoil",
  foil: "foil",
} as const satisfies Record<ShownFinish, ScryfallCard["finishes"][number]>;

/** Scryfall's price field for each shown finish. */
const PRICE_FIELD = {
  normal: "usd",
  foil: "usd_foil",
} as const satisfies Record<ShownFinish, keyof ScryfallCard["prices"]>;

/**
 * A Scryfall price string in integer cents, converted once: a finite positive
 * number of dollars, rounded to the cent. null, "", text, zero, negatives and
 * exponent forms ("1e3") are null. The one float-to-cents boundary.
 */
export function scryfallPriceCents(
  price: string | null | undefined,
): number | null {
  if (typeof price !== "string" || !/^\d+(\.\d+)?$/.test(price.trim())) {
    return null;
  }
  const cents = Math.round(Number(price) * 100);
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
}

/** The printing's price in cents for a shown finish, or null. */
export function priceCentsFor(
  printing: Pick<ScryfallCard, "prices">,
  finish: ShownFinish,
): number | null {
  return scryfallPriceCents(printing.prices?.[PRICE_FIELD[finish]]);
}

/** F2's candidate predicate, verbatim; the price is the finish's usable price. */
function candidatePrice(
  printing: ScryfallCard,
  finish: ShownFinish,
): number | null {
  if (printing.promo !== false) return null;
  if (EXCLUDED_SET_TYPES.has(printing.set_type)) return null;
  if (printing.digital !== false) return null;
  if (
    !Array.isArray(printing.finishes) ||
    !printing.finishes.includes(SCRYFALL_FINISH[finish])
  ) {
    return null;
  }
  return priceCentsFor(printing, finish);
}

/**
 * The default printing for a finish: among F2's candidates, the lowest price
 * in cents, then the earliest released_at, then the lowest id, so the
 * server's order never matters. null when nothing qualifies; the caller then
 * uses the named-lookup card with the C1.21 fallback.
 */
export function selectDefaultPrinting(
  printings: readonly ScryfallCard[],
  finish: ShownFinish,
): ScryfallCard | null {
  let best: { printing: ScryfallCard; cents: number } | null = null;
  for (const printing of printings) {
    const cents = candidatePrice(printing, finish);
    if (cents === null) continue;
    if (best === null || isBefore(printing, cents, best.printing, best.cents)) {
      best = { printing, cents };
    }
  }
  return best?.printing ?? null;
}

/** Lower price, then earlier released_at ('YYYY-MM-DD' sorts as text), then lower id. */
function isBefore(
  a: ScryfallCard,
  aCents: number,
  b: ScryfallCard,
  bCents: number,
): boolean {
  if (aCents !== bCents) return aCents < bCents;
  if (a.released_at !== b.released_at) return a.released_at < b.released_at;
  return a.id < b.id;
}

/**
 * The finishes a printing offers from the shown ones (S2.3d3; C1.08 = A):
 * normal when Scryfall lists nonfoil, then foil when it lists foil, in that
 * order. Etched is never offered, and a missing or malformed `finishes` (not
 * an array, non-string entries) offers nothing.
 */
export function offeredFinishes(
  printing: Pick<ScryfallCard, "finishes">,
): ShownFinish[] {
  const finishes: unknown = printing.finishes;
  if (!Array.isArray(finishes)) return [];
  const offered: ShownFinish[] = [];
  if (finishes.includes(SCRYFALL_FINISH.normal)) offered.push("normal");
  if (finishes.includes(SCRYFALL_FINISH.foil)) offered.push("foil");
  return offered;
}

/**
 * The printing with a price only for the finishes it offers (S2.3 ADV-3,
 * AC-9): a `usd` or `usd_foil` Scryfall lists for a finish missing from
 * `finishes` is dropped, so the C1.21 fallback follows the finishes list
 * that FinishSelect shows. Foil requested on a printing that offers only
 * normal is priced and read as normal; normal requested on a foil-only
 * printing has no price (insufficient_data). Never mutates its input.
 */
export function withOfferedPrices<
  T extends Pick<ScryfallCard, "prices" | "finishes">,
>(printing: T): T {
  const offered = offeredFinishes(printing);
  const prices: Partial<ScryfallCard["prices"]> =
    printing.prices !== null && typeof printing.prices === "object"
      ? printing.prices
      : {};
  return {
    ...printing,
    prices: {
      ...prices,
      [PRICE_FIELD.normal]: offered.includes("normal")
        ? (prices[PRICE_FIELD.normal] ?? null)
        : null,
      [PRICE_FIELD.foil]: offered.includes("foil")
        ? (prices[PRICE_FIELD.foil] ?? null)
        : null,
    },
  };
}

/**
 * The fields an option needs, so choosing it evaluates that printing (S2.3
 * ADV-5): a lower-case Scryfall id, which survives the `printing` URL param
 * unchanged, a name (the card header), and the label and sort fields as
 * strings.
 */
function isOfferable(printing: ScryfallCard): boolean {
  return (
    isScryfallId(printing.id) &&
    typeof printing.name === "string" &&
    typeof printing.set === "string" &&
    typeof printing.set_name === "string" &&
    typeof printing.collector_number === "string" &&
    typeof printing.released_at === "string"
  );
}

/** A collector number's leading digits, without leading zeros, and the rest. */
function collectorParts(collectorNumber: string): {
  digits: string | null;
  rest: string;
} {
  const match = /^(\d+)([\s\S]*)$/.exec(collectorNumber);
  if (match === null) return { digits: null, rest: collectorNumber };
  return { digits: match[1].replace(/^0+(?=\d)/, ""), rest: match[2] };
}

/** -1, 0 or 1 by UTF-16 code unit, never by locale. */
function compareCodeUnits(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/**
 * Collector numbers in numeric-aware order without ICU (S2.3d3): leading
 * digits compare as integers ("9" < "10", "4" < "12" < "12s" < "328"), then
 * the rest by code unit ("12" < "12s" < "12★"); a number with leading digits
 * sorts before one without; the full text breaks any remaining tie.
 */
export function compareCollectorNumbers(a: string, b: string): number {
  const pa = collectorParts(a);
  const pb = collectorParts(b);
  if (pa.digits !== null && pb.digits !== null) {
    if (pa.digits.length !== pb.digits.length) {
      return pa.digits.length < pb.digits.length ? -1 : 1;
    }
    const byNumber = compareCodeUnits(pa.digits, pb.digits);
    if (byNumber !== 0) return byNumber;
    const byRest = compareCodeUnits(pa.rest, pb.rest);
    if (byRest !== 0) return byRest;
  } else if (pa.digits !== null || pb.digits !== null) {
    return pa.digits !== null ? -1 : 1;
  }
  return compareCodeUnits(a, b);
}

/** Newest released_at first, then collector number, then id. */
function compareOptions(a: ScryfallCard, b: ScryfallCard): number {
  if (a.released_at !== b.released_at) {
    return a.released_at > b.released_at ? -1 : 1;
  }
  return (
    compareCollectorNumbers(a.collector_number, b.collector_number) ||
    compareCodeUnits(a.id, b.id)
  );
}

/**
 * The printings PrintingSelect offers (S2.3d3; AC-1, AC-2, AC-4): every
 * paper printing (`digital === false`) that offers normal or foil and carries
 * the fields its option shows and its evaluation needs (a lower-case
 * Scryfall id and a name, ADV-5), the first of any repeated id, newest
 * released_at first, then collector number, then id, so Scryfall's order
 * never matters. Promo, box, memorabilia, token and minigame printings stay:
 * C1.26 and C1.46's exclusions shape only the default. Never mutates its
 * input.
 */
export function selectablePrintings(
  printings: readonly ScryfallCard[],
): ScryfallCard[] {
  const seen = new Set<string>();
  const selectable: ScryfallCard[] = [];
  for (const printing of printings) {
    if (printing === null || typeof printing !== "object") continue;
    if (printing.digital !== false || !isOfferable(printing)) continue;
    if (offeredFinishes(printing).length === 0) continue;
    if (seen.has(printing.id)) continue;
    seen.add(printing.id);
    selectable.push(printing);
  }
  return selectable.sort(compareOptions);
}
