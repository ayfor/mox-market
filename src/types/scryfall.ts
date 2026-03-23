/**
 * Scryfall API type definitions.
 * Based on https://scryfall.com/docs/api/cards
 */

export interface ScryfallPrices {
  usd: string | null;
  usd_foil: string | null;
  usd_etched: string | null;
  eur: string | null;
  eur_foil: string | null;
  tix: string | null;
}

export interface ScryfallImageUris {
  small: string;
  normal: string;
  large: string;
  png: string;
  art_crop: string;
  border_crop: string;
}

export interface ScryfallCardFace {
  object: "card_face";
  name: string;
  mana_cost: string;
  type_line: string;
  oracle_text?: string;
  image_uris?: ScryfallImageUris;
}

export interface ScryfallLegalities {
  standard: LegalityStatus;
  future: LegalityStatus;
  historic: LegalityStatus;
  timeless: LegalityStatus;
  gladiator: LegalityStatus;
  pioneer: LegalityStatus;
  explorer: LegalityStatus;
  modern: LegalityStatus;
  legacy: LegalityStatus;
  pauper: LegalityStatus;
  vintage: LegalityStatus;
  penny: LegalityStatus;
  commander: LegalityStatus;
  oathbreaker: LegalityStatus;
  standardbrawl: LegalityStatus;
  brawl: LegalityStatus;
  alchemy: LegalityStatus;
  paupercommander: LegalityStatus;
  duel: LegalityStatus;
  oldschool: LegalityStatus;
  premodern: LegalityStatus;
  predh: LegalityStatus;
  [key: string]: LegalityStatus;
}

export type LegalityStatus =
  | "legal"
  | "not_legal"
  | "restricted"
  | "banned";

export interface ScryfallCard {
  // Core fields
  id: string;
  oracle_id: string;
  name: string;
  lang: string;
  released_at: string;
  uri: string;
  scryfall_uri: string;
  layout: string;

  // Gameplay fields
  mana_cost?: string;
  cmc: number;
  type_line: string;
  oracle_text?: string;
  colors?: string[];
  color_identity: string[];
  keywords: string[];
  legalities: ScryfallLegalities;

  // Print fields
  set: string;
  set_name: string;
  set_type: string;
  collector_number: string;
  rarity: "common" | "uncommon" | "rare" | "mythic" | "special" | "bonus";
  artist?: string;

  // Images — may be on card or on card_faces for double-faced cards
  image_uris?: ScryfallImageUris;
  card_faces?: ScryfallCardFace[];

  // Pricing
  prices: ScryfallPrices;

  // Related URIs
  related_uris?: Record<string, string>;
  purchase_uris?: Record<string, string>;

  // Misc
  foil: boolean;
  nonfoil: boolean;
  oversized: boolean;
  reserved: boolean;
  digital: boolean;
  reprint: boolean;
  edhrec_rank?: number;
}

// ----- API Response Types -----

export interface ScryfallSearchResponse {
  object: "list";
  total_cards: number;
  has_more: boolean;
  next_page?: string;
  data: ScryfallCard[];
}

export interface ScryfallAutocompleteResponse {
  object: "catalog";
  total_values: number;
  data: string[];
}

export type CardIdentifier =
  | { id: string }
  | { name: string }
  | { set: string; collector_number: string };

export interface ScryfallCollectionRequest {
  identifiers: CardIdentifier[];
}

export interface ScryfallCollectionResponse {
  object: "list";
  not_found: CardIdentifier[];
  data: ScryfallCard[];
}

export interface ScryfallError {
  object: "error";
  code: string;
  status: number;
  details: string;
}

// ----- App-level types -----

export type Currency = "usd" | "cad" | "eur" | "tix";

export interface DisplayPrices {
  usd: number | null;
  usd_foil: number | null;
  cad: number | null;
  cad_foil: number | null;
  eur: number | null;
  eur_foil: number | null;
  tix: number | null;
}

export interface PriceSnapshot {
  timestamp: number;
  prices: DisplayPrices;
}

export interface WatchlistCard {
  id: string;
  name: string;
  set: string;
  set_name: string;
  collector_number: string;
  rarity: ScryfallCard["rarity"];
  image_uri: string | null;
  type_line: string;
  current_prices: DisplayPrices;
  snapshots: PriceSnapshot[];
  added_at: number;
}
