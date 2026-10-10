// The named lookup's miss mapping (S2.4d7; AC-6, AC-7, AC-8; C1.29): a pure
// function from whatever the lookup threw to what the result page shows.
// Only Scryfall's own 404 is a miss; every other failure (5xx, 429, 400, an
// HTML body, a rejected fetch, a timeout, a full throttle queue) is the
// error panel, so a failure is never reported as "not found".
import { ScryfallApiError } from "@/lib/scryfall";

/** What a failed named lookup means for the page. */
export type LookupMiss = "ambiguous" | "not_found" | "unavailable";

/** Scryfall's `type` on a fuzzy lookup that matches several cards. */
const AMBIGUOUS_TYPE = "ambiguous";

const NOT_FOUND_STATUS = 404;

export function classifyLookupError(error: unknown): LookupMiss {
  if (!(error instanceof ScryfallApiError)) return "unavailable";
  if (error.status !== NOT_FOUND_STATUS) return "unavailable";
  return error.type === AMBIGUOUS_TYPE ? "ambiguous" : "not_found";
}
