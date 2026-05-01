"use client";

import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type SVGProps,
} from "react";

import { NavBar } from "@/components/nav-bar";

/* ────────────────────────────────────────────────────────────
   Mox Market V2 — /evaluate
   Utility entry point for returning users.

   Ported from the Claude Design handoff (2026-05-01).
   - Form submit navigates to /[card]?price=X (live route lands in Phase 1
     of the V2 sprint).
   - Recent evaluations persist in localStorage. No sample-data seeding —
     real users start with the empty state.
   - Verdict math is mocked here for the recent-list display only; real
     verdict comes from the algorithm in src/lib/verdict.ts (Phase 1).
   ──────────────────────────────────────────────────────────── */

const STORAGE_KEY = "mm-recent-v2";
const STALE_MS = 24 * 60 * 60 * 1000; // 24h

type Verdict = "buy" | "fair" | "wait";

type RecentEvaluation = {
  id: string;
  name: string;
  set: string;
  setFull: string;
  finish: string;
  yourPrice: number;
  marketPrice: number;
  verdict: Verdict;
  timestamp: number;
};

function formatTimeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function fmtPrice(n: number): string {
  return `$${n.toFixed(2)}`;
}

/* ─── Icons (heroicons-style, inline for zero deps) ─── */

const ArrowRightIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 20 20" fill="none" {...p}>
    <path
      d="M4 10h12m0 0l-5-5m5 5l-5 5"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/* ─── Hero — page header ─── */

function Hero() {
  return (
    <section className="mm-hero">
      <div className="mm-hero-text">
        <div className="mm-hero-eyebrow">Evaluate</div>
        <h1 className="mm-hero-headline">Evaluate a card.</h1>
        <p className="mm-hero-subhead">
          Enter a card and a price. We&rsquo;ll tell you whether it&rsquo;s a
          deal.
        </p>
      </div>
      <svg
        className="mm-hero-hex"
        viewBox="0 0 96 96"
        aria-hidden="true"
      >
        <polygon
          points="48,4 88,26 88,70 48,92 8,70 8,26"
          fill="none"
          stroke="rgba(254,255,254,0.5)"
          strokeWidth="1"
        />
        <polygon
          points="48,18 76,33 76,63 48,78 20,63 20,33"
          fill="none"
          stroke="rgba(158,0,49,0.55)"
          strokeWidth="1"
        />
        <polygon
          points="48,32 64,40 64,56 48,64 32,56 32,40"
          fill="none"
          stroke="rgba(254,255,254,0.3)"
          strokeWidth="1"
        />
      </svg>
    </section>
  );
}

/* ─── Form panel ─── */

type FormPanelProps = {
  onSubmit: (input: { name: string; price: number }) => void;
};

function FormPanel({ onSubmit }: FormPanelProps) {
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const n = name.trim();
    const p = parseFloat(price);
    if (!n || !p || p <= 0) return;
    onSubmit({ name: n, price: p });
  };

  const canSubmit = name.trim().length > 0 && parseFloat(price) > 0;

  return (
    <form className="mm-form-panel" onSubmit={handleSubmit}>
      <div className="mm-form-row">
        <div className="mm-field mm-field--grow">
          <label className="mm-field-label" htmlFor="card-name">
            Card Name
          </label>
          <input
            ref={nameRef}
            id="card-name"
            className="mm-input"
            type="text"
            placeholder="Card name…"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="off"
          />
        </div>
        <div className="mm-field mm-field--price">
          <label className="mm-field-label" htmlFor="your-price">
            Your Price
          </label>
          <input
            id="your-price"
            className="mm-input"
            type="text"
            inputMode="decimal"
            placeholder="$ 0.00"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
        </div>
        <div className="mm-field mm-field--btn">
          <button
            type="submit"
            className="mm-evaluate-btn"
            disabled={!canSubmit}
          >
            Evaluate
            <ArrowRightIcon />
          </button>
        </div>
      </div>
      <div className="mm-form-hint">
        Press <kbd>Enter</kbd> to evaluate · <kbd>Tab</kbd> between fields.
      </div>
    </form>
  );
}

/* ─── Verdict pill (compact) ─── */

const VERDICT_LABEL: Record<Verdict, string> = {
  buy: "Buy",
  fair: "Fair",
  wait: "Wait",
};

function VerdictPill({ verdict, stale }: { verdict: Verdict; stale: boolean }) {
  return (
    <span className="mm-pill-wrap">
      <span className={`mm-pill mm-pill--${verdict}`}>
        {VERDICT_LABEL[verdict]}
      </span>
      {stale && (
        <span
          className="mm-stale"
          aria-label="Stale verdict — re-run for current"
        >
          i
        </span>
      )}
    </span>
  );
}

/* ─── Card thumbnail (placeholder until Scryfall image is wired) ─── */

function CardThumb() {
  return (
    <div className="mm-recent-thumb" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="rgba(254,255,254,0.6)">
        <path d="M12 1 L22 7 L22 17 L12 23 L2 17 L2 7 Z" />
      </svg>
    </div>
  );
}

/* ─── Recent row ─── */

type RecentRowProps = {
  row: RecentEvaluation;
  onRemove: (id: string) => void;
  onClick: (row: RecentEvaluation) => void;
};

function RecentRow({ row, onRemove, onClick }: RecentRowProps) {
  const stale = Date.now() - row.timestamp > STALE_MS;
  return (
    <a
      className="mm-recent-row"
      href={`/${encodeURIComponent(row.name)}?price=${row.yourPrice}&finish=${row.finish}`}
      onClick={(e) => {
        e.preventDefault();
        onClick(row);
      }}
    >
      <CardThumb />
      <div className="mm-recent-meta">
        <div className="mm-recent-name">{row.name}</div>
        <div className="mm-recent-set">
          {row.set} · {row.finish}
        </div>
      </div>
      <div>
        <span className="mm-recent-price mm-recent-price--your">
          {fmtPrice(row.yourPrice)}
        </span>
        <span className="mm-recent-price-label">your</span>
      </div>
      <div>
        <span className="mm-recent-price mm-recent-price--market">
          {fmtPrice(row.marketPrice)}
        </span>
        <span className="mm-recent-price-label">market</span>
      </div>
      <VerdictPill verdict={row.verdict} stale={stale} />
      <span className="mm-recent-time">{formatTimeAgo(row.timestamp)}</span>
      <button
        type="button"
        className="mm-recent-remove"
        aria-label="Remove from recent"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onRemove(row.id);
        }}
      >
        ×
      </button>
    </a>
  );
}

/* ─── Recent section (or empty state) ─── */

type RecentSectionProps = {
  rows: RecentEvaluation[];
  onRemove: (id: string) => void;
  onRowClick: (row: RecentEvaluation) => void;
  onClearAll: () => void;
};

function RecentSection({
  rows,
  onRemove,
  onRowClick,
  onClearAll,
}: RecentSectionProps) {
  if (rows.length === 0) {
    return (
      <div className="mm-empty">
        <h2 className="mm-empty-headline">No recent evaluations yet.</h2>
        <p className="mm-empty-sub">
          Run an evaluation above — we&rsquo;ll keep your last five here.
        </p>
      </div>
    );
  }
  return (
    <section className="mm-recent">
      <div className="mm-recent-header">
        <div className="mm-recent-eyebrow">Recent Evaluations</div>
        <button
          type="button"
          className="mm-recent-clear"
          onClick={onClearAll}
        >
          Clear all
        </button>
      </div>
      <div className="mm-recent-stack">
        {rows.slice(0, 5).map((row) => (
          <RecentRow
            key={row.id}
            row={row}
            onRemove={onRemove}
            onClick={onRowClick}
          />
        ))}
      </div>
    </section>
  );
}

/* ─── Footer ─── */

function Footer() {
  return (
    <footer className="mm-footer">
      Prices aggregated from Scryfall across TCGplayer, CardKingdom and
      CardMarket. Updated every 4 hours. Not financial advice.
    </footer>
  );
}

/* ─── Page ─── */

export function EvaluatePageClient() {
  const router = useRouter();
  const [recent, setRecent] = useState<RecentEvaluation[]>([]);

  // Hydrate from localStorage on mount (avoid SSR hydration mismatch by
  // starting empty server-side, then loading client-side).
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as RecentEvaluation[];
        if (Array.isArray(parsed)) setRecent(parsed);
      }
    } catch {
      /* ignore corrupt localStorage */
    }
  }, []);

  // Persist on every change
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(recent));
    } catch {
      /* localStorage unavailable; in-memory only */
    }
  }, [recent]);

  const handleSubmit = useCallback(
    ({ name, price }: { name: string; price: number }) => {
      // Mock a market lookup so the recent-list shows a realistic verdict.
      // In Phase 1, the actual verdict will be computed on /[card] from
      // Scryfall + MTGJson data via src/lib/verdict.ts.
      const market = +(price * (0.85 + Math.random() * 0.35)).toFixed(2);
      const deltaPct = ((price - market) / market) * 100;
      let verdict: Verdict = "fair";
      if (deltaPct < -3) verdict = "buy";
      else if (deltaPct > 3) verdict = "wait";

      const newRow: RecentEvaluation = {
        id: `r${Date.now()}`,
        name,
        set: "—",
        setFull: "—",
        finish: "Normal",
        yourPrice: price,
        marketPrice: market,
        verdict,
        timestamp: Date.now(),
      };
      setRecent((prev) => [newRow, ...prev].slice(0, 5));

      // Navigate to the live analysis page (Phase 1 of V2 wires this up).
      router.push(
        `/${encodeURIComponent(name)}?price=${price}`,
      );
    },
    [router],
  );

  const handleRemove = useCallback((id: string) => {
    setRecent((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const handleRowClick = useCallback(
    (row: RecentEvaluation) => {
      router.push(
        `/${encodeURIComponent(row.name)}?price=${row.yourPrice}&finish=${row.finish}`,
      );
    },
    [router],
  );

  const handleClearAll = useCallback(() => {
    setRecent([]);
  }, []);

  return (
    <div className="mm-app">
      <NavBar active="evaluate" />
      <div className="mm-stage">
        <Hero />
        <FormPanel onSubmit={handleSubmit} />
        <RecentSection
          rows={recent}
          onRemove={handleRemove}
          onRowClick={handleRowClick}
          onClearAll={handleClearAll}
        />
        <Footer />
      </div>
    </div>
  );
}
