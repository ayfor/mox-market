# Data provenance: where Mox Market's prices come from

Design F0 (Approved 2026-10-10) and F2; story S0.2. One history, one source, no blending.

## Price history (F0)

**The only history series is MTGJson AllPrices → paper TCGplayer retail USD.** `src/lib/mtgjson/parse.ts` reads `data.<uuid>.paper.tcgplayer.retail.{normal,foil,etched}` when the block's `currency` is `USD`, and nothing else:

- Never read: every other paper provider (Card Kingdom, Cardmarket, Mana Pool and any MTGJson adds later), TCGplayer's `buylist`, the whole `mtgo` block, and any EUR price. Prices are never blended across providers.
- Stored in `price_history` as `(scryfall_id, finish, date, price_cents)`: one row per printing, finish and UTC date (the primary key), `price_cents` a positive integer converted once at the parser boundary with `Math.round(price * 100)`. Nothing downstream sees a float.
- Window: the 31 UTC dates from runDate − 30 to runDate; older rows are pruned on every run. A date MTGJson did not publish stays a gap; nothing is synthesized.
- Gate, per (printing, finish) series: kept when the card's EDHREC rank is at most 5,000 or the series' newest price is at least $1.00 (both inclusive). A cheap printing of an unranked card has no history, so its result reads `insufficient_data` by design.
- Identity: MTGJson's UUID is mapped to Scryfall's card id through `AllIdentifiers` (`mtgjson_identifiers`), one preferred UUID per Scryfall id (side null, else `a`, else the lowest side), so a double-faced card's faces never write two different prices for one printing.
- Loaded by the bulk ingest (`scripts/ingest-mtgjson-history.ts`, runbook `docs/runbooks/mtgjson-ingest.md`) from `AllPrices.json.gz` (90 days), and kept current by S0.3's daily sync, the cron route `/api/prices/sync-mtgjson` at 17:00 UTC (`src/lib/mtgjson/sync.ts`), from `AllPricesToday.json.gz`, through the same parser and transform.

## Current price (F2)

The price a recommendation compares the asking price against is **Scryfall's `prices.usd` (normal) or `prices.usd_foil` (foil)**, which Scryfall sources from TCGplayer, read live through `src/lib/scryfall.ts` and converted to cents once by `priceCentsFor` in `src/lib/printings.ts` (F2's `currentPriceCents`).

## The basis question (F0 Open Question 3)

F1 measures the asking-price delta against Scryfall's current price, while its range, median and trend come from the MTGJson series. Both are TCGplayer retail market prices, but if they differed systematically the signals would mix bases. S0.2 measures it with the ingest script's `--basis-sample 25`: the median absolute gap between MTGJson's newest price and Scryfall's live price over 25 random kept normal and foil series. A median over 2% is an open ruling for Josh (whether in-gate printings should use MTGJson's newest price as `currentPriceCents`); no pricing code changes without it. The 2026-10-11 measurement is in the S0.2 plan's AC-12 evidence.

## Attribution

Both sources are TCGplayer data, which is what the R6 site footer states ("This product uses TCGplayer data but is not endorsed or certified by TCGplayer.", `docs/specs/attribution-footer.md`). MTGJson is the distributor of the history; Scryfall of the current price and the card data.
