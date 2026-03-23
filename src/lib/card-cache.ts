/**
 * Two-layer card data cache.
 * In-memory Map for current session + localStorage for persistence.
 * Cards older than 24 hours are considered stale.
 */

import type { ScryfallCard } from "@/types/scryfall";

const CACHE_KEY = "mox-market:card-cache";
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

interface CachedCard {
  card: ScryfallCard;
  cachedAt: number;
}

// In-memory layer
const memoryCache = new Map<string, CachedCard>();

function isStale(entry: CachedCard): boolean {
  return Date.now() - entry.cachedAt > MAX_AGE_MS;
}

/**
 * Load localStorage cache into memory on init.
 */
function hydrate(): void {
  if (typeof window === "undefined") return;
  if (memoryCache.size > 0) return; // Already hydrated

  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return;

    const entries: Record<string, CachedCard> = JSON.parse(raw);
    for (const [id, entry] of Object.entries(entries)) {
      if (!isStale(entry)) {
        memoryCache.set(id, entry);
      }
    }
  } catch {
    // Corrupted cache — clear it
    localStorage.removeItem(CACHE_KEY);
  }
}

/**
 * Persist memory cache to localStorage.
 */
function persist(): void {
  if (typeof window === "undefined") return;

  try {
    const entries: Record<string, CachedCard> = {};
    for (const [id, entry] of memoryCache) {
      if (!isStale(entry)) {
        entries[id] = entry;
      }
    }
    localStorage.setItem(CACHE_KEY, JSON.stringify(entries));
  } catch {
    // localStorage full or unavailable — silently fail
  }
}

/**
 * Get a card from cache. Returns null if not found or stale.
 */
export function getCachedCard(id: string): ScryfallCard | null {
  hydrate();

  const entry = memoryCache.get(id);
  if (!entry || isStale(entry)) {
    memoryCache.delete(id);
    return null;
  }
  return entry.card;
}

/**
 * Store a card in both memory and localStorage cache.
 */
export function setCachedCard(card: ScryfallCard): void {
  hydrate();

  memoryCache.set(card.id, {
    card,
    cachedAt: Date.now(),
  });
  persist();
}

/**
 * Store multiple cards at once.
 */
export function setCachedCards(cards: ScryfallCard[]): void {
  hydrate();

  const now = Date.now();
  for (const card of cards) {
    memoryCache.set(card.id, { card, cachedAt: now });
  }
  persist();
}

/**
 * Get all non-stale cached cards.
 */
export function getAllCachedCards(): ScryfallCard[] {
  hydrate();

  const cards: ScryfallCard[] = [];
  for (const [id, entry] of memoryCache) {
    if (isStale(entry)) {
      memoryCache.delete(id);
    } else {
      cards.push(entry.card);
    }
  }
  return cards;
}

/**
 * Clear entire cache.
 */
export function clearCache(): void {
  memoryCache.clear();
  if (typeof window !== "undefined") {
    localStorage.removeItem(CACHE_KEY);
  }
}
