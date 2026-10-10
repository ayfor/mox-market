// F2's UI and ops constants (S2.1d4). None is a RECOMMENDATION_PARAMS value
// (F2: "UI consts module, not RECOMMENDATION_PARAMS"), so none moves
// PARAMS_VERSION. Imports nothing, so client and server modules share it.

/** The history line's stale flag shows past this many hours (C1.31). */
export const STALENESS_FLAG_HOURS = 36;

/** The global banner shows when the newest successful sync is older (C1.31). */
export const STALE_BANNER_HOURS = 48;

/** Each history or freshness read is raced to this budget (C1.32). */
export const HISTORY_TIMEOUT_MS = 500;

/** The card path segment's limit in code points (F2 pre-Scryfall guard, C1.52). */
export const CARD_PARAM_MAX_CHARS = 141;

/** Autocomplete needs this many trimmed characters (C1.30). */
export const AUTOCOMPLETE_MIN_CHARS = 2;

/** The combobox waits this long after the last keystroke (C1.30). */
export const AUTOCOMPLETE_DEBOUNCE_MS = 150;

/** The autocomplete route's CDN cache lifetime, one day (C1.30). */
export const AUTOCOMPLETE_CACHE_SECONDS = 86_400;

/** Each Scryfall request aborts after this long (S2.1d21). */
export const SCRYFALL_TIMEOUT_MS = 8_000;

/** getAllPrintings stops with an error past this many pages (S2.1d7). */
export const MAX_PRINT_PAGES = 20;
