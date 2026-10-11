/**
 * Scryfall API client.
 * All requests route through the throttler to respect rate limits.
 */

import type {
  CardIdentifier,
  ScryfallAutocompleteResponse,
  ScryfallCard,
  ScryfallCollectionResponse,
  ScryfallError,
  ScryfallImageUris,
  ScryfallSearchResponse,
} from "@/types/scryfall";
import {
  AUTOCOMPLETE_MAX_QUEUE_MS,
  MAX_PRINT_PAGES,
  SCRYFALL_MAX_QUEUE_MS,
  SCRYFALL_TIMEOUT_MS,
} from "./evaluation/consts";
import { throttle } from "./throttle";

const BASE_URL = "https://api.scryfall.com";

/**
 * Any non-2xx Scryfall answer (S2.4d6, AC-5): the HTTP status, the error
 * body's `code` and `type` when it carries them as strings, and its
 * `details` as the message. A body that is not Scryfall's JSON error object
 * (an HTML 502, an empty 500) gives code "unknown", no type and the status
 * text, so a failure is never a SyntaxError and never a 404 by accident.
 */
export class ScryfallApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly type: string | undefined;

  constructor(status: number, code: string, message: string, type?: string) {
    super(message);
    this.name = "ScryfallApiError";
    this.status = status;
    this.code = code;
    this.type = type;
  }
}

/** A string field of a parsed error body, or undefined. */
function stringField(
  body: unknown,
  key: keyof ScryfallError,
): string | undefined {
  if (body === null || typeof body !== "object") return undefined;
  const value = (body as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

/**
 * The ScryfallApiError for a non-2xx response, read defensively (S2.4d6).
 * A body stream that fails (an abort mid-body included) rejects with its own
 * error, like a failed fetch.
 */
async function apiErrorOf(res: Response): Promise<ScryfallApiError> {
  const text = await res.text();
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  return new ScryfallApiError(
    res.status,
    stringField(body, "code") ?? "unknown",
    stringField(body, "details") ?? (res.statusText || `HTTP ${res.status}`),
    stringField(body, "type"),
  );
}

/**
 * One throttled Scryfall request: a path under BASE_URL, or an absolute URL
 * that must already be on BASE_URL (the prints search and its next pages).
 * Unless the caller passes its own signal, the request aborts
 * SCRYFALL_TIMEOUT_MS after it is made, its wait in the throttle queue and
 * its body included, so a hung or backed-up Scryfall is an error and never a
 * page that does not finish (S2.1d21, ADV-1). A request whose throttle slot
 * lies more than `maxQueueMs` away is refused at once (ThrottleBacklogError).
 */
async function request<T>(
  pathOrUrl: string,
  options?: RequestInit,
  { maxQueueMs = SCRYFALL_MAX_QUEUE_MS }: { maxQueueMs?: number } = {},
): Promise<T> {
  const url = pathOrUrl.startsWith("/") ? `${BASE_URL}${pathOrUrl}` : pathOrUrl;
  if (!isScryfallUrl(url)) {
    throw new Error("refusing a request outside api.scryfall.com");
  }

  const controller = options?.signal ? null : new AbortController();
  const signal = options?.signal ?? controller?.signal;
  const timer = controller
    ? setTimeout(() => controller.abort(), SCRYFALL_TIMEOUT_MS)
    : null;
  try {
    await throttle({ signal: signal ?? undefined, maxWaitMs: maxQueueMs });
    const res = await fetch(url, {
      ...options,
      signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "MoxMarket/0.1.0",
        ...options?.headers,
      },
    });

    if (!res.ok) throw await apiErrorOf(res);

    return (await res.json()) as T;
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

/** True for an https URL on api.scryfall.com, the only host request() calls. */
function isScryfallUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.origin === BASE_URL && parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Lightweight name suggestions for search-as-you-type.
 * Returns up to 20 card name strings. Throws on any Scryfall failure, so the
 * autocomplete route can answer non-2xx (C1.30; the old catch is gone), and
 * when the throttle queue is over AUTOCOMPLETE_MAX_QUEUE_MS deep (ADV-1).
 */
export async function autocomplete(query: string): Promise<string[]> {
  if (query.length < 2) return [];

  const data = await request<ScryfallAutocompleteResponse>(
    `/cards/autocomplete?q=${encodeURIComponent(query)}`,
    undefined,
    { maxQueueMs: AUTOCOMPLETE_MAX_QUEUE_MS },
  );
  return data.data;
}

/**
 * Full card search with pagination.
 */
export async function searchCards(
  query: string,
  page = 1,
): Promise<ScryfallSearchResponse> {
  return request<ScryfallSearchResponse>(
    `/cards/search?q=${encodeURIComponent(query)}&page=${page}`,
  );
}

/**
 * Single card lookup by name (S2.4d6, AC-5). Never resolves null: a miss is
 * Scryfall's 404 as a ScryfallApiError (`type` "ambiguous" when the fuzzy
 * name matches several cards), so the caller tells an ambiguous name from an
 * unknown one and both from a failure. A 2xx body that is not an object
 * throws a TypeError. Network errors, aborts and a full throttle queue pass
 * through unchanged.
 */
export async function getCardByName(
  name: string,
  fuzzy = false,
): Promise<ScryfallCard> {
  const param = fuzzy ? "fuzzy" : "exact";
  const card = await request<ScryfallCard | null>(
    `/cards/named?${param}=${encodeURIComponent(name)}`,
  );
  if (card === null || typeof card !== "object") {
    throw new TypeError("malformed card payload");
  }
  return card;
}

/**
 * Batch lookup by identifiers. Up to 75 per request.
 * Returns found cards and a list of not-found identifiers.
 */
export async function getCollection(
  identifiers: CardIdentifier[],
): Promise<ScryfallCollectionResponse> {
  // Scryfall caps at 75 identifiers per request
  if (identifiers.length > 75) {
    const chunks: CardIdentifier[][] = [];
    for (let i = 0; i < identifiers.length; i += 75) {
      chunks.push(identifiers.slice(i, i + 75));
    }

    const results = await Promise.all(
      chunks.map((chunk) =>
        request<ScryfallCollectionResponse>("/cards/collection", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ identifiers: chunk }),
        }),
      ),
    );

    return {
      object: "list",
      data: results.flatMap((r) => r.data),
      not_found: results.flatMap((r) => r.not_found),
    };
  }

  return request<ScryfallCollectionResponse>("/cards/collection", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifiers }),
  });
}

/**
 * Get all printings of a card by exact name.
 * Returns printings sorted by USD price ascending (cheapest first).
 */
export async function getPrintings(name: string): Promise<ScryfallCard[]> {
  const data = await request<ScryfallSearchResponse>(
    `/cards/search?q=${encodeURIComponent(`!"${name}"`)}&unique=prints&order=usd`,
  );
  return data.data;
}

/**
 * Every printing of `card`: its prints_search_uri, then each next_page until
 * has_more is false, in Scryfall's order (F2 §Default printing). Follows only
 * URLs on api.scryfall.com and stops with an error after MAX_PRINT_PAGES
 * pages. Any failed page, a missing prints_search_uri or a page without a
 * data array throws, so a caller never sees a partial list (S2.1d7).
 */
export async function getAllPrintings(
  card: Pick<ScryfallCard, "prints_search_uri">,
): Promise<ScryfallCard[]> {
  if (typeof card.prints_search_uri !== "string" || !card.prints_search_uri) {
    throw new Error("card has no prints_search_uri");
  }
  const printings: ScryfallCard[] = [];
  let next: string | undefined = card.prints_search_uri;
  for (let page = 1; next !== undefined; page += 1) {
    if (page > MAX_PRINT_PAGES) {
      throw new Error(`printings exceed ${MAX_PRINT_PAGES} pages`);
    }
    if (!isScryfallUrl(next)) {
      throw new Error("printings page is outside api.scryfall.com");
    }
    const body: ScryfallSearchResponse =
      await request<ScryfallSearchResponse>(next);
    if (!body || !Array.isArray(body.data)) {
      throw new Error("printings page has no data array");
    }
    printings.push(...body.data);
    if (!body.has_more) break;
    if (typeof body.next_page !== "string") {
      throw new Error("printings page has more but no next_page");
    }
    next = body.next_page;
  }
  return printings;
}

/**
 * Get a single card by Scryfall ID.
 */
export async function getCardById(id: string): Promise<ScryfallCard | null> {
  try {
    return await request<ScryfallCard>(`/cards/${id}`);
  } catch (error) {
    if (error instanceof ScryfallApiError && error.status === 404) {
      return null;
    }
    throw error;
  }
}

/**
 * Extract the best image URI from a card, handling double-faced cards.
 */
export function getCardImageUri(
  card: Pick<ScryfallCard, "image_uris" | "card_faces">,
  size: keyof ScryfallImageUris = "normal",
): string | null {
  if (card.image_uris) {
    return card.image_uris[size] ?? null;
  }
  // Double-faced cards: use front face
  if (card.card_faces?.[0]?.image_uris) {
    return card.card_faces[0].image_uris[size] ?? null;
  }
  return null;
}
