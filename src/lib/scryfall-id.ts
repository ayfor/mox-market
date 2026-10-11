// A Scryfall card id (S2.3d2; S2.3 ADV-5): a lower-case UUID, as Scryfall
// writes them. One pattern for the `printing` URL param and for the
// printings PrintingSelect offers, so every offered option round-trips
// through the URL to itself. Client-safe: no imports.

/** A Scryfall card id: a lower-case UUID. */
export const SCRYFALL_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** True for a string that is one Scryfall card id, lower-case. */
export function isScryfallId(value: unknown): value is string {
  return typeof value === "string" && SCRYFALL_ID.test(value);
}
