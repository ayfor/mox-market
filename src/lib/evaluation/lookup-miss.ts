// The named lookup's miss mapping (S2.4d7; AC-6, AC-7, AC-8; C1.29): a pure
// function from whatever the lookup threw to what the result page shows.
// Only Scryfall's own 404 is a miss: status 404 with the body's code
// "not_found", which Scryfall sends on every miss. Every other failure (5xx,
// 429, 400, a 404 whose body is HTML, empty or not Scryfall's, which a wrong
// path or a proxy would send, a rejected fetch, a timeout, a full throttle
// queue) is the error panel and is logged, so an outage is never reported as
// "not found" (S2.4 ADV-3).
import { ScryfallApiError } from "@/lib/scryfall";

/** What a failed named lookup means for the page. */
export type LookupMiss = "ambiguous" | "not_found" | "unavailable";

/** Scryfall's `type` on a fuzzy lookup that matches several cards. */
const AMBIGUOUS_TYPE = "ambiguous";

const NOT_FOUND_STATUS = 404;

/** Scryfall's error `code` on a miss; a body it did not send reads "unknown". */
const NOT_FOUND_CODE = "not_found";

export function classifyLookupError(error: unknown): LookupMiss {
  if (!(error instanceof ScryfallApiError)) return "unavailable";
  if (error.status !== NOT_FOUND_STATUS) return "unavailable";
  if (error.code !== NOT_FOUND_CODE) return "unavailable";
  return error.type === AMBIGUOUS_TYPE ? "ambiguous" : "not_found";
}
