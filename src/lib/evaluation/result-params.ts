// Input and URL-param validation for the result route (S2.1d5, C1.52; F2
// Fields). One pure module for the client entry form and the server page, so
// both accept exactly the same prices. Client-safe: imports constants only.
import {
  MAX_ASKING_PRICE_CENTS,
  MIN_ASKING_PRICE_CENTS,
} from "@/lib/recommendation/limits";
import type { ShownFinish } from "@/lib/recommendation/ui-copy";
import { CARD_PARAM_MAX_CHARS } from "./consts";

/** `$` and every whitespace character, stripped before parsing. */
const PRICE_NOISE = /[$\s]/g;

/**
 * Commas only as thousands separators: "1,234.50" and "100,000" pass,
 * "74,99", "0,50" and "1,5" (decimal commas) do not (ADV-3, S2.1d24).
 */
const THOUSANDS_GROUPED = /^\d{1,3}(,\d{3})+(\.\d{1,2})?$/;

/** F2 Fields: up to six whole-dollar digits and up to two decimals. */
const PRICE_SHAPE = /^\d{1,6}(\.\d{1,2})?$/;

/** Unicode category Cc: C0, DEL and C1 control characters. */
const CONTROL_CHARACTER = /\p{Cc}/u;

/**
 * The asking price with `$` and whitespace removed, and commas removed only
 * when they group thousands (F2 Fields, narrowed by ADV-3: a decimal comma
 * such as "74,99" is left in place, so the price is invalid rather than read
 * as $7,499).
 */
export function normalisePrice(raw: string): string {
  const price = raw.replace(PRICE_NOISE, "");
  return THOUSANDS_GROUPED.test(price) ? price.replace(/,/g, "") : price;
}

/**
 * The asking price in integer cents, or null when it is not a valid price:
 * the normalised text must match F2's shape, and the cents must lie within
 * MIN_ASKING_PRICE_CENTS..MAX_ASKING_PRICE_CENTS ($0.01 to $100,000).
 */
export function parsePriceCents(raw: string): number | null {
  const price = normalisePrice(raw);
  if (!PRICE_SHAPE.test(price)) return null;
  const cents = Math.round(Number(price) * 100);
  return cents >= MIN_ASKING_PRICE_CENTS && cents <= MAX_ASKING_PRICE_CENTS
    ? cents
    : null;
}

/** "." and "..": path dot segments, which a URL resolves away (ADV-6). */
const DOT_SEGMENTS: readonly string[] = [".", ".."];

/**
 * The card name when it passes F2's pre-Scryfall guard, else null: trimmed,
 * 1 to CARD_PARAM_MAX_CHARS code points, no control character, and not a
 * dot segment ("." or ".."), which cannot round-trip through the path. The
 * entry form runs the same guard before it navigates (ADV-6).
 */
export function parseCardParam(raw: string): string | null {
  const card = raw.trim();
  const length = [...card].length;
  if (length < 1 || length > CARD_PARAM_MAX_CHARS) return null;
  if (DOT_SEGMENTS.includes(card)) return null;
  return CONTROL_CHARACTER.test(card) ? null : card;
}

/** The result page's search params, as Next hands them over. */
export type ResultSearchParams = Readonly<
  Record<string, string | string[] | undefined>
>;

/** What the result page renders for a request. */
export type ResultParams =
  /** The card fails the guard: notFound() before any Scryfall call. */
  | { readonly kind: "not_found" }
  /** No usable query: the entry form, prefilled; `error` shows the validation string. */
  | {
      readonly kind: "form";
      readonly card: string;
      readonly price: string;
      readonly error: boolean;
    }
  /** A valid query: compute on the server. */
  | {
      readonly kind: "ok";
      readonly card: string;
      readonly price: string;
      readonly askingPriceCents: number;
      readonly finish: ShownFinish;
      /** The Suspense key: card, cents and finish (S2.1d5). */
      readonly paramsKey: string;
    };

const SHOWN_FINISHES: readonly string[] = ["normal", "foil"];

/** A single value, or undefined when the parameter is absent or repeated. */
function single(value: string | string[] | undefined): {
  value: string | undefined;
  repeated: boolean;
} {
  if (Array.isArray(value)) return { value: value[0], repeated: true };
  return { value, repeated: false };
}

/**
 * The card path segment decoded exactly once, or null when its percent
 * encoding is malformed. Next 16.1.6 hands `params.card` over still encoded
 * ("Esper%20Sentinel"; checked on `next start`, S2.1d5).
 */
export function decodeCardSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

/**
 * Validates the card path segment, as Next hands it over (still encoded),
 * and the search params (C1.52). A malformed or invalid card is not_found; a
 * missing price is the form without an error; an invalid or repeated price,
 * or a finish other than normal or foil (etched included, C1.08 = A), is the
 * form with the error. `printing` is ignored until S2.3.
 */
export function parseResultParams(
  cardSegment: string,
  search: ResultSearchParams,
): ResultParams {
  const decoded = decodeCardSegment(cardSegment);
  const card = decoded === null ? null : parseCardParam(decoded);
  if (card === null) return { kind: "not_found" };

  const price = single(search.price);
  const finish = single(search.finish);
  const typedPrice = price.value ?? "";
  const finishValid =
    !finish.repeated &&
    (finish.value === undefined || SHOWN_FINISHES.includes(finish.value));

  if (!price.repeated && typedPrice.trim() === "") {
    return { kind: "form", card, price: typedPrice, error: !finishValid };
  }
  const cents = price.repeated ? null : parsePriceCents(typedPrice);
  if (cents === null || !finishValid) {
    return { kind: "form", card, price: typedPrice, error: true };
  }
  const shownFinish = (finish.value ?? "normal") as ShownFinish;
  return {
    kind: "ok",
    card,
    price: typedPrice,
    askingPriceCents: cents,
    finish: shownFinish,
    paramsKey: `${card}|${cents}|${shownFinish}`,
  };
}
