// F2 §Default printing (S2.1d7; C1.26, C1.46 = A): which printing the result
// page evaluates when the user names only a card. Pure: no fetch, no clock.
import type { ShownFinish } from "@/lib/recommendation/ui-copy";
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
