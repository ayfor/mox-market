// F2's UI strings from F1's UI-strings table (S1.3, AC-5; S1.3d3; C2-B.8 = A),
// as frozen literals. S2.1, S2.3 and S2.4 are the first callers. The source
// label sits with the legal strings in src/lib/copy/legal.ts (S1.3d5). Types
// only are imported, so a client component may import this module. Changing a
// string needs a plan-doc deviation and Josh's ruling (AGENTS.md).
import type { Finish } from "./types";

export const UI_COPY = Object.freeze({
  /** Scryfall down or timed out (F2 W1). */
  errorPanel: "Couldn't reach price data — try again.",
  /** No asking price entered; submit disabled. */
  submitHelper: "Enter a card and a price.",
  /** Asking price invalid or over $100k; the limits live in ./limits. */
  validationError: "Enter a price from $0.01 to $100,000, like 74.99.",
  /** Under a signal tile that renders "—". */
  thinDataNote: "thin data",
  /** Under the source label (C1.31). */
  historyLine: "Price history: {N} snapshots, newest {relativeTime}",
  /** latestSnapshotAt older than STALENESS_FLAG_HOURS (C1.31). */
  staleFlag: "Over {hours} hours old",
  /** latestSnapshotAt is null (C1.31). */
  noHistory: "No price history yet for this printing.",
  /** The newest successful sync is over 48h old, null or unreadable (C1.31). */
  staleBanner: "Price data is temporarily out of date.",
  /** History read rejects or exceeds HISTORY_TIMEOUT_MS (C1.32). */
  historyUnavailable: "Price history temporarily unavailable",
  /** Scryfall 404 type "ambiguous" (C1.29). */
  ambiguousCard: "Pick from the suggestions",
  /** Card not found (C1.29). */
  cardNotFound: "Couldn't find that card",
  /** PrintingSelect's label and accessible name (S2.3 AC-11). */
  printingLabel: "Printing",
  /** FinishSelect's label and accessible name (S2.3 AC-11). */
  finishLabel: "Finish",
  /** Each PrintingSelect option, e.g. "Modern Horizons 2 (MH2) · #12". */
  printingOption: "{set_name} ({SET}) · #{collector_number}",
  /** The disabled Import and About nav tabs (S2.4 AC-14, C1.45 = B). */
  navSoon: "soon",
} as const);

/** The finishes Phase 1 shows; etched is hidden (C1.08 = A). */
export type ShownFinish = Exclude<Finish, "etched">;

/**
 * FinishSelect's option names, also FALLBACK_NOTICE's {finish}. "Normal"
 * matches the notice's fixed "showing Normal pricing". No Etched label until
 * the story that unhides etched adds F1's row (S1.3d5).
 */
export const FINISH_LABELS = Object.freeze({
  normal: "Normal",
  foil: "Foil",
} as const) satisfies Readonly<Record<ShownFinish, string>>;
