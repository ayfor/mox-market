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

  // Actions
  addCard: (card: ScryfallCard) => Promise<void>;
  removeCard: (id: string) => void;
  clearAll: () => void;
  setCurrency: (currency: Currency) => void;
  snapshotPrices: (freshCards: ScryfallCard[]) => Promise<void>;
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

        set({ cards: updated });
      },
    }),
    {
      name: "mox-market:watchlist",
    },
  ),
);
