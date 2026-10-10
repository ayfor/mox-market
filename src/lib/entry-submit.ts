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
  /**
   * The card fails the route's guard ("." or "..", a control character, a
   * lone surrogate, too long) or names a built top-level route.
   */
  | { readonly status: "bad_card" }
  /** The price fails S2.1's parser. */
  | { readonly status: "bad_price" }
  /** Valid: navigate to `href`. */
  | { readonly status: "ok"; readonly href: string };

/**
 * The top-level paths a built route answers before the result route can see
 * them (S2.4 ADV-6): a card typed as exactly one of these would land on that
 * route instead ("sample" on the demo redirect, "evaluate" on the empty
 * form, "favicon.ico" on the icon), so the forms reject it as a card they
 * cannot look up. Only the entry forms read this list; the result route
 * keeps C2-B.11 = A's fall-through for every path no route claims ("api",
 * "_next" and "assets" reach /[card] on `next start`). entry-submit.test.ts
 * pins it against src/app and public.
 */
export const RESERVED_TOP_LEVEL_SEGMENTS: readonly string[] = Object.freeze([
  "evaluate",
  "favicon.ico",
  "sample",
]);

/**
 * True when submit stays disabled: a field is empty or whitespace. Builds no
 * href, so a render can call it with any text (S2.4 ADV-2).
 */
export function isEntryEmpty(card: string, price: string): boolean {
  return card.trim() === "" || price.trim() === "";
}

/**
 * The outcome of submitting `card` and `price`, checked in the order the
 * forms show it: empty, then the card guard, then the price. Never throws:
 * the card guard rejects a lone surrogate before resultHref encodes it
 * (S2.4 ADV-2).
 */
export function checkEntry(card: string, price: string): EntryCheck {
  if (isEntryEmpty(card, price)) return { status: "empty" };
  const parsed = parseCardParam(card);
  if (parsed === null || RESERVED_TOP_LEVEL_SEGMENTS.includes(parsed)) {
    return { status: "bad_card" };
  }
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
  readonly storage: () =>
    | Pick<Storage, "setItem" | "removeItem">
    | null
    | undefined;
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

/**
 * Removes the marker for `href` and returns true; false instead of a throw
 * when storage is blocked or missing. A form calls it for a submit that a
 * newer one superseded while it was pending (S2.4 ADV-5): that push never
 * lands, so its marker would otherwise wait in the tab for an unrelated
 * visit to the same URL and S5.1 would log that visit as a submit.
 */
export function clearSubmitMarker(
  href: string,
  env: MarkerEnv = browserEnv,
): boolean {
  try {
    const storage = env.storage();
    if (!storage) return false;
    storage.removeItem(submitMarkerKey(href));
    return true;
  } catch {
    return false;
  }
}
