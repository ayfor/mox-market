// The entry forms' shared submit path (S2.4d3; AC-2, AC-3, AC-15; C1.52):
// one validator for the landing form, /evaluate and the miss-state form, and
// the one-shot submit marker S5.1 consumes (C1.28 = A: written in the
// browser, never to the server). Client-safe: no server imports, no React.
import {
  parseCardParam,
  parsePriceCents,
} from "@/lib/evaluation/result-params";
import { resultHref } from "./result-href";

/** What a submit with these field values does. */
export type EntryCheck =
  /** A field is empty or whitespace: submit stays disabled with the helper. */
  | { readonly status: "empty" }
  /** The card fails the route's guard ("." or "..", a control character, too long). */
  | { readonly status: "bad_card" }
  /** The price fails S2.1's parser. */
  | { readonly status: "bad_price" }
  /** Valid: navigate to `href`. */
  | { readonly status: "ok"; readonly href: string };

/**
 * The outcome of submitting `card` and `price`, checked in the order the
 * forms show it: empty, then the card guard, then the price. Never throws.
 */
export function checkEntry(card: string, price: string): EntryCheck {
  if (card.trim() === "" || price.trim() === "") return { status: "empty" };
  if (parseCardParam(card) === null) return { status: "bad_card" };
  if (parsePriceCents(price) === null) return { status: "bad_price" };
  return { status: "ok", href: resultHref(card, price) };
}

/** The sessionStorage key prefix of the submit marker (C2-B.10). */
const MARKER_PREFIX = "mm:submit:";

/** The marker key a submit writes for `href`. */
export function submitMarkerKey(href: string): string {
  return MARKER_PREFIX + href;
}

/**
 * The marker key the result page reads for its own URL (S5.1 imports it):
 * equal to submitMarkerKey(href) once the browser has navigated to href.
 */
export function consumerMarkerKey(
  location: Pick<Location, "pathname" | "search">,
): string {
  return MARKER_PREFIX + location.pathname + location.search;
}

/** Where the marker is written; the browser's by default. */
export interface MarkerEnv {
  readonly storage: () => Pick<Storage, "setItem"> | null | undefined;
  readonly uuid: () => string;
}

const browserEnv: MarkerEnv = {
  storage: () => globalThis.sessionStorage,
  uuid: () => globalThis.crypto.randomUUID(),
};

/**
 * Writes a fresh UUID under submitMarkerKey(href) and returns true. Storage
 * that is blocked, full or missing, or a missing crypto.randomUUID (an
 * insecure origin), returns false instead of throwing: the marker is skipped
 * and the navigation still happens.
 */
export function markSubmit(href: string, env: MarkerEnv = browserEnv): boolean {
  try {
    const storage = env.storage();
    if (!storage) return false;
    storage.setItem(submitMarkerKey(href), env.uuid());
    return true;
  } catch {
    return false;
  }
}
