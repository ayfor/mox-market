/**
 * Watchlist Zustand store.
 * Manages tracked cards, price snapshots, and currency preference.
 * Persisted to localStorage.
 */

import { getCardImageUri } from "@/lib/scryfall";
import type {
  Currency,
  DisplayPrices,
  PriceSnapshot,
  ScryfallCard,
  WatchlistCard,
} from "@/types/scryfall";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { usdToCad } from "@/lib/currency";

interface WatchlistState {
  cards: WatchlistCard[];
  currency: Currency;
  lastRefreshed: number | null;

  // Actions
  addCard: (card: ScryfallCard) => Promise<void>;
  removeCard: (id: string) => void;
  clearAll: () => void;
  setCurrency: (currency: Currency) => void;
  snapshotPrices: (freshCards: ScryfallCard[]) => Promise<void>;
  seedDemoHistory: () => void;
}

/**
 * Build DisplayPrices from a Scryfall card's prices, computing CAD from USD.
 */
async function buildDisplayPrices(
  prices: ScryfallCard["prices"],
): Promise<DisplayPrices> {
  const usd = prices.usd ? parseFloat(prices.usd) : null;
  const usdFoil = prices.usd_foil ? parseFloat(prices.usd_foil) : null;
  const eur = prices.eur ? parseFloat(prices.eur) : null;
  const eurFoil = prices.eur_foil ? parseFloat(prices.eur_foil) : null;
  const tix = prices.tix ? parseFloat(prices.tix) : null;

  const cad = await usdToCad(prices.usd);
  const cadFoil = await usdToCad(prices.usd_foil);

  return {
    usd: isNaN(usd as number) ? null : usd,
    usd_foil: isNaN(usdFoil as number) ? null : usdFoil,
    cad,
    cad_foil: cadFoil,
    eur: isNaN(eur as number) ? null : eur,
    eur_foil: isNaN(eurFoil as number) ? null : eurFoil,
    tix: isNaN(tix as number) ? null : tix,
  };
}

export const useWatchlistStore = create<WatchlistState>()(
  persist(
    (set, get) => ({
      cards: [],
      currency: "usd",
      lastRefreshed: null,

      addCard: async (card: ScryfallCard) => {
        const { cards } = get();

        // Don't add duplicates
        if (cards.some((c) => c.id === card.id)) return;

        const displayPrices = await buildDisplayPrices(card.prices);
        const snapshot: PriceSnapshot = {
          timestamp: Date.now(),
          prices: displayPrices,
        };

        const watchlistCard: WatchlistCard = {
          id: card.id,
          name: card.name,
          set: card.set,
          set_name: card.set_name,
          collector_number: card.collector_number,
          rarity: card.rarity,
          image_uri: getCardImageUri(card, "small"),
          type_line: card.type_line,
          current_prices: displayPrices,
          snapshots: [snapshot],
          added_at: Date.now(),
        };

        set({ cards: [...cards, watchlistCard] });
      },

      removeCard: (id: string) => {
        set({ cards: get().cards.filter((c) => c.id !== id) });
      },

      clearAll: () => {
        set({ cards: [] });
      },

      setCurrency: (currency: Currency) => {
        set({ currency });
      },

      snapshotPrices: async (freshCards: ScryfallCard[]) => {
        const { cards } = get();
        const freshMap = new Map(freshCards.map((c) => [c.id, c]));

        const updated = await Promise.all(
          cards.map(async (card) => {
            const fresh = freshMap.get(card.id);
            if (!fresh) return card;

            const displayPrices = await buildDisplayPrices(fresh.prices);
            const snapshot: PriceSnapshot = {
              timestamp: Date.now(),
              prices: displayPrices,
            };

            return {
              ...card,
              current_prices: displayPrices,
              image_uri: getCardImageUri(fresh, "small") ?? card.image_uri,
              snapshots: [...card.snapshots, snapshot],
            };
          }),
        );

        set({ cards: updated, lastRefreshed: Date.now() });
      },

      seedDemoHistory: () => {
        const { cards } = get();
        const now = Date.now();
        const DAY = 24 * 60 * 60 * 1000;

        const updated = cards.map((card) => {
          // Only seed if card has fewer than 3 snapshots
          if (card.snapshots.length >= 3) return card;

          const basePrice = card.current_prices;
          const seeded: PriceSnapshot[] = [];

          // Generate 14 days of simulated history
          for (let i = 13; i >= 0; i--) {
            const timestamp = now - i * DAY;
            // Random walk: +-8% variance from current price
            const jitter = 1 + (Math.random() - 0.5) * 0.16;
            const priceMultiplier = jitter;

            seeded.push({
              timestamp,
              prices: {
                usd: basePrice.usd ? Math.round(basePrice.usd * priceMultiplier * 100) / 100 : null,
                usd_foil: basePrice.usd_foil ? Math.round(basePrice.usd_foil * priceMultiplier * 100) / 100 : null,
                cad: basePrice.cad ? Math.round(basePrice.cad * priceMultiplier * 100) / 100 : null,
                cad_foil: basePrice.cad_foil ? Math.round(basePrice.cad_foil * priceMultiplier * 100) / 100 : null,
                eur: basePrice.eur ? Math.round(basePrice.eur * priceMultiplier * 100) / 100 : null,
                eur_foil: basePrice.eur_foil ? Math.round(basePrice.eur_foil * priceMultiplier * 100) / 100 : null,
                tix: basePrice.tix ? Math.round(basePrice.tix * priceMultiplier * 100) / 100 : null,
              },
            });
          }

          return {
            ...card,
            snapshots: seeded,
          };
        });

        set({ cards: updated });
      },
    }),
    {
      name: "mox-market:watchlist",
    },
  ),
);
