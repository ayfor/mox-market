/**
 * Scryfall API client.
 * All requests route through the throttler to respect rate limits.
 */

import type {
  CardIdentifier,
  ScryfallAutocompleteResponse,
  ScryfallCard,
  ScryfallCollectionResponse,
  ScryfallImageUris,
  ScryfallError,
  ScryfallSearchResponse,
} from "@/types/scryfall";
import { throttle } from "./throttle";

const BASE_URL = "https://api.scryfall.com";

class ScryfallApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "ScryfallApiError";
  }
}

async function request<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  await throttle();

  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      Accept: "application/json",
      "User-Agent": "MoxMarket/0.1.0",
      ...options?.headers,
    },
  });

  if (!res.ok) {
    const error = (await res.json()) as ScryfallError;
    throw new ScryfallApiError(res.status, error.code, error.details);
  }

  return res.json() as Promise<T>;
}

/**
 * Lightweight name suggestions for search-as-you-type.
 * Returns up to 20 card name strings.
 */
export async function autocomplete(query: string): Promise<string[]> {
  if (query.length < 2) return [];

  try {
    const data = await request<ScryfallAutocompleteResponse>(
      `/cards/autocomplete?q=${encodeURIComponent(query)}`,
    );
    return data.data;
  } catch {
    return [];
  }
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
 * Single card lookup by name. Returns null if not found.
 */
export async function getCardByName(
  name: string,
  fuzzy = false,
): Promise<ScryfallCard | null> {
  const param = fuzzy ? "fuzzy" : "exact";
  try {
    return await request<ScryfallCard>(
      `/cards/named?${param}=${encodeURIComponent(name)}`,
    );
  } catch (error) {
    if (error instanceof ScryfallApiError && error.status === 404) {
      return null;
    }
    throw error;
  }
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
export async function getPrintings(
  name: string,
): Promise<ScryfallCard[]> {
  try {
    const data = await request<ScryfallSearchResponse>(
      `/cards/search?q=${encodeURIComponent(`!"${name}"`)}&unique=prints&order=usd`,
    );
    return data.data;
  } catch {
    return [];
  }
}

/**
 * Get a single card by Scryfall ID.
 */
export async function getCardById(
  id: string,
): Promise<ScryfallCard | null> {
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
  card: ScryfallCard,
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
