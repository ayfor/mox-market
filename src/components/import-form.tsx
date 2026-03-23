"use client";

import { parseCardList, type ParsedLine } from "@/lib/card-parser";
import { setCachedCards } from "@/lib/card-cache";
import { getCollection } from "@/lib/scryfall";
import { useWatchlistStore } from "@/store/watchlist";
import type { ScryfallCard } from "@/types/scryfall";
import { clsx } from "clsx";
import Image from "next/image";
import { useCallback, useState } from "react";
import { getCardImageUri } from "@/lib/scryfall";

type ImportState = "idle" | "parsing" | "done";

interface MatchedCard {
  parsed: ParsedLine;
  card: ScryfallCard;
  alreadyInWatchlist: boolean;
}

interface UnmatchedLine {
  parsed: ParsedLine;
}

export function ImportForm() {
  const [text, setText] = useState("");
  const [state, setState] = useState<ImportState>("idle");
  const [matched, setMatched] = useState<MatchedCard[]>([]);
  const [unmatched, setUnmatched] = useState<UnmatchedLine[]>([]);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [addedCount, setAddedCount] = useState(0);

  const addCard = useWatchlistStore((s) => s.addCard);
  const watchlistCards = useWatchlistStore((s) => s.cards);

  const handleParse = useCallback(async () => {
    if (!text.trim()) return;

    setState("parsing");
    setMatched([]);
    setUnmatched([]);
    setSkipped([]);
    setAddedCount(0);

    const { parsed, skipped: skippedLines } = parseCardList(text);
    setSkipped(skippedLines);

    if (parsed.length === 0) {
      setState("done");
      return;
    }

    // Build identifiers for batch lookup
    const identifiers = parsed.map((p) => ({ name: p.cardName }));

    try {
      const result = await getCollection(identifiers);
      const foundMap = new Map<string, ScryfallCard>();

      for (const card of result.data) {
        // Map by lowercase name for matching
        foundMap.set(card.name.toLowerCase(), card);
      }

      // Cache all found cards
      setCachedCards(result.data);

      const matchedCards: MatchedCard[] = [];
      const unmatchedLines: UnmatchedLine[] = [];

      for (const p of parsed) {
        const card = foundMap.get(p.cardName.toLowerCase());
        if (card) {
          const alreadyInWatchlist = watchlistCards.some(
            (c) => c.id === card.id,
          );
          matchedCards.push({ parsed: p, card, alreadyInWatchlist });
        } else {
          unmatchedLines.push({ parsed: p });
        }
      }

      setMatched(matchedCards);
      setUnmatched(unmatchedLines);

      // Auto-add matched cards that aren't already in watchlist
      let added = 0;
      for (const m of matchedCards) {
        if (!m.alreadyInWatchlist) {
          await addCard(m.card);
          added++;
        }
      }
      setAddedCount(added);
    } catch {
      // Network error — mark everything as unmatched
      setUnmatched(parsed.map((p) => ({ parsed: p })));
    }

    setState("done");
  }, [text, addCard, watchlistCards]);

  const handleReset = () => {
    setText("");
    setState("idle");
    setMatched([]);
    setUnmatched([]);
    setSkipped([]);
    setAddedCount(0);
  };

  return (
    <div className="mt-10 max-w-2xl">
      {state === "idle" || state === "parsing" ? (
        <>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={`Paste your card list here...\n\nSupported formats:\n- One card per line: Lightning Bolt\n- MTGO format: 4 Lightning Bolt\n- Arena format: 4 Lightning Bolt (M21) 199`}
            rows={12}
            disabled={state === "parsing"}
            className={clsx(
              "block w-full rounded-lg bg-white px-4 py-3 text-sm/6 text-gray-950 font-mono",
              "outline -outline-offset-1 outline-gray-950/15",
              "placeholder:text-gray-400 dark:placeholder:text-gray-500",
              "focus:outline-2 focus:-outline-offset-2 focus:outline-mox-sapphire",
              "dark:bg-white/10 dark:text-white dark:outline-white/15 dark:focus:outline-mox-sapphire-light",
              state === "parsing" && "opacity-60",
            )}
          />
          <div className="mt-4 flex items-center gap-3">
            <button
              type="button"
              onClick={handleParse}
              disabled={!text.trim() || state === "parsing"}
              className={clsx(
                "inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold text-white",
                "bg-gray-950 hover:bg-gray-800 dark:bg-gray-700 dark:hover:bg-gray-600",
                "disabled:opacity-50 disabled:cursor-not-allowed",
              )}
            >
              {state === "parsing" && (
                <svg className="size-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              )}
              {state === "parsing" ? "Parsing..." : "Parse & Add Cards"}
            </button>
            <span className="text-xs text-gray-500 dark:text-gray-400">
              Cards will be added to your watchlist
            </span>
          </div>
        </>
      ) : (
        /* Results view */
        <div className="space-y-6">
          {/* Summary */}
          <div className="rounded-lg border border-gray-950/10 p-4 dark:border-white/10">
            <div className="flex items-center gap-3">
              <div className="flex size-8 items-center justify-center rounded-full bg-mox-emerald/10">
                <svg className="size-4 text-mox-emerald-light" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-950 dark:text-white">
                  {addedCount > 0
                    ? `${addedCount} card${addedCount !== 1 ? "s" : ""} added to watchlist`
                    : "No new cards added"}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {matched.length} matched
                  {matched.filter((m) => m.alreadyInWatchlist).length > 0 &&
                    ` (${matched.filter((m) => m.alreadyInWatchlist).length} already tracked)`}
                  {unmatched.length > 0 && ` \u00B7 ${unmatched.length} not found`}
                  {skipped.length > 0 && ` \u00B7 ${skipped.length} skipped`}
                </p>
              </div>
            </div>
          </div>

          {/* Matched cards */}
          {matched.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                Matched ({matched.length})
              </h3>
              <div className="mt-2 rounded-lg border border-gray-950/10 dark:border-white/10">
                {matched.map((m) => (
                  <div
                    key={m.card.id}
                    className="flex items-center gap-3 border-b border-gray-950/5 px-3 py-2 last:border-0 dark:border-white/5"
                  >
                    <svg
                      className={clsx(
                        "size-4 shrink-0",
                        m.alreadyInWatchlist
                          ? "text-gray-400"
                          : "text-mox-emerald-light",
                      )}
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth={2}
                      stroke="currentColor"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                    {getCardImageUri(m.card, "small") && (
                      <Image
                        src={getCardImageUri(m.card, "small")!}
                        alt={m.card.name}
                        width={24}
                        height={34}
                        className="shrink-0 rounded-sm"
                        unoptimized
                      />
                    )}
                    <span className="min-w-0 truncate text-sm text-gray-950 dark:text-white">
                      {m.card.name}
                    </span>
                    {m.alreadyInWatchlist && (
                      <span className="ml-auto shrink-0 text-xs text-gray-400">
                        already tracked
                      </span>
                    )}
                    {m.card.prices.usd && !m.alreadyInWatchlist && (
                      <span className="ml-auto shrink-0 text-xs font-medium tabular-nums text-gray-950 dark:text-white">
                        ${m.card.prices.usd}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Unmatched */}
          {unmatched.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-mox-ruby-light">
                Not Found ({unmatched.length})
              </h3>
              <div className="mt-2 rounded-lg border border-mox-ruby/20 dark:border-mox-ruby/30">
                {unmatched.map((u, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-3 border-b border-mox-ruby/10 px-3 py-2 last:border-0"
                  >
                    <svg className="size-4 shrink-0 text-mox-ruby-light" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                    <span className="min-w-0 truncate text-sm text-gray-500 dark:text-gray-400">
                      {u.parsed.cardName}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3">
            <button
              type="button"
              onClick={handleReset}
              className="rounded-full bg-gray-950 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800 dark:bg-gray-700 dark:hover:bg-gray-600"
            >
              Import More
            </button>
            <a
              href="/"
              className="rounded-full px-4 py-2 text-sm font-semibold text-gray-950 hover:bg-gray-950/5 dark:text-white dark:hover:bg-white/5"
            >
              View Dashboard
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
