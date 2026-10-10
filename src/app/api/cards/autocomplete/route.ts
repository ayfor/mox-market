// GET /api/cards/autocomplete?q= (S2.1d14, C1.30): Scryfall's name
// suggestions, proxied server-side through scryfall.ts (throttle, User-Agent,
// timeout). Successes are cacheable on the CDN for a day; every failure is
// no-store, so a Scryfall outage is never cached. Reads and writes nothing.
import {
  AUTOCOMPLETE_CACHE_SECONDS,
  AUTOCOMPLETE_MIN_CHARS,
  CARD_PARAM_MAX_CHARS,
} from "@/lib/evaluation/consts";
import { autocomplete } from "@/lib/scryfall";

const NO_STORE = { "Cache-Control": "no-store" } as const;
const CACHED = {
  "Cache-Control": `public, max-age=0, s-maxage=${AUTOCOMPLETE_CACHE_SECONDS}`,
} as const;

/** Unicode category Cc: C0, DEL and C1 control characters. */
const CONTROL_CHARACTER = /\p{Cc}/u;

/** The trimmed query, or null unless it is one value of 2 to 141 code points. */
function queryOf(url: string): string | null {
  const values = new URL(url).searchParams.getAll("q");
  if (values.length !== 1) return null;
  const q = values[0].trim();
  const length = [...q].length;
  if (length < AUTOCOMPLETE_MIN_CHARS || length > CARD_PARAM_MAX_CHARS) {
    return null;
  }
  return CONTROL_CHARACTER.test(q) ? null : q;
}

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

export async function GET(request: Request): Promise<Response> {
  const q = queryOf(request.url);
  if (q === null) {
    return Response.json(
      { error: "invalid_query" },
      { status: 400, headers: NO_STORE },
    );
  }
  let names: unknown;
  try {
    names = await autocomplete(q);
  } catch (error) {
    const name = error instanceof Error ? error.name : typeof error;
    console.error(`[autocomplete] upstream_failed: ${name}`);
    names = null;
  }
  if (!isStringArray(names)) {
    return Response.json(
      { error: "upstream" },
      { status: 502, headers: NO_STORE },
    );
  }
  return Response.json({ data: names }, { headers: CACHED });
}
