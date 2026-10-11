// AC-10's Esper Sentinel printings (S2.1d7): hand-built from the story's
// printings and prices, shaped like Scryfall card objects. Not a live
// capture, except sld #2123's id, which is its real Scryfall id (S2.3d9,
// checked 2026-10-10), so S2.3 AC-9's URL is used verbatim. Test support
// only: no app code imports it.
import type { ScryfallCard, ScryfallSearchResponse } from "@/types/scryfall";

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
/** Secret Lair #2123: foil only, set_type box. Its real Scryfall id (S2.3d9). */
export const SLD_2123_ID = "f8b6c532-b837-42b6-9ed2-0231d0779626";
/** MH2 promo #12s: promo flag and promo set_type. */
export const PMH2_12S_ID = "22222222-2222-4222-8222-222222222222";
/** The List: normal only. */
export const PLST_ID = "33333333-3333-4333-8333-333333333333";
/** MH2 extended art #328: same set and released_at as mh2 #12. */
export const MH2_328_ID = "44444444-4444-4444-8444-444444444444";
/** Modern Horizons 2 Timeshifts #4. */
export const H2R_4_ID = "55555555-5555-4555-8555-555555555555";
/** Jumpstart: Historic Horizons on Arena: digital. */
export const J21_ID = "77777777-7777-4777-8777-777777777777";
/** World Championship Decks 2021: memorabilia, normal only. */
export const WC21_ID = "88888888-8888-4888-8888-888888888888";

/** The AC's seven printings plus a synthetic memorabilia one, priced lowest. */
export const ESPER_SENTINEL_PRINTS: readonly ScryfallCard[] = Object.freeze([
  // Secret Lair: foil-only, cheapest foil, but its set_type is box (C1.46 = A).
  scryfallCard({
    id: SLD_2123_ID,
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
    id: PMH2_12S_ID,
    set: "pmh2",
    set_name: "Modern Horizons 2 Promos",
    set_type: "promo",
    collector_number: "12s",
    promo: true,
    prices: prices("48.00", "52.00"),
  }),
  // The List: a candidate, but dearer than mh2 #12.
  scryfallCard({
    id: PLST_ID,
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
    id: MH2_328_ID,
    collector_number: "328",
    prices: prices("71.20", "88.10"),
  }),
  // Modern Horizons 2 timeshifts set (h2r): a candidate, dearer.
  scryfallCard({
    id: H2R_4_ID,
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
    id: J21_ID,
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
    id: WC21_ID,
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

/** A paper printing whose only finish is etched (S2.3 AC-4): never selectable. */
export function etchedOnlyPrinting(
  overrides: Partial<ScryfallCard> = {},
): ScryfallCard {
  return scryfallCard({
    id: "99999999-9999-4999-8999-999999999999",
    set: "cmm",
    set_name: "Commander Masters",
    set_type: "masters",
    collector_number: "12e",
    released_at: "2023-08-04",
    finishes: ["etched"],
    foil: false,
    nonfoil: false,
    prices: prices(null, null),
    ...overrides,
  });
}

/** The second page's URL in the two-page split (S2.3 AC-2). */
export const ESPER_PRINTS_PAGE_2_URI = `${ESPER_PRINTS_URI}&page=2`;

/** Page 1 of the two-page split: the first four printings, more to come. */
export const ESPER_PRINTS_PAGE_1: ScryfallSearchResponse = Object.freeze({
  object: "list",
  total_cards: ESPER_SENTINEL_PRINTS.length,
  has_more: true,
  next_page: ESPER_PRINTS_PAGE_2_URI,
  data: ESPER_SENTINEL_PRINTS.slice(0, 4),
});

/** Page 2 of the two-page split: the rest, the last page. */
export const ESPER_PRINTS_PAGE_2: ScryfallSearchResponse = Object.freeze({
  object: "list",
  total_cards: ESPER_SENTINEL_PRINTS.length,
  has_more: false,
  data: ESPER_SENTINEL_PRINTS.slice(4),
});
