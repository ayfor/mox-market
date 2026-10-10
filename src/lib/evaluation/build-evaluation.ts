import "server-only";

// The result page's server logic (S2.1d8; story Verification): lookup,
// printings, market snapshot and the engine, with Scryfall, the history
// reader, the clock and the log injectable. Never throws: every failure is a
// status the page renders (F2 Fields: never a 500).
import { selectDefaultPrinting } from "@/lib/printings";
import { computeRecommendation } from "@/lib/recommendation/engine";
import { InvalidRecommendationInputError } from "@/lib/recommendation/errors";
import type { Finish, Recommendation } from "@/lib/recommendation/types";
import type { ShownFinish } from "@/lib/recommendation/ui-copy";
import { getAllPrintings, getCardByName } from "@/lib/scryfall";
import type { ScryfallCard } from "@/types/scryfall";
import {
  defaultHistoryReader,
  type PriceHistoryReader,
} from "./history-reader";
import {
  consoleLog,
  loadMarketSnapshot,
  type EvaluationLog,
} from "./load-market-snapshot";

/** A validated query from parseResultParams. */
export interface EvaluationQuery {
  readonly card: string;
  readonly askingPriceCents: number;
  readonly finish: ShownFinish;
}

/** Everything buildEvaluation reaches outside itself. */
export interface EvaluationDeps {
  readonly scryfall: {
    getCardByName(name: string, fuzzy: boolean): Promise<ScryfallCard | null>;
    getAllPrintings(card: ScryfallCard): Promise<ScryfallCard[]>;
  };
  readonly reader: PriceHistoryReader;
  readonly now: () => Date;
  readonly log: EvaluationLog;
}

export const defaultEvaluationDeps: EvaluationDeps = Object.freeze({
  scryfall: Object.freeze({ getCardByName, getAllPrintings }),
  reader: defaultHistoryReader,
  now: () => new Date(),
  log: consoleLog,
});

/** The evaluated printing, as the card header shows it (D2). */
export type EvaluatedPrinting = Pick<
  ScryfallCard,
  | "id"
  | "name"
  | "set"
  | "set_name"
  | "collector_number"
  | "image_uris"
  | "card_faces"
>;

export type Evaluation =
  | {
      readonly status: "ok";
      readonly printing: EvaluatedPrinting;
      readonly requestedFinish: ShownFinish;
      readonly appliedFinish: Finish;
      readonly recommendation: Recommendation;
      readonly latestSnapshotAt: Date | null;
      readonly historyUnavailable: boolean;
      readonly syncStale: boolean;
      readonly now: Date;
    }
  /** Scryfall failed or timed out: the error panel, nothing partial (AC-4). */
  | { readonly status: "error" }
  /** No card for the name (S2.4 splits ambiguous from unknown). */
  | { readonly status: "not_found" }
  /** The engine rejected the input: the validation string (F2 Fields). */
  | { readonly status: "invalid" };

/** Lookup, printings, snapshot and recommendation for one query. */
export async function buildEvaluation(
  query: EvaluationQuery,
  deps: EvaluationDeps = defaultEvaluationDeps,
): Promise<Evaluation> {
  let named: ScryfallCard | null;
  let printings: ScryfallCard[];
  try {
    named = await deps.scryfall.getCardByName(query.card, true);
    if (named === null) return { status: "not_found" };
    printings = await deps.scryfall.getAllPrintings(named);
  } catch (error) {
    deps.log("scryfall_failed", error);
    return { status: "error" };
  }

  const printing = selectDefaultPrinting(printings, query.finish) ?? named;
  const now = deps.now();
  const snapshot = await loadMarketSnapshot({
    printing,
    requestedFinish: query.finish,
    reader: deps.reader,
    now,
    log: deps.log,
  });

  let recommendation: Recommendation;
  try {
    recommendation = computeRecommendation(
      {
        askingPriceCents: query.askingPriceCents,
        cardId: printing.id,
        finish: query.finish,
      },
      snapshot.market,
    );
  } catch (error) {
    if (error instanceof InvalidRecommendationInputError) {
      return { status: "invalid" };
    }
    deps.log("engine_failed", error);
    return { status: "error" };
  }

  return {
    status: "ok",
    printing,
    requestedFinish: query.finish,
    appliedFinish: snapshot.market.appliedFinish,
    recommendation,
    latestSnapshotAt: snapshot.market.latestSnapshotAt,
    historyUnavailable: snapshot.historyUnavailable,
    syncStale: snapshot.syncStale,
    now,
  };
}
