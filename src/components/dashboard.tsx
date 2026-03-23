"use client";

import { getCollection } from "@/lib/scryfall";
import { useWatchlistStore } from "@/store/watchlist";
import type { Currency, WatchlistCard } from "@/types/scryfall";
import { clsx } from "clsx";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

// ----- Helpers -----

function getPriceForCurrency(
  card: WatchlistCard,
  currency: Currency,
): number | null {
  switch (currency) {
    case "usd":
      return card.current_prices.usd;
    case "cad":
      return card.current_prices.cad;
    case "eur":
      return card.current_prices.eur;
    case "tix":
      return card.current_prices.tix;
  }
}

function formatPrice(value: number | null, currency: Currency): string {
  if (value == null) return "--";
  const symbol =
    currency === "usd" || currency === "cad"
      ? "$"
      : currency === "eur"
        ? "\u20AC"
        : "";
  const suffix = currency === "tix" ? " tix" : "";
  const prefix = currency === "cad" ? "CA" : "";
  return `${prefix}${symbol}${value.toFixed(2)}${suffix}`;
}

function currencyLabel(currency: Currency): string {
  return currency.toUpperCase();
}

type SortKey = "name" | "price" | "added";
type SortDir = "asc" | "desc";

// ----- Stats Bar -----

function StatsBar({
  cards,
  currency,
}: {
  cards: WatchlistCard[];
  currency: Currency;
}) {
  const totalValue = useMemo(() => {
    return cards.reduce((sum, card) => {
      const price = getPriceForCurrency(card, currency);
      return sum + (price ?? 0);
    }, 0);
  }, [cards, currency]);

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard
        label="Total Value"
        value={formatPrice(totalValue, currency)}
      />
      <StatCard
        label="Cards Tracked"
        value={cards.length.toString()}
      />
      <StatCard
        label="Biggest Gainer"
        value={cards.length > 0 ? getMoverName(cards, currency, "gain") : "--"}
        accent={cards.length > 0 ? "emerald" : undefined}
      />
      <StatCard
        label="Biggest Loser"
        value={cards.length > 0 ? getMoverName(cards, currency, "loss") : "--"}
        accent={cards.length > 0 ? "ruby" : undefined}
      />
    </div>
  );
}

function getMoverName(
  cards: WatchlistCard[],
  currency: Currency,
  direction: "gain" | "loss",
): string {
  // With only current snapshot data, we can't compute real gainers/losers yet.
  // Once we have multiple snapshots, this will compare first vs latest.
  // For now, show the highest/lowest priced card as a placeholder.
  let target: WatchlistCard | null = null;
  let targetPrice = direction === "gain" ? -Infinity : Infinity;

  for (const card of cards) {
    const price = getPriceForCurrency(card, currency);
    if (price == null) continue;

    if (direction === "gain" && price > targetPrice) {
      targetPrice = price;
      target = card;
    }
    if (direction === "loss" && price < targetPrice) {
      targetPrice = price;
      target = card;
    }
  }

  return target ? target.name : "--";
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: "emerald" | "ruby";
}) {
  return (
    <div className="rounded-lg border border-gray-950/10 p-4 dark:border-white/10">
      <p className="text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
        {label}
      </p>
      <p
        className={clsx(
          "mt-1 truncate text-2xl font-semibold tabular-nums",
          accent === "emerald"
            ? "text-mox-emerald-light"
            : accent === "ruby"
              ? "text-mox-ruby-light"
              : "text-gray-950 dark:text-white",
        )}
      >
        {value}
      </p>
    </div>
  );
}

// ----- Currency Selector -----

function CurrencySelector({
  value,
  onChange,
}: {
  value: Currency;
  onChange: (c: Currency) => void;
}) {
  const currencies: Currency[] = ["usd", "cad", "eur", "tix"];
  return (
    <div className="flex rounded-lg border border-gray-950/10 dark:border-white/10">
      {currencies.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          className={clsx(
            "px-3 py-1 text-xs font-semibold uppercase transition-colors first:rounded-l-lg last:rounded-r-lg",
            c === value
              ? "bg-mox-sapphire text-white"
              : "text-gray-500 hover:text-gray-950 dark:text-gray-400 dark:hover:text-white",
          )}
        >
          {currencyLabel(c)}
        </button>
      ))}
    </div>
  );
}

// ----- Sort Controls -----

function SortControls({
  sortKey,
  sortDir,
  onSort,
}: {
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
}) {
  const options: { key: SortKey; label: string }[] = [
    { key: "name", label: "Name" },
    { key: "price", label: "Price" },
    { key: "added", label: "Date Added" },
  ];

  return (
    <div className="flex items-center gap-1">
      <span className="text-xs text-gray-500 dark:text-gray-400">Sort:</span>
      {options.map(({ key, label }) => (
        <button
          key={key}
          type="button"
          onClick={() => onSort(key)}
          className={clsx(
            "rounded px-2 py-0.5 text-xs font-medium transition-colors",
            key === sortKey
              ? "bg-gray-950/10 text-gray-950 dark:bg-white/10 dark:text-white"
              : "text-gray-500 hover:text-gray-950 dark:text-gray-400 dark:hover:text-white",
          )}
        >
          {label}
          {key === sortKey && (
            <span className="ml-0.5">{sortDir === "asc" ? "\u2191" : "\u2193"}</span>
          )}
        </button>
      ))}
    </div>
  );
}

// ----- Sparkline -----

function PriceSparkline({
  snapshots,
  currency,
}: {
  snapshots: WatchlistCard["snapshots"];
  currency: Currency;
}) {
  const data = useMemo(() => {
    return snapshots.map((s) => {
      let value: number | null = null;
      switch (currency) {
        case "usd":
          value = s.prices.usd;
          break;
        case "cad":
          value = s.prices.cad;
          break;
        case "eur":
          value = s.prices.eur;
          break;
        case "tix":
          value = s.prices.tix;
          break;
      }
      return { time: s.timestamp, value: value ?? 0 };
    });
  }, [snapshots, currency]);

  if (data.length < 2) {
    return (
      <span className="text-xs text-gray-400 dark:text-gray-500">
        1 snapshot
      </span>
    );
  }

  const trend = data[data.length - 1].value >= data[0].value;

  return (
    <div className="h-8 w-20">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <YAxis domain={["dataMin", "dataMax"]} hide />
          <Tooltip
            content={({ payload }) => {
              if (!payload?.[0]) return null;
              const val = payload[0].value as number;
              return (
                <div className="rounded bg-gray-900 px-2 py-1 text-xs text-white shadow">
                  {formatPrice(val, currency)}
                </div>
              );
            }}
          />
          <Line
            type="monotone"
            dataKey="value"
            stroke={trend ? "var(--color-mox-emerald-light)" : "var(--color-mox-ruby-light)"}
            strokeWidth={1.5}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ----- Expanded Price Chart -----

function PriceChart({
  snapshots,
  currency,
}: {
  snapshots: WatchlistCard["snapshots"];
  currency: Currency;
}) {
  const data = useMemo(() => {
    return snapshots.map((s) => {
      let value: number | null = null;
      switch (currency) {
        case "usd": value = s.prices.usd; break;
        case "cad": value = s.prices.cad; break;
        case "eur": value = s.prices.eur; break;
        case "tix": value = s.prices.tix; break;
      }
      return {
        time: s.timestamp,
        date: new Date(s.timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        value: value ?? 0,
      };
    });
  }, [snapshots, currency]);

  if (data.length < 2) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-gray-400 dark:text-gray-500">
        Not enough data for a chart yet. Refresh prices to collect snapshots.
      </div>
    );
  }

  const trend = data[data.length - 1].value >= data[0].value;
  const color = trend ? "var(--color-mox-emerald-light)" : "var(--color-mox-ruby-light)";
  const fillColor = trend ? "var(--color-mox-emerald)" : "var(--color-mox-ruby)";

  return (
    <div className="h-48">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
          <defs>
            <linearGradient id={`gradient-${trend ? "up" : "down"}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={fillColor} stopOpacity={0.3} />
              <stop offset="100%" stopColor={fillColor} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-gray-800)" strokeOpacity={0.3} />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 10, fill: "var(--color-gray-500)" }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            domain={["dataMin - 0.1", "dataMax + 0.1"]}
            tick={{ fontSize: 10, fill: "var(--color-gray-500)" }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => formatPrice(v, currency)}
            width={60}
          />
          <Tooltip
            content={({ payload, label }) => {
              if (!payload?.[0]) return null;
              const val = payload[0].value as number;
              return (
                <div className="rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-xs text-white shadow-lg">
                  <p className="text-gray-400">{label}</p>
                  <p className="mt-0.5 text-sm font-semibold">{formatPrice(val, currency)}</p>
                </div>
              );
            }}
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={2}
            fill={`url(#gradient-${trend ? "up" : "down"})`}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// ----- Price Change Badge -----

function PriceChangeBadge({
  snapshots,
  currency,
}: {
  snapshots: WatchlistCard["snapshots"];
  currency: Currency;
}) {
  if (snapshots.length < 2) return null;

  const first = snapshots[0];
  const last = snapshots[snapshots.length - 1];

  const getVal = (s: typeof first) => {
    switch (currency) {
      case "usd": return s.prices.usd;
      case "cad": return s.prices.cad;
      case "eur": return s.prices.eur;
      case "tix": return s.prices.tix;
    }
  };

  const firstVal = getVal(first);
  const lastVal = getVal(last);
  if (firstVal == null || lastVal == null || firstVal === 0) return null;

  const change = lastVal - firstVal;
  const pct = (change / firstVal) * 100;
  const isUp = change >= 0;

  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums",
        isUp
          ? "bg-mox-emerald/10 text-mox-emerald-light"
          : "bg-mox-ruby/10 text-mox-ruby-light",
      )}
    >
      {isUp ? "\u2191" : "\u2193"} {Math.abs(pct).toFixed(1)}%
    </span>
  );
}

// ----- Card Table Row -----

function CardTableRow({
  card,
  currency,
  isExpanded,
  onToggle,
}: {
  card: WatchlistCard;
  currency: Currency;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const price = getPriceForCurrency(card, currency);

  return (
    <div className="border-b border-gray-950/5 last:border-0 dark:border-white/5">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-4 px-2 py-3 text-left hover:bg-gray-950/[0.02] dark:hover:bg-white/[0.02]"
      >
        {card.image_uri ? (
          <Image
            src={card.image_uri}
            alt={card.name}
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
            {card.name}
          </p>
          <p className="truncate text-xs text-gray-500 dark:text-gray-400">
            {card.set_name} &middot;{" "}
            <span className="capitalize">{card.rarity}</span>
          </p>
        </div>

        <PriceChangeBadge snapshots={card.snapshots} currency={currency} />
        <PriceSparkline snapshots={card.snapshots} currency={currency} />

        <div className="w-20 text-right">
          <p className="text-sm font-semibold tabular-nums text-gray-950 dark:text-white">
            {formatPrice(price, currency)}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {card.type_line.split("\u2014")[0].trim()}
          </p>
        </div>

        <svg
          className={clsx(
            "size-4 shrink-0 text-gray-400 transition-transform",
            isExpanded && "rotate-180",
          )}
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={2}
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isExpanded && (
        <div className="border-t border-gray-950/5 px-4 py-4 dark:border-white/5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-950 dark:text-white">
              Price History ({card.snapshots.length} snapshots)
            </h3>
            <div className="flex gap-4 text-xs tabular-nums text-gray-500 dark:text-gray-400">
              {card.current_prices.usd != null && <span>USD ${card.current_prices.usd.toFixed(2)}</span>}
              {card.current_prices.eur != null && <span>EUR \u20AC{card.current_prices.eur.toFixed(2)}</span>}
              {card.current_prices.tix != null && <span>{card.current_prices.tix.toFixed(2)} tix</span>}
            </div>
          </div>
          <PriceChart snapshots={card.snapshots} currency={currency} />
          <div className="mt-3 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
            <span>{card.snapshots.length} data points</span>
            <a
              href={`https://scryfall.com/card/${card.set}/${card.collector_number}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-mox-sapphire-light hover:underline"
            >
              View on Scryfall
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

// ----- Main Dashboard -----

export function DashboardContent() {
  const cards = useWatchlistStore((s) => s.cards);
  const currency = useWatchlistStore((s) => s.currency);
  const setCurrency = useWatchlistStore((s) => s.setCurrency);
  const snapshotPrices = useWatchlistStore((s) => s.snapshotPrices);
  const seedDemoHistory = useWatchlistStore((s) => s.seedDemoHistory);
  const lastRefreshed = useWatchlistStore((s) => s.lastRefreshed);

  const [sortKey, setSortKey] = useState<SortKey>("added");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [seeded, setSeeded] = useState(false);

  // Auto-seed demo history on first mount if cards lack snapshots
  useEffect(() => {
    if (!seeded && cards.length > 0 && cards.some((c) => c.snapshots.length < 3)) {
      seedDemoHistory();
      setSeeded(true);
    }
  }, [cards, seeded, seedDemoHistory]);

  const handleRefresh = useCallback(async () => {
    if (isRefreshing || cards.length === 0) return;
    setIsRefreshing(true);
    try {
      const ids = cards.map((c) => ({ id: c.id }));
      const result = await getCollection(ids);
      await snapshotPrices(result.data);
    } catch {
      // Network error — silently fail
    }
    setIsRefreshing(false);
  }, [cards, isRefreshing, snapshotPrices]);

  const handleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "name" ? "asc" : "desc");
    }
  };

  const sortedCards = useMemo(() => {
    const sorted = [...cards];
    sorted.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "name":
          cmp = a.name.localeCompare(b.name);
          break;
        case "price": {
          const pa = getPriceForCurrency(a, currency) ?? 0;
          const pb = getPriceForCurrency(b, currency) ?? 0;
          cmp = pa - pb;
          break;
        }
        case "added":
          cmp = a.added_at - b.added_at;
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [cards, sortKey, sortDir, currency]);

  return (
    <div className="mx-auto max-w-7xl">
      <div className="py-10 sm:py-14">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl/10 font-normal tracking-tight text-gray-950 dark:text-white">
              Price Dashboard
            </h1>
            <p className="mt-4 max-w-xl text-base/7 text-gray-600 dark:text-gray-400">
              {cards.length > 0
                ? `Tracking ${cards.length} card${cards.length !== 1 ? "s" : ""} across your watchlist.`
                : "Add cards to your watchlist to track price movements."}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {cards.length > 0 && (
              <button
                type="button"
                onClick={handleRefresh}
                disabled={isRefreshing}
                className={clsx(
                  "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold",
                  "bg-gray-950 text-white hover:bg-gray-800 dark:bg-gray-700 dark:hover:bg-gray-600",
                  "disabled:opacity-50 disabled:cursor-not-allowed",
                )}
              >
                <svg
                  className={clsx("size-3.5", isRefreshing && "animate-spin")}
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M2.985 19.644l3.182-3.182" />
                </svg>
                {isRefreshing ? "Refreshing..." : "Refresh Prices"}
              </button>
            )}
            <CurrencySelector value={currency} onChange={setCurrency} />
          </div>
        </div>

        {lastRefreshed && (
          <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">
            Last refreshed: {new Date(lastRefreshed).toLocaleTimeString()}
          </p>
        )}

        <div className="mt-10">
          <StatsBar cards={cards} currency={currency} />
        </div>

        {cards.length === 0 ? (
          <div className="mt-10 rounded-lg border border-dashed border-gray-950/10 p-12 text-center dark:border-white/10">
            <div className="mx-auto max-w-sm">
              <svg
                className="mx-auto size-12 text-gray-400 dark:text-gray-500"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z"
                />
              </svg>
              <h3 className="mt-4 text-sm font-semibold text-gray-950 dark:text-white">
                No cards in your watchlist
              </h3>
              <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                Search for cards in the sidebar, or import a decklist to get started.
              </p>
            </div>
          </div>
        ) : (
          <div className="mt-6">
            <div className="flex items-center justify-between">
              <SortControls
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={handleSort}
              />
              <span className="text-xs text-gray-400 dark:text-gray-500">
                {sortedCards.length} card{sortedCards.length !== 1 ? "s" : ""} &middot; click to expand
              </span>
            </div>
            <div className="mt-3 rounded-lg border border-gray-950/10 dark:border-white/10">
              {sortedCards.map((card) => (
                <CardTableRow
                  key={card.id}
                  card={card}
                  currency={currency}
                  isExpanded={expandedId === card.id}
                  onToggle={() => setExpandedId(expandedId === card.id ? null : card.id)}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
