"use client";

import { autocomplete, getCardByName, getCardImageUri } from "@/lib/scryfall";
import { setCachedCard } from "@/lib/card-cache";
import { useWatchlistStore } from "@/store/watchlist";
import type { ScryfallCard } from "@/types/scryfall";
import { clsx } from "clsx";
import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";

export function CardSearch({ className }: { className?: string }) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [addingCard, setAddingCard] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);

  const addCard = useWatchlistStore((s) => s.addCard);
  const cards = useWatchlistStore((s) => s.cards);

  // Debounced autocomplete
  const handleInputChange = useCallback(
    (value: string) => {
      setQuery(value);
      setSelectedIndex(-1);

      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }

      if (value.length < 2) {
        setSuggestions([]);
        setIsOpen(false);
        return;
      }

      debounceRef.current = setTimeout(async () => {
        setIsLoading(true);
        const results = await autocomplete(value);
        setSuggestions(results);
        setIsOpen(results.length > 0);
        setIsLoading(false);
      }, 200);
    },
    [],
  );

  // Select a card from suggestions
  const handleSelect = useCallback(
    async (name: string) => {
      setAddingCard(name);
      setIsOpen(false);
      setQuery("");
      setSuggestions([]);

      try {
        const card = await getCardByName(name, false);
        if (card) {
          setCachedCard(card);
          await addCard(card);
        }
      } catch {
        // Silently fail — could add error toast later
      } finally {
        setAddingCard(null);
        inputRef.current?.focus();
      }
    },
    [addCard],
  );

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!isOpen) return;

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((prev) =>
            prev < suggestions.length - 1 ? prev + 1 : prev,
          );
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((prev) => (prev > 0 ? prev - 1 : -1));
          break;
        case "Enter":
          e.preventDefault();
          if (selectedIndex >= 0 && suggestions[selectedIndex]) {
            handleSelect(suggestions[selectedIndex]);
          }
          break;
        case "Escape":
          setIsOpen(false);
          setSelectedIndex(-1);
          break;
      }
    },
    [isOpen, selectedIndex, suggestions, handleSelect],
  );

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const isAlreadyAdded = useCallback(
    (name: string) => cards.some((c) => c.name === name),
    [cards],
  );

  return (
    <div className={clsx("relative", className)}>
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => handleInputChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => suggestions.length > 0 && setIsOpen(true)}
          placeholder="Search for a card..."
          className={clsx(
            "block w-full rounded-lg bg-white px-3 py-1.5 pr-8",
            "text-sm/6 text-gray-950 dark:text-white",
            "outline -outline-offset-1 outline-gray-950/15",
            "placeholder:text-gray-400 dark:placeholder:text-gray-500",
            "focus:outline-2 focus:outline-mox-sapphire",
            "dark:bg-white/10 dark:outline-white/15 dark:focus:outline-mox-sapphire-light",
          )}
        />
        {(isLoading || addingCard) && (
          <div className="absolute inset-y-0 right-2 flex items-center">
            <svg
              className="size-4 animate-spin text-gray-400"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
          </div>
        )}
      </div>

      {isOpen && suggestions.length > 0 && (
        <div
          ref={dropdownRef}
          className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg bg-white shadow-lg ring-1 ring-gray-950/10 dark:bg-gray-900 dark:ring-white/10"
        >
          {suggestions.map((name, index) => {
            const added = isAlreadyAdded(name);
            return (
              <button
                key={name}
                type="button"
                disabled={added}
                onClick={() => !added && handleSelect(name)}
                className={clsx(
                  "flex w-full items-center gap-2 px-3 py-2 text-left text-sm",
                  index === selectedIndex
                    ? "bg-mox-sapphire text-white"
                    : "text-gray-950 dark:text-white",
                  !added &&
                    index !== selectedIndex &&
                    "hover:bg-gray-950/5 dark:hover:bg-white/5",
                  added && "opacity-50",
                )}
              >
                <span className="min-w-0 truncate">{name}</span>
                {added && (
                  <span className="ml-auto shrink-0 text-xs text-gray-400">
                    added
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {addingCard && (
        <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
          Adding {addingCard}...
        </p>
      )}
    </div>
  );
}

/**
 * Compact card row for the sidebar watchlist.
 */
export function WatchlistCardRow({
  card,
  onRemove,
}: {
  card: {
    id: string;
    name: string;
    set_name: string;
    image_uri: string | null;
    current_prices: { usd: number | null; cad: number | null; eur: number | null; tix: number | null };
  };
  onRemove: (id: string) => void;
}) {
  const currency = useWatchlistStore((s) => s.currency);

  const price =
    currency === "usd"
      ? card.current_prices.usd
      : currency === "cad"
        ? card.current_prices.cad
        : currency === "eur"
          ? card.current_prices.eur
          : card.current_prices.tix;

  const symbol =
    currency === "usd" || currency === "cad"
      ? "$"
      : currency === "eur"
        ? "\u20AC"
        : "";
  const suffix = currency === "tix" ? " tix" : "";

  return (
    <div className="group flex items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-gray-950/5 dark:hover:bg-white/5">
      {card.image_uri ? (
        <Image
          src={card.image_uri}
          alt={card.name}
          width={32}
          height={44}
          className="shrink-0 rounded-sm"
          unoptimized
        />
      ) : (
        <div className="flex size-8 shrink-0 items-center justify-center rounded-sm bg-gray-200 dark:bg-gray-800">
          <span className="text-xs text-gray-400">?</span>
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-gray-950 dark:text-white">
          {card.name}
        </p>
        <p className="truncate text-xs text-gray-500 dark:text-gray-400">
          {card.set_name}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <span className="text-xs font-medium tabular-nums text-gray-950 dark:text-white">
          {price != null
            ? `${symbol}${price.toFixed(2)}${suffix}`
            : "--"}
        </span>
        <button
          type="button"
          onClick={() => onRemove(card.id)}
          className="rounded p-0.5 text-gray-400 opacity-0 transition-opacity hover:text-gray-600 group-hover:opacity-100 dark:hover:text-gray-300"
          aria-label={`Remove ${card.name}`}
        >
          <svg className="size-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
