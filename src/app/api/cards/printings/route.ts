// GET /api/cards/printings?name= (UI patch 2026-10-30): the printings the
// entry forms' optional Set picker offers for one exact card name, proxied
// server-side through scryfall.ts (throttle, User-Agent, timeout). The same
// list and order as the result page's PrintingSelect (selectablePrintings),
// with only what an option needs: id, set name, set code, collector number
// and the printing line built here, so no client module holds template
// code. No prices. Successes are cacheable on the CDN for an hour; every
// failure is no-store. Reads and writes nothing.
//
// Review PS-1: Scryfall calls wait at most PRINTINGS_MAX_QUEUE_MS in the
// throttle queue (autocomplete's cap), so this side traffic never crowds out
// result-page lookups, and they follow the client's abort signal, so a
// client that went away stops the paging. Only `name` is accepted: any other
// parameter is a 400, so a cache-busting `?cb=` cannot reach Scryfall.
import {
  PRINTINGS_CACHE_SECONDS,
  PRINTINGS_MAX_QUEUE_MS,
} from "@/lib/evaluation/consts";
import { classifyLookupError } from "@/lib/evaluation/lookup-miss";
import { printingLine } from "@/lib/evaluation/printing-line";
import { parseCardParam } from "@/lib/evaluation/result-params";
import { selectablePrintings } from "@/lib/printings";
import { getAllPrintings, getCardByName } from "@/lib/scryfall";
import type { ScryfallCard } from "@/types/scryfall";

const NO_STORE = { "Cache-Control": "no-store" } as const;
const CACHED = {
  "Cache-Control": `public, max-age=0, s-maxage=${PRINTINGS_CACHE_SECONDS}`,
} as const;

/** One Set picker option. */
export interface PrintingChoice {
  readonly id: string;
  readonly setName: string;
  /** Upper case, as the printing line shows it ("MH2"). */
  readonly setCode: string;
  readonly collectorNumber: string;
  /** "Modern Horizons 2 (MH2) · #12". */
  readonly label: string;
}

/**
 * The name, or null unless `name` is the only parameter and holds one value
 * that passes the result route's card guard (parseCardParam: trimmed, 1 to
 * 141 code points, no control character, lone surrogate or dot segment).
 */
function nameOf(url: string): string | null {
  const params = new URL(url).searchParams;
  if ([...params.keys()].some((key) => key !== "name")) return null;
  const values = params.getAll("name");
  return values.length === 1 ? parseCardParam(values[0]) : null;
}

function choiceOf(printing: ScryfallCard): PrintingChoice {
  return {
    id: printing.id,
    setName: printing.set_name,
    setCode: printing.set.toUpperCase(),
    collectorNumber: printing.collector_number,
    label: printingLine(printing),
  };
}

const upstream = (stage: string, error: unknown) => {
  const name = error instanceof Error ? error.name : typeof error;
  console.error(`[printings] ${stage}: ${name}`);
  return Response.json(
    { error: "upstream" },
    { status: 502, headers: NO_STORE },
  );
};

export async function GET(request: Request): Promise<Response> {
  const name = nameOf(request.url);
  if (name === null) {
    return Response.json(
      { error: "invalid_name" },
      { status: 400, headers: NO_STORE },
    );
  }

  const limits = {
    maxQueueMs: PRINTINGS_MAX_QUEUE_MS,
    signal: request.signal,
  };

  // Scryfall's own 404 is an answer (no such card); any other failure is an
  // outage, never reported as not found (S2.4 ADV-3).
  let card: ScryfallCard;
  try {
    card = await getCardByName(name, false, limits);
  } catch (error) {
    if (classifyLookupError(error) !== "unavailable") {
      return Response.json(
        { error: "not_found" },
        { status: 404, headers: NO_STORE },
      );
    }
    return upstream("lookup_failed", error);
  }

  let printings: ScryfallCard[];
  try {
    const fetched: unknown = await getAllPrintings(card, limits);
    if (
      !Array.isArray(fetched) ||
      !fetched.every((entry) => entry !== null && typeof entry === "object")
    ) {
      throw new TypeError("malformed printings payload");
    }
    printings = fetched as ScryfallCard[];
  } catch (error) {
    return upstream("printings_failed", error);
  }

  return Response.json(
    { data: selectablePrintings(printings).map(choiceOf) },
    { headers: CACHED },
  );
}
