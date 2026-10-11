// The printing and finish switch (S2.3d5; AC-5, AC-6; C2-B.7). Pure and
// client-safe: types only are imported. A switch is query-only, so the card
// path segment is never rebuilt or re-encoded, and the asking price is the
// URL's own, unchanged.
import type { ShownFinish } from "@/lib/recommendation/ui-copy";

/** What the selectors show: the evaluated printing and the URL's finish. */
export interface ShownSelection {
  readonly printingId: string;
  /** The requested finish, which FinishSelect shows even when not offered (AC-9). */
  readonly finish: ShownFinish;
  /** The shown printing's offered finishes. */
  readonly offeredFinishes: readonly ShownFinish[];
}

/** One control's commit: a printing or a finish. */
export type SelectionChange =
  | { readonly printing: string }
  | { readonly finish: ShownFinish };

/** The selection a switch navigates to. */
export interface Selection {
  readonly printing: string;
  readonly finish: ShownFinish;
}

/** A PrintingSelect option as the rule needs it. */
export interface SelectableOption {
  readonly id: string;
  readonly finishes: readonly ShownFinish[];
}

/** A printing's first offered finish is the first of these it offers. */
const FINISH_ORDER: readonly ShownFinish[] = ["normal", "foil"];

/** Read access to the URL's query: URLSearchParams or Next's read-only one. */
export type SearchParamsLike = Pick<URLSearchParams, "get">;

/**
 * The AC-6 rule: a finish change keeps the shown printing and writes its id,
 * so the printing never re-defaults; a printing change keeps the shown finish
 * when the new printing offers it, else takes its first offered finish
 * (normal before foil). A change equal to what is shown, an unknown printing
 * or a finish the printing does not offer is null: no navigation.
 */
export function nextSelection(
  shown: ShownSelection,
  change: SelectionChange,
  options: readonly SelectableOption[],
): Selection | null {
  if ("finish" in change) {
    if (change.finish === shown.finish) return null;
    if (!shown.offeredFinishes.includes(change.finish)) return null;
    return { printing: shown.printingId, finish: change.finish };
  }
  if (change.printing === shown.printingId) return null;
  const option = options.find(({ id }) => id === change.printing);
  if (option === undefined) return null;
  const finish = option.finishes.includes(shown.finish)
    ? shown.finish
    : FINISH_ORDER.find((offered) => option.finishes.includes(offered));
  return finish === undefined ? null : { printing: option.id, finish };
}

/**
 * The switch's href (AC-5): `?price=…&finish=…&printing=…`, query-only, so
 * router.push keeps the current path segment byte for byte. The price is the
 * URL's first `price` value verbatim (the server normalises it as before);
 * every other parameter is dropped. Never mutates `searchParams`.
 */
export function selectionHref(
  searchParams: SearchParamsLike,
  { printing, finish }: Selection,
): string {
  const price = searchParams.get("price") ?? "";
  return `?price=${encodeURIComponent(price)}&finish=${encodeURIComponent(finish)}&printing=${encodeURIComponent(printing)}`;
}
