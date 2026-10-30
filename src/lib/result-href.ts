// The one builder of result-route links (S2.4d2; AC-1, AC-11; C1.06 = A).
// Both entry forms, the miss-state form and the retired demo route use it, so
// identical input always yields the identical URL. Client-safe: it imports
// the pure price normaliser only.
import { normalisePrice } from "@/lib/evaluation/result-params";

/**
 * `/{card}?price={price}`: the card trimmed and encoded as one path segment,
 * the price normalised (`$`, whitespace and thousands commas stripped). No
 * `finish`, so the route defaults to normal. A non-empty `printing` (the Set
 * picker's Scryfall id, UI patch 2026-10-30) adds `&printing={id}`, which
 * the result route already reads (S2.3d2). It validates nothing: callers
 * run checkEntry first, so it never sees an empty or dot-segment card.
 */
export function resultHref(
  card: string,
  price: string,
  printing?: string,
): string {
  const href = `/${encodeURIComponent(card.trim())}?price=${encodeURIComponent(normalisePrice(price))}`;
  return printing ? `${href}&printing=${encodeURIComponent(printing)}` : href;
}

/**
 * The canonical demo link (C1.13 = C): Esper Sentinel at $74.99. A literal,
 * so the redirect reads no input; a test pins it equal to
 * resultHref("Esper Sentinel", "74.99").
 */
export const DEMO_RESULT_HREF = "/Esper%20Sentinel?price=74.99";
