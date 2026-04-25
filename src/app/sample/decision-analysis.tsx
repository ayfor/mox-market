"use client";

import Link from "next/link";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type SVGProps,
} from "react";

/* ────────────────────────────────────────────────────────────
   Mox Market V2 — Decision Analysis page
   Ported from Claude Design handoff. Static sample data;
   wiring to real Scryfall comes with the V2 verdict-engine
   milestone.
   ──────────────────────────────────────────────────────────── */

type Verdict = "buy" | "fair" | "wait";

const CARD = {
  name: "Esper Sentinel",
  set: "Modern Horizons 2",
  collector: "MH2 #012",
  rarity: "Rare",
  type: "Artifact Creature — Human Soldier",
  printing: "First Printing · English",
};

const SETS = [
  { code: "MH2", name: "Modern Horizons 2", collector: "#012" },
  { code: "MH2R", name: "Modern Horizons 2 · Retro", collector: "#321" },
  { code: "2X2", name: "Double Masters 2022", collector: "#007" },
  { code: "PMH2", name: "Promo Pack: MH2", collector: "#012p" },
  { code: "SLD", name: "Secret Lair Drop", collector: "#1423" },
] as const;

type SetCode = (typeof SETS)[number]["code"];

/* ─── Heroicons (outline) — inline ─── */
const Icon = {
  Pencil: (p: SVGProps<SVGSVGElement>) => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...p}
    >
      <path d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Zm0 0L19.5 7.125" />
    </svg>
  ),
  Refresh: (p: SVGProps<SVGSVGElement>) => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...p}
    >
      <path d="M16.023 9.348h4.992V4.356M2.985 19.644v-4.992h4.992m0 0-3.181-3.183a8.25 8.25 0 0 1 13.803-3.7L21 8.25M3 16.356l2.4 2.4a8.25 8.25 0 0 0 13.803-3.7l.022-.06M7.977 14.652H3" />
    </svg>
  ),
  Share: (p: SVGProps<SVGSVGElement>) => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...p}
    >
      <path d="M7.217 10.907a2.25 2.25 0 1 0 0 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186 9.566-5.314m-9.566 7.5 9.566 5.314m0 0a2.25 2.25 0 1 0 3.935 2.186 2.25 2.25 0 0 0-3.935-2.186Zm0-12.814a2.25 2.25 0 1 0 3.933-2.185 2.25 2.25 0 0 0-3.933 2.185Z" />
    </svg>
  ),
  Plus: (p: SVGProps<SVGSVGElement>) => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...p}
    >
      <path d="M12 4.5v15m7.5-7.5h-15" />
    </svg>
  ),
  Arrow: (p: SVGProps<SVGSVGElement>) => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...p}
    >
      <path d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
    </svg>
  ),
  Chevron: (p: SVGProps<SVGSVGElement>) => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...p}
    >
      <path d="m19.5 8.25-7.5 7.5-7.5-7.5" />
    </svg>
  ),
  Check: (p: SVGProps<SVGSVGElement>) => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...p}
    >
      <path d="m4.5 12.75 6 6 9-13.5" />
    </svg>
  ),
  Sparkle: (p: SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="currentColor" {...p}>
      <path d="M12 2l1.8 5.4L19.2 9 13.8 10.8 12 16.2 10.2 10.8 4.8 9l5.4-1.6L12 2z" />
    </svg>
  ),
  Info: (p: SVGProps<SVGSVGElement>) => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...p}
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8.25h.008v.008H12V8.25ZM12 11.25v4.5" />
    </svg>
  ),
};

/* ─── Nav ─── */
function NavBar() {
  return (
    <nav className="mm-nav">
      <Link className="mm-brand" href="/" aria-label="Mox Market home">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/assets/logo-mark.png" width={48} height={48} alt="" />
        <span className="mm-brand-text">Mox Market</span>
      </Link>
      <div className="mm-nav-links" role="tablist">
        <a className="mm-nav-link on" href="#" role="tab" aria-selected="true">
          Evaluate
        </a>
        <a className="mm-nav-link" href="#" role="tab">
          Import
        </a>
        <a className="mm-nav-link" href="#" role="tab">
          About
        </a>
      </div>
      <button type="button" className="mm-nav-cta">
        <span className="mm-nav-cta-ico" aria-hidden="true">
          <Icon.Plus />
        </span>
        <span>New Listing Analysis</span>
      </button>
    </nav>
  );
}

/* ─── Masthead ─── */
function Masthead({
  verdict,
  deltaPct,
  verdictCopy,
}: {
  verdict: Verdict;
  deltaPct: number;
  verdictCopy: { word: string; sub: string };
}) {
  const arrow = deltaPct < 0 ? "↓" : deltaPct > 0 ? "↑" : "↔";
  const lbl =
    deltaPct < 0
      ? "below market"
      : deltaPct > 0
        ? "above market"
        : "at market";

  return (
    <section className="mm-masthead">
      <div className="mm-mast-top">
        <div className="mm-mast-center">
          <div className="mm-card-img" aria-label={CARD.name}>
            <span className="sr-only">{CARD.name}</span>
          </div>
          <div className="mm-card-meta">
            <div className="mm-card-eyebrow">
              <span>{CARD.set}</span>
              <span className="sep">·</span>
              <span>{CARD.collector}</span>
              <span className="sep">·</span>
              <span>{CARD.rarity}</span>
            </div>
            <h1 className="mm-card-name">{CARD.name}</h1>
            <div className="mm-card-type">{CARD.type}</div>

            <div className="mm-verdict-block">
              <div className={`mm-verdict mm-verdict--${verdict}`}>
                <div className="mm-verdict-label">Verdict</div>
                <div className="mm-verdict-word">{verdictCopy.word}</div>
              </div>
              <div className="mm-verdict-meta">
                <div className={`mm-verdict-delta ${verdict}`}>
                  <span className="arrow">{arrow}</span>
                  <span className="num">{Math.abs(deltaPct).toFixed(1)}%</span>
                  <span className="lbl">{lbl}</span>
                  <button
                    type="button"
                    className="mm-verdict-info"
                    aria-label="More context on this verdict"
                    data-tip={verdictCopy.sub}
                  >
                    <Icon.Info />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <aside className="mm-mast-analysis">
          <div className="mm-mast-analysis-inner">
            <div className="mm-mast-analysis-eyebrow">Analysis</div>
            <div className="mm-mast-analysis-row">
              <span className="k">Updated</span>
              <span className="v">2 hrs ago</span>
            </div>
            <div className="mm-mast-analysis-row">
              <span className="k">Source</span>
              <span className="v">Scryfall · TCG Mid</span>
            </div>
            <div className="mm-mast-analysis-row">
              <span className="k">Confidence</span>
              <span className="v">High · 847 listings</span>
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
}

/* ─── Tile 1: Your Price vs Market ─── */
function PriceVsMarketTile({
  yourPrice,
  market,
  onPriceChange,
  setCode,
  onSetChange,
  foil,
  onFoilChange,
}: {
  yourPrice: number;
  market: number;
  onPriceChange: (n: number) => void;
  setCode: SetCode;
  onSetChange: (c: SetCode) => void;
  foil: boolean;
  onFoilChange: (b: boolean) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(yourPrice));
  const [spin, setSpin] = useState(false);
  const [setOpen, setSetOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const setMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!editing) setDraft(String(yourPrice));
  }, [yourPrice, editing]);

  useEffect(() => {
    if (!setOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (
        setMenuRef.current &&
        !setMenuRef.current.contains(e.target as Node)
      ) {
        setSetOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [setOpen]);

  const startEdit = () => {
    setEditing(true);
    setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
  };
  const commit = () => {
    const parsed = parseFloat(String(draft).replace(/[^0-9.]/g, ""));
    if (!isNaN(parsed) && parsed > 0) onPriceChange(parsed);
    setEditing(false);
  };
  const refresh = () => {
    setSpin(true);
    setTimeout(() => setSpin(false), 650);
    commit();
  };

  const activeSet = SETS.find((s) => s.code === setCode) ?? SETS[0];

  return (
    <div className="mm-tile t-price has-agate agate-1">
      <div className="mm-tile-inner">
        <div className="mm-eyebrow">Your Price vs Market</div>
        <div className="t-price-stack">
          <div
            className="t-price-editable"
            onClick={() => !editing && startEdit()}
          >
            {editing ? (
              <input
                ref={inputRef}
                className="val"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commit}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commit();
                  if (e.key === "Escape") {
                    setDraft(String(yourPrice));
                    setEditing(false);
                  }
                }}
              />
            ) : (
              <span className="val-display">${yourPrice.toFixed(2)}</span>
            )}
            <div className="t-price-actions">
              <button
                type="button"
                className="t-price-iconbtn"
                title="Edit price"
                onClick={(e) => {
                  e.stopPropagation();
                  startEdit();
                }}
              >
                <Icon.Pencil />
              </button>
            </div>
          </div>
          <div className="t-price-market">
            Market <strong>${market.toFixed(2)}</strong> · TCG Mid · 30d avg
          </div>
        </div>

        <div className="t-price-listing">
          <div className="t-price-listing-field" ref={setMenuRef}>
            <label className="t-price-listing-label">Printing / Set</label>
            <button
              type="button"
              className={"t-price-select" + (setOpen ? " open" : "")}
              onClick={() => setSetOpen((o) => !o)}
              aria-haspopup="listbox"
              aria-expanded={setOpen}
            >
              <span className="t-price-select-code">{activeSet.code}</span>
              <span className="t-price-select-name">{activeSet.name}</span>
              <span className="t-price-select-chev">
                <Icon.Chevron />
              </span>
            </button>
            {setOpen && (
              <div className="t-price-select-menu" role="listbox">
                {SETS.map((s) => (
                  <button
                    key={s.code}
                    type="button"
                    role="option"
                    aria-selected={s.code === setCode}
                    className={
                      "t-price-select-opt" +
                      (s.code === setCode ? " active" : "")
                    }
                    onClick={() => {
                      onSetChange(s.code);
                      setSetOpen(false);
                    }}
                  >
                    <span className="code">{s.code}</span>
                    <span className="name">{s.name}</span>
                    <span className="coll">{s.collector}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <label className={"t-price-foil" + (foil ? " on" : "")}>
            <input
              type="checkbox"
              checked={foil}
              onChange={(e) => onFoilChange(e.target.checked)}
            />
            <span className="t-price-foil-box" aria-hidden="true">
              {foil && <Icon.Check />}
            </span>
            <span className="t-price-foil-label">
              <Icon.Sparkle className="t-price-foil-sparkle" />
              Foil treatment
            </span>
          </label>
        </div>

        <div className="t-price-footer">
          <button
            type="button"
            className={"t-price-resubmit" + (spin ? " spin" : "")}
            onClick={refresh}
          >
            <span className="t-price-resubmit-icon">
              <Icon.Refresh />
            </span>
            <span>Resubmit Analysis</span>
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Tile 2: Trend ─── */
function TrendTile() {
  const rows: { period: string; value: string; dir: "up" | "down" }[] = [
    { period: "7 Days", value: "+3.2%", dir: "up" },
    { period: "30 Days", value: "+8.1%", dir: "up" },
    { period: "90 Days", value: "−2.4%", dir: "down" },
    { period: "1 Year", value: "+14.7%", dir: "up" },
  ];
  return (
    <div className="mm-tile has-agate agate-2">
      <div className="mm-tile-inner">
        <div className="mm-eyebrow">Price Trend</div>
        <div className="t-trend-stack">
          {rows.map((r) => (
            <div key={r.period} className="t-trend-row">
              <div className="t-trend-period">{r.period}</div>
              <div className={"t-trend-value " + r.dir}>
                <span className="arrow">{r.dir === "up" ? "↗" : "↘"}</span>
                <span>{r.value}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─── Tile 3: Prices by Finish ─── */
function FinishTile({ active }: { active: string }) {
  const rows: { name: string; price: string; chip: string | null }[] = [
    { name: "Normal", price: "$81.50", chip: null },
    { name: "Foil", price: "$137.75", chip: null },
    { name: "Retro Frame", price: "$95.00", chip: null },
    { name: "Retro Foil", price: "$210.00", chip: "Rare" },
  ];
  return (
    <div className="mm-tile has-agate agate-3">
      <div className="mm-tile-inner">
        <div className="mm-eyebrow">Prices by Finish</div>
        <div className="t-finish-stack">
          {rows.map((r) => (
            <div
              key={r.name}
              className={"t-finish-row" + (r.name === active ? " active" : "")}
            >
              <div className="t-finish-name">
                <span>{r.name}</span>
                {r.chip && <span className="chip">{r.chip}</span>}
              </div>
              <div className="t-finish-price">{r.price}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─── Chart tile ─── */
type ChartRange = "7D" | "30D" | "90D" | "1Y" | "All";
function ChartTile({
  range,
  setRange,
  yourPrice,
  market,
}: {
  range: ChartRange;
  setRange: (r: ChartRange) => void;
  yourPrice: number;
  market: number;
}) {
  // Chart geometry — virtual viewBox; SVG scales via preserveAspectRatio="none"
  const W = 1200,
    H = 260;
  const padL = 44,
    padR = 0,
    padT = 10,
    padB = 20;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const { path, area, yourY, marketY } = useMemo(() => {
    const n = 90;
    const min = 62,
      max = 92;
    const pts: [number, number, number][] = [];
    let y = 78;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const trend = -4 * (t - 0.5) + (t > 0.7 ? (t - 0.7) * 8 : 0);
      const wob =
        Math.sin(i * 0.42) * 3 +
        Math.cos(i * 0.19) * 2.2 +
        Math.sin(i * 0.07) * 4;
      y = 78 + trend + wob;
      pts.push([
        padL + t * innerW,
        padT + ((max - y) / (max - min)) * innerH,
        y,
      ]);
    }
    const toPath = pts
      .map((p, i) => (i === 0 ? `M${p[0]},${p[1]}` : `L${p[0]},${p[1]}`))
      .join(" ");
    const area =
      toPath +
      ` L${padL + innerW},${padT + innerH} L${padL},${padT + innerH} Z`;
    const yourY = padT + ((max - yourPrice) / (max - min)) * innerH;
    const marketY = padT + ((max - market) / (max - min)) * innerH;
    return { path: toPath, area, yourY, marketY };
  }, [yourPrice, market]);

  const yLabels = ["$92", "$85", "$78", "$70", "$62"];
  const xLabelsByRange: Record<ChartRange, string[]> = {
    "7D": ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    "30D": ["30d ago", "24d", "18d", "12d", "6d", "Today"],
    "90D": ["Aug", "Sep", "Oct", "Nov", "Today"],
    "1Y": ["Nov", "Feb", "May", "Aug", "Today"],
    All: ["2021", "2022", "2023", "2024", "Today"],
  };
  const xLabels = xLabelsByRange[range];

  return (
    <div className="mm-tile t-chart has-agate agate-hero">
      <div className="mm-tile-inner">
        <div className="t-chart-header">
          <div className="mm-eyebrow">Price History</div>
          <div className="t-toggle">
            {(["7D", "30D", "90D", "1Y", "All"] as ChartRange[]).map((r) => (
              <button
                key={r}
                className={range === r ? "on" : ""}
                onClick={() => setRange(r)}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
        <div className="t-chart-body">
          <div className="t-chart-y">
            {yLabels.map((l) => (
              <div key={l} className="t-chart-y-label">
                {l}
              </div>
            ))}
          </div>
          <svg
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            className="t-chart-svg"
          >
            <defs>
              <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#1e3a8a" stopOpacity="0.45" />
                <stop offset="100%" stopColor="#1e3a8a" stopOpacity="0" />
              </linearGradient>
              <pattern
                id="gridPat"
                width="100"
                height="60"
                patternUnits="userSpaceOnUse"
              >
                <path
                  d="M 100 0 L 0 0 0 60"
                  fill="none"
                  stroke="rgba(255,255,255,.03)"
                  strokeWidth="1"
                />
              </pattern>
            </defs>

            <rect
              x={padL}
              y={padT}
              width={innerW}
              height={innerH}
              fill="url(#gridPat)"
            />
            {[0.25, 0.5, 0.75].map((t) => (
              <line
                key={t}
                x1={padL}
                x2={padL + innerW}
                y1={padT + t * innerH}
                y2={padT + t * innerH}
                stroke="rgba(255,255,255,.05)"
                strokeDasharray="2 6"
              />
            ))}

            <line
              x1={padL}
              x2={padL + innerW}
              y1={marketY}
              y2={marketY}
              stroke="rgba(30,58,138,.55)"
              strokeWidth="1"
              strokeDasharray="4 4"
            />
            <line
              x1={padL}
              x2={padL + innerW}
              y1={yourY}
              y2={yourY}
              stroke="rgba(158,0,49,.65)"
              strokeWidth="1"
              strokeDasharray="4 4"
            />

            <path d={area} fill="url(#areaFill)" />
            <path
              d={path}
              stroke="#5477c4"
              strokeWidth="2"
              fill="none"
              strokeLinejoin="round"
            />

            <circle
              cx={padL + innerW}
              cy={marketY}
              r="5"
              fill="#5477c4"
              stroke="#0c0c0c"
              strokeWidth="2"
            />
          </svg>

          <div
            className="t-chart-your-label"
            style={{ top: `calc(${(yourY / H) * 100}% - 1px)` }}
          >
            <span className="you">You</span>${yourPrice.toFixed(2)}
          </div>
          <div
            className="t-chart-market-label"
            style={{ top: `calc(${(marketY / H) * 100}% - 1px)` }}
          >
            Market ${market.toFixed(2)}
          </div>

          <div className="t-chart-x">
            {xLabels.map((l) => (
              <div key={l} className="t-chart-x-label">
                {l}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Range tile ─── */
function RangeTile({
  yourPrice,
  verdict,
}: {
  yourPrice: number;
  verdict: Verdict;
}) {
  const low = 72.5,
    avg = 81.5,
    high = 94.0;
  const pct = Math.max(0, Math.min(1, (yourPrice - low) / (high - low))) * 100;
  const avgPct = ((avg - low) / (high - low)) * 100;
  const zone = pct < 33 ? "lowest" : pct < 66 ? "middle" : "highest";
  return (
    <div className="mm-tile t-range has-agate agate-verdict">
      <div className="mm-tile-inner">
        <div className="mm-eyebrow">30-Day Price Range</div>
        <div className="t-range-top">
          <div className="t-range-stat">
            <span className="k">Low</span>
            <span className="v">$72.50</span>
          </div>
          <div className="t-range-stat muted">
            <span className="k">Average</span>
            <span className="v">$81.50</span>
          </div>
          <div className="t-range-stat muted">
            <span className="k">High</span>
            <span className="v">$94.00</span>
          </div>
        </div>
        <div className="t-range-bar">
          <div className="t-range-bar-avg" style={{ left: `${avgPct}%` }} />
          <div
            className={"t-range-bar-dot " + verdict}
            style={{ left: `${pct}%` }}
          />
        </div>
        <div className="t-range-tickrow">
          <span className="t-range-tick">$72.50</span>
          <span className="t-range-tick">$81.50 AVG</span>
          <span className="t-range-tick">$94.00</span>
        </div>
        <div className="t-range-legend">
          <span className={"dot " + verdict} />
          <span>
            Your price{" "}
            <strong
              style={{
                color: "var(--fg-primary)",
                fontWeight: 500,
                marginLeft: 4,
              }}
            >
              ${yourPrice.toFixed(2)}
            </strong>{" "}
            sits in the {zone} quartile of the 30-day range.
          </span>
        </div>
      </div>
    </div>
  );
}

/* ─── Actions tile ─── */
function ActionsTile() {
  return (
    <div className="mm-tile t-actions">
      <div className="mm-tile-inner">
        <div className="mm-eyebrow">Next Actions</div>
        <div className="t-actions-buttons">
          <button className="t-btn primary" type="button">
            <span>Add to Watchlist</span>
            <span className="arrow">
              <Icon.Plus />
            </span>
          </button>
          <button className="t-btn secondary" type="button">
            <span>Check Another Card</span>
            <span className="arrow">
              <Icon.Arrow />
            </span>
          </button>
          <button className="t-btn secondary" type="button">
            <span>Share This Analysis</span>
            <span className="arrow">
              <Icon.Share />
            </span>
          </button>
        </div>
        <div className="t-actions-foot">
          Prices aggregated from Scryfall across TCGplayer, CardKingdom and
          CardMarket. Updated every 4 hours. Not financial advice.
        </div>
      </div>
    </div>
  );
}

/* ─── App ─── */
export function DecisionAnalysis() {
  // Sample data — matches the handoff defaults
  const [yourPrice, setYourPrice] = useState(74.99);
  const market = 81.5;
  const [setCode, setSetCode] = useState<SetCode>("MH2");
  const [foil, setFoil] = useState(false);
  const [range, setRange] = useState<ChartRange>("1Y");

  const deltaPct = ((yourPrice - market) / market) * 100;
  const verdict: Verdict =
    deltaPct < -2 ? "buy" : Math.abs(deltaPct) <= 2 ? "fair" : "wait";
  const verdictCopy =
    verdict === "buy"
      ? {
          word: "Buy Now",
          sub: `${Math.abs(deltaPct).toFixed(1)}% below market with a rising 30-day trend.`,
        }
      : verdict === "fair"
        ? {
            word: "Fair Price",
            sub: `Within ${Math.abs(deltaPct).toFixed(1)}% of the 30-day market average.`,
          }
        : {
            word: "Wait",
            sub: `${Math.abs(deltaPct).toFixed(1)}% above market. Consider waiting for a dip.`,
          };

  const finishActive = foil ? "Foil" : "Normal";

  return (
    <div className="mm-app">
      <div className="mm-stage">
        <NavBar />
        <Masthead
          verdict={verdict}
          deltaPct={deltaPct}
          verdictCopy={verdictCopy}
        />
        <div className="mm-bento">
          <section className="mm-bento-top">
            <PriceVsMarketTile
              yourPrice={yourPrice}
              market={market}
              onPriceChange={setYourPrice}
              setCode={setCode}
              onSetChange={setSetCode}
              foil={foil}
              onFoilChange={setFoil}
            />
            <TrendTile />
            <FinishTile active={finishActive} />
          </section>
          <section>
            <ChartTile
              range={range}
              setRange={setRange}
              yourPrice={yourPrice}
              market={market}
            />
          </section>
          <section className="mm-bento-bottom">
            <RangeTile yourPrice={yourPrice} verdict={verdict} />
            <ActionsTile />
          </section>
        </div>
      </div>
    </div>
  );
}
