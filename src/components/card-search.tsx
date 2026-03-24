"use client";

import {
  autocomplete,
  getCardImageUri,
  getPrintings,
} from "@/lib/scryfall";
import { setCachedCard } from "@/lib/card-cache";
import { useWatchlistStore } from "@/store/watchlist";
import { SuggestionList, Spinner } from "@/components/suggestion-list";
import type { Currency, ScryfallCard } from "@/types/scryfall";
import { clsx } from "clsx";
import {
  Dialog,
  DialogBackdrop,
  DialogPanel,
  DialogTitle,
} from "@headlessui/react";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// ----- Helpers -----

function getPrice(card: ScryfallCard, cur: Currency): number | null {
  switch (cur) {
    case "usd":
      return card.prices.usd ? parseFloat(card.prices.usd) : null;
    case "cad":
      return card.prices.usd ? parseFloat(card.prices.usd) : null;
    case "eur":
      return card.prices.eur ? parseFloat(card.prices.eur) : null;
    case "tix":
      return card.prices.tix ? parseFloat(card.prices.tix) : null;
  }
}

function formatPrice(value: number | null, cur: Currency): string {
  if (value == null) return "--";
  const symbol =
    cur === "usd" || cur === "cad"
      ? "$"
      : cur === "eur"
        ? "\u20AC"
        : "";
  const suffix = cur === "tix" ? " tix" : "";
  return `${symbol}${value.toFixed(2)}${suffix}`;
}

// ----- Printing Selector Modal -----

function PrintingSelector({
  open,
  onClose,
  cardName,
  printings,
  isLoading,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  cardName: string;
  printings: ScryfallCard[];
  isLoading: boolean;
  onSelect: (card: ScryfallCard) => void;
}) {
  const currency = useWatchlistStore((s) => s.currency);
  const cards = useWatchlistStore((s) => s.cards);
  const [filter, setFilter] = useState("");

  // Reset filter when modal opens
  useEffect(() => {
    if (open) setFilter("");
  }, [open]);

  const filteredPrintings = useMemo(() => {
    if (!filter) return printings;
    const q = filter.toLowerCase();
    return printings.filter(
      (p) =>
        p.set_name.toLowerCase().includes(q) ||
        p.set.toLowerCase().includes(q) ||
        p.collector_number.toLowerCase().includes(q) ||
        (p.artist && p.artist.toLowerCase().includes(q)),
    );
  }, [printings, filter]);

  return (
    <Dialog open={open} onClose={onClose} className="relative z-50">
      <DialogBackdrop className="fixed inset-0 bg-gray-950/50" />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <DialogPanel className="w-full max-w-lg rounded-xl bg-white shadow-2xl dark:bg-gray-900">
          <div className="flex items-center justify-between border-b border-gray-950/10 px-5 py-4 dark:border-white/10">
            <DialogTitle className="text-sm font-semibold text-gray-950 dark:text-white">
              Select printing — {cardName}
            </DialogTitle>
            <button
              type="button"
              onClick={onClose}
              className="rounded p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              aria-label="Close"
            >
              <svg
                className="size-4"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>

          {/* Filter + list using shared SuggestionList */}
          <div className="px-5 pt-3">
            <SuggestionList<ScryfallCard>
              listClassName="max-h-80 overflow-y-auto"
              query={filter}
              onQueryChange={setFilter}
              placeholder="Filter by set name, code, or artist..."
              items={filteredPrintings}
              keyExtractor={(p) => p.id}
              isLoading={isLoading}
              loadingMessage="Loading printings..."
              emptyMessage={
                printings.length === 0
                  ? "No printings found."
                  : "No printings match your filter."
              }
              autoFocus={open}
              isDisabled={(p) => cards.some((c) => c.id === p.id)}
              onSelect={onSelect}
              renderItem={(printing, _highlighted) => {
                const price = getPrice(printing, currency);
                const imageUri = getCardImageUri(printing, "small");
                const alreadyAdded = cards.some(
                  (c) => c.id === printing.id,
                );

                return (
                  <div className="flex w-full items-center gap-3 px-3 py-2.5">
                    {imageUri ? (
                      <Image
                        src={imageUri}
                        alt={`${cardName} (${printing.set_name})`}
                        width={40}
                        height={56}
                        className="shrink-0 rounded"
                        unoptimized
                      />
                    ) : (
                      <div className="flex h-14 w-10 shrink-0 items-center justify-center rounded bg-gray-200 dark:bg-gray-800">
                        <span className="text-xs text-gray-400">?</span>
                      </div>
                    )}

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-gray-950 dark:text-white">
                        {printing.set_name}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        #{printing.collector_number} &middot;{" "}
                        <span className="capitalize">{printing.rarity}</span>
                        {printing.artist && (
                          <> &middot; {printing.artist}</>
                        )}
                      </p>
                    </div>

                    <div className="shrink-0 text-right">
                      <p className="text-sm font-semibold tabular-nums text-gray-950 dark:text-white">
                        {formatPrice(price, currency)}
                      </p>
                      {alreadyAdded && (
                        <p className="text-xs text-gray-400">added</p>
                      )}
                    </div>
                  </div>
                );
              }}
            />
          </div>
          {/* Spacer below the list */}
          <div className="h-3" />
        </DialogPanel>
      </div>
    </Dialog>
  );
}

// ----- Autocomplete suggestion item wrapper -----

interface CardSuggestion {
  name: string;
  isAdded: boolean;
}

// ----- Card Search -----

export function CardSearch({ className }: { className?: string }) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<CardSuggestion[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [addingCard, setAddingCard] = useState<string | null>(null);
  const [cheapestPrinting, setCheapestPrinting] = useState(true);

  // Printing modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [modalCardName, setModalCardName] = useState("");
  const [modalPrintings, setModalPrintings] = useState<ScryfallCard[]>([]);
  const [modalLoading, setModalLoading] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);

  const addCard = useWatchlistStore((s) => s.addCard);
  const cards = useWatchlistStore((s) => s.cards);
  const currency = useWatchlistStore((s) => s.currency);

  // Build suggestion objects from autocomplete names
  const buildSuggestions = useCallback(
    (names: string[]): CardSuggestion[] =>
      names.map((name) => ({
        name,
        isAdded: cards.some((c) => c.name === name),
      })),
    [cards],
  );

  // Debounced autocomplete
  const handleQueryChange = useCallback(
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
        const built = buildSuggestions(results);
        setSuggestions(built);
        setIsOpen(built.length > 0);
        setIsLoading(false);
      }, 200);
    },
    [buildSuggestions],
  );

  // Add a specific card to the watchlist
  const addSpecificCard = useCallback(
    async (card: ScryfallCard) => {
      setCachedCard(card);
      await addCard(card);
    },
    [addCard],
  );

  // Select a card name from autocomplete suggestions
  const handleSelect = useCallback(
    async (suggestion: CardSuggestion) => {
      const name = suggestion.name;
      setIsOpen(false);
      setQuery("");
      setSuggestions([]);

      if (cheapestPrinting) {
        // Auto-add cheapest printing by active currency
        setAddingCard(name);
        try {
          const printings = await getPrintings(name);
          // Filter to printings with a valid price in the active currency
          const priced = printings.filter(
            (p) => getPrice(p, currency) != null,
          );
          if (priced.length > 0) {
            // Sort ascending by price and pick the cheapest
            priced.sort(
              (a, b) =>
                (getPrice(a, currency) as number) -
                (getPrice(b, currency) as number),
            );
            await addSpecificCard(priced[0]);
          }
        } catch {
          // Silently fail
        } finally {
          setAddingCard(null);
          inputRef.current?.focus();
        }
      } else {
        // Open modal to let user pick a printing
        setModalCardName(name);
        setModalOpen(true);
        setModalLoading(true);
        setModalPrintings([]);

        try {
          const printings = await getPrintings(name);
          setModalPrintings(printings);
        } catch {
          setModalPrintings([]);
        } finally {
          setModalLoading(false);
        }
      }
    },
    [cheapestPrinting, addSpecificCard, currency],
  );

  // Handle printing selection from modal
  const handlePrintingSelect = useCallback(
    async (card: ScryfallCard) => {
      setModalOpen(false);
      setAddingCard(card.name);
      try {
        await addSpecificCard(card);
      } catch {
        // Silently fail
      } finally {
        setAddingCard(null);
        inputRef.current?.focus();
      }
    },
    [addSpecificCard],
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

  return (
    <div className={clsx("relative", className)}>
      <SuggestionList<CardSuggestion>
        query={query}
        onQueryChange={handleQueryChange}
        placeholder="Search for a card..."
        items={isOpen ? suggestions : []}
        keyExtractor={(s) => s.name}
        isDisabled={(s) => s.isAdded}
        onSelect={handleSelect}
        inputLoading={isLoading || !!addingCard}
        inputClassName="pr-8"
        highlightedIndex={selectedIndex}
        onKeyDown={handleKeyDown}
        onFocus={() => suggestions.length > 0 && setIsOpen(true)}
        inputRef={inputRef}
        listRef={dropdownRef}
        listClassName="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg bg-white shadow-lg ring-1 ring-gray-950/10 dark:bg-gray-900 dark:ring-white/10"
        emptyMessage=""
        renderItem={(suggestion, highlighted) => (
          <div className="flex w-full items-center gap-2 px-3 py-2">
            <span className="min-w-0 truncate">{suggestion.name}</span>
            {suggestion.isAdded && (
              <span
                className={clsx(
                  "ml-auto shrink-0 text-xs",
                  highlighted ? "text-white/70" : "text-gray-400",
                )}
              >
                added
              </span>
            )}
          </div>
        )}
      />

      {/* Cheapest Printing toggle */}
      <label className="mt-2 flex items-center gap-2">
        <button
          type="button"
          role="switch"
          aria-checked={cheapestPrinting}
          onClick={() => setCheapestPrinting(!cheapestPrinting)}
          className={clsx(
            "relative inline-flex h-4 w-7 shrink-0 rounded-full transition-colors",
            cheapestPrinting
              ? "bg-mox-sapphire"
              : "bg-gray-300 dark:bg-gray-600",
          )}
        >
          <span
            className={clsx(
              "pointer-events-none inline-block size-3 transform rounded-full bg-white shadow transition-transform",
              cheapestPrinting ? "translate-x-3.5" : "translate-x-0.5",
            )}
            style={{ marginTop: "2px" }}
          />
        </button>
        <span className="text-xs text-gray-500 dark:text-gray-400">
          Cheapest printing
        </span>
      </label>

      {addingCard && (
        <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
          Adding {addingCard}...
        </p>
      )}

      {/* Printing selector modal */}
      <PrintingSelector
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        cardName={modalCardName}
        printings={modalPrintings}
        isLoading={modalLoading}
        onSelect={handlePrintingSelect}
      />
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
    current_prices: {
      usd: number | null;
      cad: number | null;
      eur: number | null;
      tix: number | null;
    };
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
          {price != null ? `${symbol}${price.toFixed(2)}${suffix}` : "--"}
        </span>
        <button
          type="button"
          onClick={() => onRemove(card.id)}
          className="rounded p-0.5 text-gray-400 opacity-0 transition-opacity hover:text-gray-600 group-hover:opacity-100 dark:hover:text-gray-300"
          aria-label={`Remove ${card.name}`}
        >
          <svg
            className="size-3.5"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
