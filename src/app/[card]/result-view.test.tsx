// ResultView by props (S2.1d9): T11 (AC-2), T13 (AC-3, AC-14), T14 (AC-4),
// T15 (AC-6), T16 (AC-7, AC-14), T20 (AC-11, C1.02) and T25 (AC-17, D2).
import {
  MH2_12_ID,
  scryfallCard,
} from "@/lib/__fixtures__/esper-sentinel-prints";
import { RECOMMENDATION_DISCLAIMER, SOURCE_LABEL } from "@/lib/copy/legal";
import type { Evaluation } from "@/lib/evaluation/build-evaluation";
import { EMPTY_TILE_VALUE } from "@/lib/evaluation/tiles";
import { REASON_COPY } from "@/lib/recommendation/copy";
import { computeRecommendation } from "@/lib/recommendation/engine";
import { dailyHistory } from "@/lib/recommendation/fixtures";
import type { Finish, PriceSnapshot } from "@/lib/recommendation/types";
import { UI_COPY } from "@/lib/recommendation/ui-copy";
import type { ScryfallCard } from "@/types/scryfall";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { ResultView } from "./result-view";

const router = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  replace: vi.fn(),
  prefetch: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

beforeEach(() => {
  router.refresh.mockReset();
  router.push.mockReset();
});

const NOW = new Date("2026-10-10T12:00:00.000Z");
const AS_OF = "2026-10-10";
const HOUR = 3_600_000;
const PRINTING = scryfallCard({ id: MH2_12_ID });

interface Options {
  askingPriceCents?: number;
  history?: PriceSnapshot[];
  currentPriceCents?: number | null;
  requestedFinish?: "normal" | "foil";
  appliedFinish?: Finish;
  latestSnapshotAt?: Date | null;
  historyUnavailable?: boolean;
  syncStale?: boolean;
  printing?: ScryfallCard;
}

/** An ok evaluation through the real engine. */
function evaluation(
  options: Options = {},
): Extract<Evaluation, { status: "ok" }> {
  const requestedFinish = options.requestedFinish ?? "normal";
  const appliedFinish = options.appliedFinish ?? requestedFinish;
  const history = options.history ?? dailyHistory(AS_OF, Array(30).fill(5917));
  const latestSnapshotAt =
    options.latestSnapshotAt === undefined
      ? new Date(NOW.getTime() - 3 * HOUR)
      : options.latestSnapshotAt;
  const recommendation = computeRecommendation(
    {
      askingPriceCents: options.askingPriceCents ?? 5400,
      cardId: MH2_12_ID,
      finish: requestedFinish,
    },
    {
      appliedFinish,
      currentPriceCents:
        options.currentPriceCents === undefined
          ? 5917
          : options.currentPriceCents,
      history,
      asOf: AS_OF,
      source: "scryfall",
      latestSnapshotAt,
    },
  );
  return {
    status: "ok",
    printing: options.printing ?? PRINTING,
    requestedFinish,
    appliedFinish,
    recommendation,
    latestSnapshotAt,
    historyUnavailable: options.historyUnavailable ?? false,
    syncStale: options.syncStale ?? false,
    now: NOW,
  };
}

const KINDS = {
  buy: { askingPriceCents: 5400 },
  fair: { askingPriceCents: 5900 },
  wait: { askingPriceCents: 6500 },
} as const;

const insufficient = (options: Options = {}) =>
  evaluation({ history: [], latestSnapshotAt: null, ...options });
const unavailable = () =>
  insufficient({ historyUnavailable: true, syncStale: true });

const panelOf = (container: HTMLElement) =>
  container.querySelector<HTMLElement>(".mm-rec-panel")!;

describe("panel by props (T11, AC-2)", () => {
  test.each(Object.entries(KINDS))(
    "%s: one badge with the kind's label and class, the chip, the visible reason",
    (kind, opts) => {
      const e = evaluation(opts);
      expect(e.recommendation.kind).toBe(kind);
      const { container } = render(<ResultView evaluation={e} />);
      const panel = panelOf(container);
      const badges = panel.querySelectorAll(".mm-rec-badge");
      expect(badges).toHaveLength(1);
      expect(badges[0]).toHaveClass(`mm-rec-badge--${kind}`);
      expect(badges[0]).toHaveTextContent(new RegExp(`^${kind}$`, "i"));
      expect(within(panel).getByText("High confidence")).toBeVisible();
      const reason = panel.querySelector(".mm-rec-reason")!;
      expect(reason).toHaveTextContent(e.recommendation.reason);
      expect(reason).not.toHaveAttribute("title");
      expect(panel.querySelector("[title], [role=tooltip]")).toBeNull();
    },
  );

  test("the chip shows each confidence label", () => {
    const medium = evaluation({
      history: dailyHistory(AS_OF, Array(20).fill(5917)),
    });
    expect(medium.recommendation.confidence).toBe("medium");
    render(<ResultView evaluation={medium} />);
    expect(screen.getByText("Medium confidence")).toBeInTheDocument();
    const low = evaluation({
      history: dailyHistory(AS_OF, Array(10).fill(5917)),
    });
    render(<ResultView evaluation={low} />);
    expect(screen.getByText("Low confidence")).toBeInTheDocument();
  });

  test("four tiles render with their labels and formatted values", () => {
    const rising = dailyHistory(
      AS_OF,
      Array.from({ length: 30 }, (_, i) => 5000 + i * 30),
    );
    const { container } = render(
      <ResultView
        evaluation={evaluation({ history: rising, askingPriceCents: 5400 })}
      />,
    );
    const tiles = [...container.querySelectorAll(".mm-rec-tile")];
    expect(
      tiles.map((t) => t.querySelector(".mm-rec-tile-label")?.textContent),
    ).toEqual(["Vs market", "30-day trend", "30-day range", "Volatility"]);
    const values = tiles.map(
      (t) => t.querySelector(".mm-rec-tile-value")?.textContent,
    );
    expect(values[0]).toBe("−8.7%");
    expect(values[1]).toMatch(/^\+\d+\.\d%$/);
    expect(values[2]).toMatch(/^\d+%$/);
    expect(values[3]).toMatch(/^±\d+%$/);
    expect(tiles[0]).toHaveTextContent("Market $59.17");
    expect(tiles[2]).toHaveTextContent("Low $50.00 · High $58.70");
    expect(container.querySelectorAll(".mm-rec-tile-note")).toHaveLength(0);
  });

  test("a null signal under its minimum renders — with the thin data note", () => {
    const thin = evaluation({
      history: dailyHistory(AS_OF, Array(10).fill(5917)),
    });
    expect(thin.recommendation.signals.rangePosition).toBeNull();
    expect(thin.recommendation.signals.volatility30d).toBeNull();
    const { container } = render(<ResultView evaluation={thin} />);
    for (const id of ["range", "volatility"]) {
      const tile = container.querySelector(`[data-tile="${id}"]`)!;
      expect(tile.querySelector(".mm-rec-tile-value")).toHaveTextContent(
        EMPTY_TILE_VALUE,
      );
      expect(tile.querySelector(".mm-rec-tile-note")).toHaveTextContent(
        UI_COPY.thinDataNote,
      );
    }
    expect(
      container.querySelector('[data-tile="trend"] .mm-rec-tile-note'),
    ).toBeNull();
  });

  test("a flat range on a full window renders — alone, without the thin data note (S2.1d9)", () => {
    const flat = evaluation();
    expect(flat.recommendation.signals.snapshotCount30d).toBe(30);
    expect(flat.recommendation.signals.rangePosition).toBeNull();
    const { container } = render(<ResultView evaluation={flat} />);
    const range = container.querySelector('[data-tile="range"]')!;
    expect(range.querySelector(".mm-rec-tile-value")).toHaveTextContent(
      EMPTY_TILE_VALUE,
    );
    expect(range.querySelector(".mm-rec-tile-note")).toBeNull();
  });
});

describe("insufficient data (T13, AC-3, AC-14)", () => {
  test("the dedicated panel: the insufficient sentence verbatim, no badge, chip or tile", () => {
    const { container } = render(<ResultView evaluation={insufficient()} />);
    const panel = panelOf(container);
    expect(panel).toHaveAttribute("data-kind", "insufficient_data");
    expect(panel.querySelector(".mm-rec-reason")?.textContent).toBe(
      REASON_COPY.insufficientData,
    );
    expect(REASON_COPY.insufficientData).toContain("try a different printing");
    expect(
      panel.querySelector(".mm-rec-badge, .mm-rec-chip, .mm-rec-tile"),
    ).toBeNull();
  });

  test("with historyUnavailable the sentence is replaced by the unavailable note", () => {
    const { container } = render(<ResultView evaluation={unavailable()} />);
    const reason = panelOf(container).querySelector(".mm-rec-reason");
    expect(reason?.textContent).toBe(UI_COPY.historyUnavailable);
    expect(container).not.toHaveTextContent(REASON_COPY.insufficientData);
  });
});

describe("error and not-found states (T14, AC-4; S2.1d6)", () => {
  test("the error panel: the error copy and a retry that refreshes once; nothing partial", () => {
    const { container } = render(
      <ResultView evaluation={{ status: "error" }} />,
    );
    expect(screen.getByText(UI_COPY.errorPanel)).toBeInTheDocument();
    const retry = screen.getByRole("button", { name: "Retry" });
    fireEvent.click(retry);
    expect(router.refresh).toHaveBeenCalledOnce();
    for (const selector of [
      ".mm-card-name",
      ".mm-card-image",
      ".mm-rec-badge",
      ".mm-rec-chip",
      ".mm-rec-reason",
      ".mm-rec-tile",
      ".mm-rec-disclaimer",
      ".mm-data-footer",
    ]) {
      expect(container.querySelector(selector), selector).toBeNull();
    }
    expect(container).not.toHaveTextContent(RECOMMENDATION_DISCLAIMER);
  });

  test("not_found renders only the not-found copy (S2.4 AC-7)", () => {
    const { container } = render(
      <ResultView evaluation={{ status: "not_found" }} />,
    );
    expect(container.textContent).toBe(UI_COPY.cardNotFound);
    expect(container.querySelector('[data-status="not_found"]')).not.toBeNull();
  });

  test("ambiguous renders only the pick-a-suggestion copy (S2.4 AC-6)", () => {
    const { container } = render(
      <ResultView evaluation={{ status: "ambiguous" }} />,
    );
    expect(container.textContent).toBe(UI_COPY.ambiguousCard);
    expect(container.querySelector('[data-status="ambiguous"]')).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  test("error renders the error copy and Retry, never a miss string (S2.4 T13, AC-8)", () => {
    const { container } = render(
      <ResultView evaluation={{ status: "error" }} />,
    );
    expect(container).toHaveTextContent(UI_COPY.errorPanel);
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(container).not.toHaveTextContent(UI_COPY.cardNotFound);
    expect(container).not.toHaveTextContent(UI_COPY.ambiguousCard);
    expect(container.querySelector(".mm-lookup-miss")).toBeNull();
  });

  test("invalid renders only the validation copy", () => {
    const { container } = render(
      <ResultView evaluation={{ status: "invalid" }} />,
    );
    expect(container.textContent).toBe(UI_COPY.validationError);
  });
});

describe("the fallback notice (T15, AC-6)", () => {
  test("fallbackNotice with foil requested reads the Foil notice", () => {
    const e = evaluation({ requestedFinish: "foil", appliedFinish: "normal" });
    expect(e.recommendation.signals.fallbackNotice).toBe(true);
    render(<ResultView evaluation={e} />);
    expect(
      screen.getByText(
        "This printing has no Foil price — showing Normal pricing.",
      ),
    ).toBeInTheDocument();
  });

  test("absent without fallbackNotice", () => {
    const { container } = render(<ResultView evaluation={evaluation()} />);
    expect(container.querySelector(".mm-rec-notice")).toBeNull();
    expect(container).not.toHaveTextContent("showing Normal pricing");
  });
});

describe("data footer and banner (T16, AC-7, AC-14)", () => {
  const variants: [string, Evaluation][] = [
    ["buy", evaluation(KINDS.buy)],
    ["fair", evaluation(KINDS.fair)],
    ["wait", evaluation(KINDS.wait)],
    ["insufficient_data", insufficient()],
    ["unavailable", unavailable()],
  ];

  test.each(variants)(
    "%s renders the source label in a div, never a footer element",
    (_kind, e) => {
      const { container } = render(<ResultView evaluation={e} />);
      const footer = container.querySelector(".mm-data-footer")!;
      expect(footer.tagName).toBe("DIV");
      expect(footer.querySelector(".mm-data-source")?.textContent).toBe(
        SOURCE_LABEL,
      );
      expect(container.querySelector("footer")).toBeNull();
    },
  );

  test("3 hours old with 22 window snapshots: the history line, no flag", () => {
    const e = evaluation({
      history: dailyHistory(AS_OF, Array(22).fill(5917)),
      latestSnapshotAt: new Date(NOW.getTime() - 3 * HOUR),
    });
    const { container } = render(<ResultView evaluation={e} />);
    expect(container.querySelector(".mm-data-history")?.textContent).toBe(
      "Price history: 22 snapshots, newest 3 hours ago",
    );
    expect(container.querySelector(".mm-data-stale")).toBeNull();
  });

  test("37 hours old: the history line and the Over 36 hours old flag", () => {
    const e = evaluation({
      latestSnapshotAt: new Date(NOW.getTime() - 37 * HOUR),
    });
    const { container } = render(<ResultView evaluation={e} />);
    expect(container.querySelector(".mm-data-history")).toHaveTextContent(
      "Price history: 30 snapshots, newest 37 hours ago Over 36 hours old",
    );
    expect(container.querySelector(".mm-data-stale")?.textContent).toBe(
      "Over 36 hours old",
    );
  });

  test("exactly 36 hours old: no flag", () => {
    const e = evaluation({
      latestSnapshotAt: new Date(NOW.getTime() - 36 * HOUR),
    });
    const { container } = render(<ResultView evaluation={e} />);
    expect(container.querySelector(".mm-data-stale")).toBeNull();
  });

  test("latestSnapshotAt null: No price history yet for this printing.", () => {
    const { container } = render(<ResultView evaluation={insufficient()} />);
    expect(container.querySelector(".mm-data-history")?.textContent).toBe(
      UI_COPY.noHistory,
    );
  });

  test("latestSnapshotAt null but rows in the window: no no-history line under a computed panel (ADV-7)", () => {
    const e = evaluation({ latestSnapshotAt: null });
    expect(e.recommendation.kind).toBe("buy");
    const { container } = render(<ResultView evaluation={e} />);
    expect(container).not.toHaveTextContent(UI_COPY.noHistory);
    expect(container.querySelector(".mm-data-history")).toBeNull();
  });

  test("the unavailable variant shows no history line: its reason line says why", () => {
    const { container } = render(<ResultView evaluation={unavailable()} />);
    expect(container.querySelector(".mm-data-history")).toBeNull();
    expect(container).not.toHaveTextContent(UI_COPY.noHistory);
  });

  test.each([
    [true, 1],
    [false, 0],
  ])("syncStale %s → %i banner", (syncStale, count) => {
    const { container } = render(
      <ResultView evaluation={evaluation({ syncStale })} />,
    );
    const banners = [...container.querySelectorAll(".mm-stale-banner")];
    expect(banners).toHaveLength(count);
    if (count) expect(banners[0].textContent).toBe(UI_COPY.staleBanner);
  });
});

describe("the disclaimer sits directly below the reason (T20, AC-11, C1.02)", () => {
  const variants: [string, Evaluation][] = [
    ["buy", evaluation(KINDS.buy)],
    ["fair", evaluation(KINDS.fair)],
    ["wait", evaluation(KINDS.wait)],
    ["insufficient_data", insufficient()],
    ["unavailable", unavailable()],
  ];

  test.each(variants)(
    "%s: the reason's next element is the disclaimer",
    (_kind, e) => {
      const { container } = render(<ResultView evaluation={e} />);
      const reason = container.querySelector(".mm-rec-reason")!;
      const next = reason.nextElementSibling!;
      expect(next).toHaveClass("mm-rec-disclaimer");
      expect(next.textContent).toBe(RECOMMENDATION_DISCLAIMER);
      expect(container.querySelectorAll(".mm-rec-disclaimer")).toHaveLength(1);
    },
  );

  test("inline snapshot of the reason and disclaimer markup per kind", () => {
    const markup = variants.map(([kind, e]) => {
      const { container, unmount } = render(<ResultView evaluation={e} />);
      const reason = container.querySelector(".mm-rec-reason")!;
      const html = `${kind}: ${reason.outerHTML}${reason.nextElementSibling!.outerHTML}`;
      unmount();
      return html;
    });
    expect(markup).toMatchInlineSnapshot(`
      [
        "buy: <p class="mm-rec-reason">9% below market.</p><p class="mm-rec-disclaimer">Recommendations are automated informational signals derived from third-party price data that updates daily. They are estimates, not personalized financial, investment, or purchasing advice, and accuracy is not guaranteed. You are responsible for your own purchase decisions.</p>",
        "fair: <p class="mm-rec-reason">At market price.</p><p class="mm-rec-disclaimer">Recommendations are automated informational signals derived from third-party price data that updates daily. They are estimates, not personalized financial, investment, or purchasing advice, and accuracy is not guaranteed. You are responsible for your own purchase decisions.</p>",
        "wait: <p class="mm-rec-reason">10% above market.</p><p class="mm-rec-disclaimer">Recommendations are automated informational signals derived from third-party price data that updates daily. They are estimates, not personalized financial, investment, or purchasing advice, and accuracy is not guaranteed. You are responsible for your own purchase decisions.</p>",
        "insufficient_data: <p class="mm-rec-reason">We don't have enough pricing data on this printing to give a recommendation — try a different printing.</p><p class="mm-rec-disclaimer">Recommendations are automated informational signals derived from third-party price data that updates daily. They are estimates, not personalized financial, investment, or purchasing advice, and accuracy is not guaranteed. You are responsible for your own purchase decisions.</p>",
        "unavailable: <p class="mm-rec-reason">Price history temporarily unavailable</p><p class="mm-rec-disclaimer">Recommendations are automated informational signals derived from third-party price data that updates daily. They are estimates, not personalized financial, investment, or purchasing advice, and accuracy is not guaranteed. You are responsible for your own purchase decisions.</p>",
      ]
    `);
  });
});

describe("the card header (T25, AC-17, D2)", () => {
  test("the printing's name, the set line and the normal image with the name as alt", () => {
    const { container } = render(<ResultView evaluation={evaluation()} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Esper Sentinel",
    );
    expect(container.querySelector(".mm-card-set")?.textContent).toBe(
      "Modern Horizons 2 (MH2) · #12",
    );
    const img = screen.getByRole("img", { name: "Esper Sentinel" });
    expect(img).toHaveAttribute("src", PRINTING.image_uris!.normal);
  });

  test("the image sits outside the glass panel with no style or filter class (R3, R4)", () => {
    const { container } = render(<ResultView evaluation={evaluation()} />);
    const img = container.querySelector("img")!;
    expect(img.closest(".mm-rec-panel")).toBeNull();
    expect(img).not.toHaveAttribute("style");
    expect(img.className).toBe("mm-card-image");
    expect(img.parentElement?.getAttribute("style")).toBeNull();
  });

  test("a double-faced card uses its front face", () => {
    const front = "https://cards.scryfall.io/normal/front/dfc.jpg";
    const dfc = scryfallCard({
      id: MH2_12_ID,
      name: "Delver of Secrets // Insectile Aberration",
      image_uris: undefined,
      card_faces: [
        {
          object: "card_face",
          name: "Delver of Secrets",
          mana_cost: "{U}",
          type_line: "Creature",
          image_uris: { ...PRINTING.image_uris!, normal: front },
        },
        {
          object: "card_face",
          name: "Insectile Aberration",
          mana_cost: "",
          type_line: "Creature",
          image_uris: { ...PRINTING.image_uris!, normal: "back.jpg" },
        },
      ],
    });
    render(<ResultView evaluation={evaluation({ printing: dfc })} />);
    expect(screen.getByRole("img")).toHaveAttribute("src", front);
  });

  test("no image URI → no img", () => {
    const bare = scryfallCard({ id: MH2_12_ID, image_uris: undefined });
    const { container } = render(
      <ResultView evaluation={evaluation({ printing: bare })} />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Esper Sentinel",
    );
  });
});
