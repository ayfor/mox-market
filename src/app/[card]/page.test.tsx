// T19 (AC-9; C1.28 = A; S2.1d18) and T17's page half (AC-8): the result
// page awaited as a function. Bad params never reach Scryfall; a valid query
// streams the panel through a Suspense boundary keyed by the query. S2.4 adds
// T12's page half (AC-6, AC-7: the miss states), T14's (AC-9: a fuzzy hit
// keeps the typed name) and T20 (AC-16: no price, no Scryfall call), with the
// streamed panel awaited through the real getCardByName and fetch mocked.
// S2.3 adds its T14 (AC-2, AC-4, AC-9, AC-10): the printing param and the
// selectors on the settled page.
import { EntryForm } from "@/components/entry-form";
import {
  ESPER_PRINTS_PAGE_1,
  ESPER_PRINTS_PAGE_2_URI,
  ESPER_PRINTS_URI,
  ESPER_SENTINEL_PRINTS,
  MH2_12_ID,
  PLST_ID,
  scryfallCard,
} from "@/lib/__fixtures__/esper-sentinel-prints";
import {
  historyKey,
  keyedHistoryReader,
} from "@/lib/__fixtures__/keyed-history";
import {
  defaultEvaluationDeps,
  type EvaluationDeps,
  type EvaluationQuery,
} from "@/lib/evaluation/build-evaluation";
import { FALLBACK_NOTICE, fillTemplate } from "@/lib/recommendation/copy";
import { dailyHistory } from "@/lib/recommendation/fixtures";
import { FINISH_LABELS, UI_COPY } from "@/lib/recommendation/ui-copy";
import { resultHref } from "@/lib/result-href";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  cloneElement,
  isValidElement,
  Suspense,
  type ReactElement,
  type ReactNode,
} from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import ResultPage, { metadata } from "./page";
import { ResultPanel } from "./result-panel";
import { ResultSlot, SlotSkeleton } from "./result-slot";

const NOT_FOUND = "NEXT_HTTP_ERROR_FALLBACK;404";
const router = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  replace: vi.fn(),
  prefetch: vi.fn(),
}));
const redirect = vi.hoisted(() => vi.fn());
const searchParams = vi.hoisted(() => ({ current: "" }));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(searchParams.current),
  notFound: () => {
    throw new Error("NEXT_HTTP_ERROR_FALLBACK;404");
  },
  redirect,
  permanentRedirect: redirect,
}));
// The throttle spaces real requests 100 ms apart; the page is under test here.
vi.mock("@/lib/throttle", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/throttle")>();
  return { ...actual, throttle: () => Promise.resolve() };
});

const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => {
  fetchMock.mockReset();
  for (const fn of Object.values(router)) fn.mockReset();
  redirect.mockReset();
  window.sessionStorage.clear();
  searchParams.current = "";
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const page = (card: string, search: Record<string, string | string[]> = {}) =>
  ResultPage({
    params: Promise.resolve({ card }),
    searchParams: Promise.resolve(search),
  });

/** Every element in a tree of unrendered elements, depth first. */
function elementsIn(node: ReactNode): ReactElement[] {
  if (Array.isArray(node)) return node.flatMap(elementsIn);
  if (!isValidElement(node)) return [];
  const props = node.props as { children?: ReactNode };
  return [node, ...elementsIn(props.children)];
}

describe("params rejected before any Scryfall call (T19, AC-9)", () => {
  test("a 200-char card throws notFound() with fetch called 0 times", async () => {
    await expect(page("x".repeat(200), { price: "1" })).rejects.toThrow(
      NOT_FOUND,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("a control character or a malformed encoding throws notFound()", async () => {
    await expect(page("Esper%00Sentinel", { price: "1" })).rejects.toThrow(
      NOT_FOUND,
    );
    await expect(page("Esper%E0%A4%A", { price: "1" })).rejects.toThrow(
      NOT_FOUND,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test.each([
    ["an invalid price", { price: "74.999" }, true],
    ["finish=etched", { price: "74.99", finish: "etched" }, true],
    ["a repeated price", { price: ["1", "2"] }, true],
    ["a missing price", {}, false],
  ])(
    "%s → the prefilled entry form (error %s), no result, fetch 0 times",
    async (_name, search, error) => {
      const tree = await page("Esper%20Sentinel", search);
      const elements = elementsIn(tree);
      expect(elements.some((e) => e.type === ResultSlot)).toBe(false);
      expect(elements.some((e) => e.type === ResultPanel)).toBe(false);
      render(tree);
      expect(screen.getByRole("combobox", { name: "Card" })).toHaveValue(
        "Esper Sentinel",
      );
      const typed = Array.isArray(search.price)
        ? search.price[0]
        : (search.price ?? "");
      expect(screen.getByRole("textbox", { name: "Your price" })).toHaveValue(
        typed,
      );
      if (error) {
        expect(screen.getByText(UI_COPY.validationError)).toBeInTheDocument();
      } else {
        expect(screen.queryByText(UI_COPY.validationError)).toBeNull();
        expect(screen.getByRole("button", { name: "Evaluate" })).toBeDisabled();
        expect(screen.getByText(UI_COPY.submitHelper)).toBeInTheDocument();
      }
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  test("metadata: robots noindex, nofollow (C1.28 = A)", () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect(metadata.title).toBe("Evaluation");
  });
});

describe("a valid query (T17, AC-8)", () => {
  test("the entry form is not keyed, so a navigation keeps the user's edits (ADV-8)", async () => {
    const elements = elementsIn(
      await page("Esper%20Sentinel", { price: "74.99" }),
    );
    const form = elements.find((e) => e.type === EntryForm);
    expect(form).toBeDefined();
    expect(form!.key).toBeNull();
  });
  test("the panel sits in a Suspense keyed by paramsKey with the slot's skeleton as fallback, inside ResultSlot", async () => {
    const tree = await page("Esper%20Sentinel", {
      price: "$74.99",
      finish: "foil",
    });
    const elements = elementsIn(tree);
    const slot = elements.find((e) => e.type === ResultSlot);
    expect(slot).toBeDefined();
    const suspense = elementsIn(
      (slot!.props as { children: ReactNode }).children,
    ).find((e) => e.type === Suspense)!;
    expect(suspense.key).toBe("Esper Sentinel|7499|foil|");
    const fallback = (suspense.props as { fallback: ReactElement }).fallback;
    // SlotSkeleton: PanelSkeleton with the banner the last panel showed (S2.3 ADV-1).
    expect(fallback.type).toBe(SlotSkeleton);
    const panel = elementsIn(
      (suspense.props as { children: ReactNode }).children,
    ).find((e) => e.type === ResultPanel)!;
    expect((panel.props as { query: unknown }).query).toEqual({
      card: "Esper Sentinel",
      askingPriceCents: 7499,
      finish: "foil",
      printing: null,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("the Suspense key changes with the query, so a new submit remounts the boundary", async () => {
    const keyOf = async (card: string, search: Record<string, string>) =>
      elementsIn(await page(card, search)).find((e) => e.type === Suspense)!
        .key;
    const base = await keyOf("Esper%20Sentinel", { price: "74.99" });
    expect(await keyOf("Esper%20Sentinel", { price: "$74.99" })).toBe(base);
    expect(await keyOf("Esper%20Sentinel", { price: "75" })).not.toBe(base);
    expect(await keyOf("Esper%20Charm", { price: "74.99" })).not.toBe(base);
  });
});

// --- S2.4: the streamed slot, awaited ---------------------------------------
/**
 * The page tree with every ResultPanel replaced by what it renders, awaited
 * with `deps` (the real Scryfall client, fetch mocked), so RTL can render the
 * whole page as the browser would see it once the stream settles.
 */
async function resolvePanels(
  node: ReactNode,
  deps: EvaluationDeps,
): Promise<ReactNode> {
  if (Array.isArray(node)) {
    return Promise.all(node.map((child) => resolvePanels(child, deps)));
  }
  if (!isValidElement(node)) return node;
  if (node.type === ResultPanel) {
    const { query } = node.props as { query: EvaluationQuery };
    return ResultPanel({ query, deps });
  }
  const { children } = node.props as { children?: ReactNode };
  if (children === undefined) return node;
  const resolved = await resolvePanels(children, deps);
  return cloneElement(
    node,
    undefined,
    ...(Array.isArray(resolved) ? resolved : [resolved]),
  );
}

const scryfall404 = (type?: string) =>
  new Response(
    JSON.stringify({
      object: "error",
      code: "not_found",
      status: 404,
      ...(type === undefined ? {} : { type }),
      details: "x",
    }),
    { status: 404, headers: { "Content-Type": "application/json" } },
  );

/** Renders the settled page with the real client; returns the log. */
async function renderSettled(
  card: string,
  search: Record<string, string>,
  overrides: Partial<EvaluationDeps> = {},
): Promise<ReturnType<typeof vi.fn>> {
  const log = vi.fn();
  const deps: EvaluationDeps = { ...defaultEvaluationDeps, ...overrides, log };
  render(await resolvePanels(await page(card, search), deps));
  return log;
}

const cardInput = () => screen.getByRole("combobox", { name: "Card" });
const priceInput = () => screen.getByRole("textbox", { name: "Your price" });

describe("lookup misses on the page (T12, AC-6, AC-7, AC-10)", () => {
  test.each<[string, string | undefined, string]>([
    ["jace", "ambiguous", UI_COPY.ambiguousCard],
    ["asdfqwer", undefined, UI_COPY.cardNotFound],
  ])(
    "%j (type %s): the prefilled form and the message tied to the card field; no panel, skeleton, error or Retry",
    async (card, type, message) => {
      fetchMock.mockResolvedValue(scryfall404(type));
      const log = await renderSettled(card, { price: "$5" });
      expect(cardInput()).toHaveValue(card);
      expect(priceInput()).toHaveValue("5");
      const text = screen.getByText(message);
      expect(text.textContent).toBe(message);
      expect(text.id).not.toBe("");
      expect(cardInput()).toHaveAttribute("aria-describedby", text.id);
      expect(cardInput()).toHaveAccessibleDescription(message);
      const other =
        message === UI_COPY.ambiguousCard
          ? UI_COPY.cardNotFound
          : UI_COPY.ambiguousCard;
      expect(screen.queryByText(other)).toBeNull();
      expect(document.querySelector(".mm-rec-panel")).toBeNull();
      expect(document.querySelector('[aria-busy="true"]')).toBeNull();
      expect(document.querySelector('[data-status="error"]')).toBeNull();
      expect(screen.queryByText(UI_COPY.errorPanel)).toBeNull();
      expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
      expect(
        document.querySelector(
          `.mm-lookup-miss[data-status="${type ?? "not_found"}"]`,
        ),
      ).not.toBeNull();
      // One named lookup, nothing after it, nothing logged.
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(String(fetchMock.mock.calls[0][0])).toBe(
        `https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(card)}`,
      );
      expect(log).not.toHaveBeenCalled();
    },
  );

  test.each<[string, () => Response | Promise<Response>]>([
    [
      "503",
      () =>
        new Response(JSON.stringify({ code: "x", details: "x" }), {
          status: 503,
        }),
    ],
    [
      "429",
      () =>
        new Response(JSON.stringify({ code: "x", details: "x" }), {
          status: 429,
        }),
    ],
    ["an HTML 502", () => new Response("<html>bad</html>", { status: 502 })],
    ["a rejected fetch", () => Promise.reject(new TypeError("fetch failed"))],
    // A 404 Scryfall did not send is an outage, not a miss (ADV-3).
    [
      "an HTML 404",
      () => new Response("<html>Not Found</html>", { status: 404 }),
    ],
    ["an empty 404", () => new Response("", { status: 404 })],
  ])(
    "a lookup answering %s renders the error panel, never a miss (AC-8)",
    async (_name, answer) => {
      fetchMock.mockImplementation(async () => answer());
      const log = await renderSettled("jace", { price: "5" });
      expect(screen.getByText(UI_COPY.errorPanel)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
      expect(screen.queryByText(UI_COPY.ambiguousCard)).toBeNull();
      expect(screen.queryByText(UI_COPY.cardNotFound)).toBeNull();
      expect(cardInput()).not.toHaveAttribute("aria-describedby");
      expect(log).toHaveBeenCalledOnce();
      expect(log).toHaveBeenCalledWith("scryfall_failed", expect.anything());
    },
  );
});

describe("the settled miss page as the user edits (ADV-4, ADV-7)", () => {
  test('not_found: changing the card drops the message from the combobox\'s description; submitting ".." shows the card message once', async () => {
    fetchMock.mockResolvedValue(scryfall404());
    await renderSettled("asdfqwer", { price: "5" });
    expect(cardInput()).toHaveAccessibleDescription(UI_COPY.cardNotFound);
    fireEvent.change(cardInput(), { target: { value: "Esper Sentinel" } });
    expect(cardInput()).not.toHaveAttribute("aria-describedby");
    expect(cardInput()).toHaveAccessibleDescription("");
    expect(screen.queryByText(UI_COPY.cardNotFound)).toBeNull();
    fireEvent.change(cardInput(), { target: { value: ".." } });
    fireEvent.submit(cardInput().closest("form")!);
    expect(screen.getAllByText(UI_COPY.cardNotFound)).toHaveLength(1);
    expect(router.push).not.toHaveBeenCalled();
  });

  test("ambiguous: focusing the card field asks the autocomplete route for the typed name and lists the options; a pick and submit pushes its resultHref", async () => {
    fetchMock.mockImplementation(async (url) =>
      String(url).startsWith("/api/cards/autocomplete")
        ? Response.json({ data: ["Jace Beleren", "Jace, the Mind Sculptor"] })
        : scryfall404("ambiguous"),
    );
    await renderSettled("jace", { price: "5" });
    expect(fetchMock).toHaveBeenCalledOnce();
    fireEvent.focus(cardInput());
    const options = await screen.findAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual([
      "jace",
      "Jace Beleren",
      "Jace, the Mind Sculptor",
    ]);
    const autocomplete = fetchMock.mock.calls
      .map(([url]) => String(url))
      .filter((url) => url.startsWith("/api/cards/autocomplete"));
    expect(autocomplete).toEqual(["/api/cards/autocomplete?q=jace"]);
    fireEvent.mouseDown(options[1]);
    fireEvent.click(options[1]);
    fireEvent.submit(cardInput().closest("form")!);
    expect(router.push).toHaveBeenCalledExactlyOnceWith(
      resultHref("Jace Beleren", "5"),
    );
  });
});

describe("a fuzzy hit keeps the typed name (T14, AC-9)", () => {
  test('"esper sentinal" renders the Esper Sentinel header; the form keeps the typed name; no redirect', async () => {
    const named = scryfallCard({ name: "Esper Sentinel" });
    fetchMock.mockImplementation(async (url) =>
      String(url).includes("/cards/named")
        ? Response.json(named)
        : Response.json({
            object: "list",
            total_cards: ESPER_SENTINEL_PRINTS.length,
            has_more: false,
            data: ESPER_SENTINEL_PRINTS,
          }),
    );
    await renderSettled("esper%20sentinal", { price: "74.99" });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Esper Sentinel",
    );
    expect(cardInput()).toHaveValue("esper sentinal");
    expect(document.querySelector(".mm-rec-panel")).not.toBeNull();
    expect(screen.queryByText(UI_COPY.cardNotFound)).toBeNull();
    expect(cardInput()).not.toHaveAttribute("aria-describedby");
    expect(redirect).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
  });
});

describe("no price: the prefilled form, no Scryfall call (T20, AC-16; C2-B.11 = A)", () => {
  test.each<[string, string, Record<string, string>, string]>([
    ["/import", "import", {}, "import"],
    ["/about", "about", {}, "about"],
    ["/Esper%20Sentinel", "Esper%20Sentinel", {}, "Esper Sentinel"],
    [
      "/Esper%20Sentinel?price=",
      "Esper%20Sentinel",
      { price: "" },
      "Esper Sentinel",
    ],
    ["?price=%20", "Esper%20Sentinel", { price: " " }, "Esper Sentinel"],
  ])(
    "%s → the decoded card, an empty price, submit disabled with the helper",
    async (_name, card, search, decoded) => {
      const tree = await page(card, search);
      const elements = elementsIn(tree);
      expect(elements.some((e) => e.type === ResultSlot)).toBe(false);
      expect(elements.some((e) => e.type === ResultPanel)).toBe(false);
      render(tree);
      expect(cardInput()).toHaveValue(decoded);
      expect(priceInput()).toHaveValue("");
      const submit = screen.getByRole("button", { name: "Evaluate" });
      expect(submit).toBeDisabled();
      expect(submit).toHaveAccessibleDescription(UI_COPY.submitHelper);
      expect(screen.queryByText(UI_COPY.validationError)).toBeNull();
      expect(document.querySelector(".mm-result-slot")).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
});

// --- S2.3: the printing param and the selectors on the page ----------------
const AC9_PRINTING = "f8b6c532-b837-42b6-9ed2-0231d0779626";

/** fetch answering the named lookup and the print list (one or two pages). */
function esperFetch(
  pages: (() => Response | Promise<Response>)[] = [
    () =>
      Response.json({
        object: "list",
        total_cards: ESPER_SENTINEL_PRINTS.length,
        has_more: false,
        data: ESPER_SENTINEL_PRINTS,
      }),
  ],
) {
  const named = scryfallCard({ id: MH2_12_ID });
  fetchMock.mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes("/cards/named")) return Response.json(named);
    if (url === ESPER_PRINTS_URI) return pages[0]();
    if (url === ESPER_PRINTS_PAGE_2_URI && pages[1]) return pages[1]();
    throw new TypeError(`unexpected fetch ${url}`);
  });
}

const selectorButton = (label: string) =>
  screen.queryByRole("button", { name: new RegExp(`^${label}`) });

describe("the printing param on the page (T14, AC-2, AC-4, AC-9, AC-10)", () => {
  test.each<[string, Record<string, string | string[]>]>([
    ["printing=abc", { price: "74.99", printing: "abc" }],
    [
      "a repeated printing",
      { price: "74.99", printing: [AC9_PRINTING, AC9_PRINTING] },
    ],
    ["finish=etched", { price: "74.99", finish: "etched" }],
  ])(
    "%s → the form with the validation string; fetch 0 times",
    async (_name, search) => {
      const tree = await page("Esper%20Sentinel", search);
      const elements = elementsIn(tree);
      expect(elements.some((e) => e.type === ResultPanel)).toBe(false);
      render(tree);
      expect(screen.getByText(UI_COPY.validationError)).toBeInTheDocument();
      expect(document.querySelector(".mm-selector-row")).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  test("the AC-9 URL: sld #2123's header, FinishSelect Normal with the one option Foil, the insufficient_data panel with both selectors", async () => {
    esperFetch();
    searchParams.current = `printing=${AC9_PRINTING}&finish=normal&price=74.99`;
    const log = await renderSettled("Esper%20Sentinel", {
      printing: AC9_PRINTING,
      finish: "normal",
      price: "74.99",
    });
    expect(document.querySelector(".mm-card-set")).toHaveTextContent(
      "Secret Lair Drop (SLD) · #2123",
    );
    expect(document.querySelector(".mm-rec-panel")).toHaveAttribute(
      "data-kind",
      "insufficient_data",
    );
    const printing = selectorButton(UI_COPY.printingLabel)!;
    const finish = selectorButton(UI_COPY.finishLabel)!;
    expect(printing).toHaveTextContent("Secret Lair Drop (SLD) · #2123");
    expect(finish).toHaveTextContent("Normal");
    finish.focus();
    fireEvent.keyDown(finish, { key: "ArrowDown" });
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Foil",
    ]);
    // The named lookup and one prints page; nothing for the printing's id.
    expect(fetchMock.mock.calls.map(([u]) => String(u))).toEqual([
      expect.stringContaining("/cards/named?fuzzy="),
      ESPER_PRINTS_URI,
    ]);
    expect(log).not.toHaveBeenCalledWith("scryfall_failed", expect.anything());
  });

  test("the Suspense key changes with printing alone, so a switch remounts the boundary", async () => {
    const keyOf = async (search: Record<string, string>) =>
      elementsIn(await page("Esper%20Sentinel", search)).find(
        (e) => e.type === Suspense,
      )!.key;
    const none = await keyOf({ price: "74.99" });
    const sld = await keyOf({ price: "74.99", printing: AC9_PRINTING });
    const mh2 = await keyOf({ price: "74.99", printing: MH2_12_ID });
    expect(new Set([none, sld, mh2]).size).toBe(3);
    expect(
      await keyOf({ price: "74.99", printing: AC9_PRINTING.toUpperCase() }),
    ).toBe(sld);
  });

  test("the panel's query carries the parsed printing", async () => {
    const panel = elementsIn(
      await page("Esper%20Sentinel", {
        price: "74.99",
        printing: AC9_PRINTING.toUpperCase(),
      }),
    ).find((e) => e.type === ResultPanel)!;
    expect((panel.props as { query: EvaluationQuery }).query).toEqual({
      card: "Esper Sentinel",
      askingPriceCents: 7499,
      finish: "normal",
      printing: AC9_PRINTING,
    });
  });

  test("a failing second prints page renders the error panel with Retry and no selector", async () => {
    esperFetch([
      () => Response.json(ESPER_PRINTS_PAGE_1),
      () =>
        new Response(JSON.stringify({ code: "x", details: "x" }), {
          status: 503,
        }),
    ]);
    const log = await renderSettled("Esper%20Sentinel", { price: "74.99" });
    expect(screen.getByText(UI_COPY.errorPanel)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(selectorButton(UI_COPY.printingLabel)).toBeNull();
    expect(selectorButton(UI_COPY.finishLabel)).toBeNull();
    expect(document.querySelector(".mm-selector-row")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(log).toHaveBeenCalledExactlyOnceWith(
      "scryfall_failed",
      expect.anything(),
    );
  });

  test("foil on a printing that offers only normal (plst): FinishSelect shows Foil with the one option Normal, and the panel is normal pricing with the fallback notice (ADV-3, AC-9)", async () => {
    esperFetch();
    const now = new Date("2026-10-10T12:00:00.000Z");
    const reader = keyedHistoryReader(
      {
        [historyKey(PLST_ID, "normal")]: dailyHistory(
          "2026-10-10",
          Array(30).fill(6450),
        ),
      },
      now,
    );
    searchParams.current = `price=55&finish=foil&printing=${PLST_ID}`;
    await renderSettled(
      "Esper%20Sentinel",
      { price: "55", finish: "foil", printing: PLST_ID },
      { reader, now: () => now },
    );
    expect(document.querySelector(".mm-card-set")).toHaveTextContent(
      "The List (PLST) · #MH2-12",
    );
    const finish = selectorButton(UI_COPY.finishLabel)!;
    expect(finish).toHaveTextContent("Foil");
    finish.focus();
    fireEvent.keyDown(finish, { key: "ArrowDown" });
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Normal",
    ]);
    expect(document.querySelector(".mm-rec-panel")).toHaveAttribute(
      "data-kind",
      "buy",
    );
    expect(
      screen.getByText(
        fillTemplate(FALLBACK_NOTICE, { finish: FINISH_LABELS.foil }),
      ),
    ).toBeInTheDocument();
    expect(reader.calls).toEqual([[PLST_ID, "normal", "2026-10-10"]]);
  });

  test("a default render shows mh2 #12 and Normal in the selectors", async () => {
    esperFetch();
    searchParams.current = "price=74.99";
    await renderSettled("Esper%20Sentinel", { price: "74.99" });
    expect(selectorButton(UI_COPY.printingLabel)).toHaveTextContent(
      "Modern Horizons 2 (MH2) · #12",
    );
    expect(selectorButton(UI_COPY.finishLabel)).toHaveTextContent("Normal");
  });
});
