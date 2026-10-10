// AC-10's Esper Sentinel printings (S2.1d7): hand-built from the story's
// printings and prices, shaped like Scryfall card objects. Not a live
// capture. Test support only: no app code imports it.
import type { ScryfallCard } from "@/types/scryfall";

const ORACLE_ID = "0a4ad5b4-6d3c-4b52-8b8f-5f4a1c6a2c11";
export const ESPER_PRINTS_URI = `https://api.scryfall.com/cards/search?order=released&q=oracleid%3A${ORACLE_ID}&unique=prints`;

/** A full Scryfall card object for the fixture; overrides win. */
export function scryfallCard(
  overrides: Partial<ScryfallCard> = {},
): ScryfallCard {
  const id = overrides.id ?? "00000000-0000-4000-8000-000000000000";
  return {
    id,
    oracle_id: ORACLE_ID,
    name: "Esper Sentinel",
    lang: "en",
    released_at: "2021-06-18",
    uri: `https://api.scryfall.com/cards/${id}`,
    scryfall_uri: `https://scryfall.com/card/x/${id}`,
    layout: "normal",
    prints_search_uri: ESPER_PRINTS_URI,
    cmc: 1,
    type_line: "Artifact Creature — Human Soldier",
    color_identity: ["W"],
    keywords: [],
    legalities: {} as ScryfallCard["legalities"],
    set: "mh2",
    set_name: "Modern Horizons 2",
    set_type: "draft_innovation",
    collector_number: "12",
    rarity: "rare",
    image_uris: {
      small: `https://cards.scryfall.io/small/front/${id}.jpg`,
      normal: `https://cards.scryfall.io/normal/front/${id}.jpg`,
      large: `https://cards.scryfall.io/large/front/${id}.jpg`,
      png: `https://cards.scryfall.io/png/front/${id}.png`,
      art_crop: `https://cards.scryfall.io/art_crop/front/${id}.jpg`,
      border_crop: `https://cards.scryfall.io/border_crop/front/${id}.jpg`,
    },
    prices: {
      usd: null,
      usd_foil: null,
      usd_etched: null,
      eur: null,
      eur_foil: null,
      tix: null,
    },
    finishes: ["nonfoil", "foil"],
    promo: false,
    foil: true,
    nonfoil: true,
    oversized: false,
    reserved: false,
    digital: false,
    reprint: false,
    ...overrides,
  };
}

const prices = (usd: string | null, usd_foil: string | null) => ({
  usd,
  usd_foil,
  usd_etched: null,
  eur: null,
  eur_foil: null,
  tix: null,
});

/** The expected default printing for both finishes: mh2 #12. */
export const MH2_12_ID = "f3537373-ef54-4578-9d05-6216420ee349";

/** The AC's seven printings plus a synthetic memorabilia one, priced lowest. */
export const ESPER_SENTINEL_PRINTS: readonly ScryfallCard[] = Object.freeze([
  // Secret Lair: foil-only, cheapest foil, but its set_type is box (C1.46 = A).
  scryfallCard({
    id: "11111111-1111-4111-8111-111111111111",
    set: "sld",
    set_name: "Secret Lair Drop",
    set_type: "box",
    collector_number: "2123",
    released_at: "2025-03-03",
    finishes: ["foil"],
    nonfoil: false,
    prices: prices(null, "41.00"),
  }),
  // MH2 promo: promo flag and promo set_type.
  scryfallCard({
    id: "22222222-2222-4222-8222-222222222222",
    set: "pmh2",
    set_name: "Modern Horizons 2 Promos",
    set_type: "promo",
    collector_number: "12s",
    promo: true,
    prices: prices("48.00", "52.00"),
  }),
  // The List: a candidate, but dearer than mh2 #12.
  scryfallCard({
    id: "33333333-3333-4333-8333-333333333333",
    set: "plst",
    set_name: "The List",
    set_type: "masterpiece",
    collector_number: "MH2-12",
    released_at: "2022-03-01",
    finishes: ["nonfoil"],
    foil: false,
    prices: prices("64.50", null),
  }),
  // MH2 extended art: a candidate, dearer in both finishes.
  scryfallCard({
    id: "44444444-4444-4444-8444-444444444444",
    collector_number: "328",
    prices: prices("71.20", "88.10"),
  }),
  // Modern Horizons 2 timeshifts set (h2r): a candidate, dearer.
  scryfallCard({
    id: "55555555-5555-4555-8555-555555555555",
    set: "h2r",
    set_name: "Modern Horizons 2 Timeshifts",
    collector_number: "4",
    prices: prices("80.00", "95.00"),
  }),
  // The default for both finishes.
  scryfallCard({
    id: MH2_12_ID,
    collector_number: "12",
    prices: prices("59.17", "76.47"),
  }),
  // Historic Horizons on Arena: digital, cheapest of all.
  scryfallCard({
    id: "77777777-7777-4777-8777-777777777777",
    set: "j21",
    set_name: "Jumpstart: Historic Horizons",
    set_type: "alchemy",
    collector_number: "9",
    released_at: "2021-08-26",
    digital: true,
    prices: prices("0.50", "0.75"),
  }),
  // Synthetic gold-border memorabilia printing, priced lower than mh2 #12.
  scryfallCard({
    id: "88888888-8888-4888-8888-888888888888",
    set: "wc21",
    set_name: "World Championship Decks 2021",
    set_type: "memorabilia",
    collector_number: "12",
    released_at: "2021-12-01",
    finishes: ["nonfoil"],
    foil: false,
    prices: prices("3.25", null),
  }),
]);
