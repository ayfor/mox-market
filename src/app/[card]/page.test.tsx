// T19 (AC-9; C1.28 = A; S2.1d18) and T17's page half (AC-8): the result
// page awaited as a function. Bad params never reach Scryfall; a valid query
// streams the panel through a Suspense boundary keyed by the query. S2.4 adds
// T12's page half (AC-6, AC-7: the miss states), T14's (AC-9: a fuzzy hit
// keeps the typed name) and T20 (AC-16: no price, no Scryfall call), with the
// streamed panel awaited through the real getCardByName and fetch mocked.
import { EntryForm } from "@/components/entry-form";
import {
  ESPER_SENTINEL_PRINTS,
  scryfallCard,
} from "@/lib/__fixtures__/esper-sentinel-prints";
import {
  defaultEvaluationDeps,
  type EvaluationDeps,
  type EvaluationQuery,
} from "@/lib/evaluation/build-evaluation";
import { UI_COPY } from "@/lib/recommendation/ui-copy";
import { render, screen } from "@testing-library/react";
import {
  cloneElement,
  isValidElement,
  Suspense,
  type ReactElement,
  type ReactNode,
} from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import ResultPage, { metadata } from "./page";
import { PanelSkeleton } from "./panel-skeleton";
import { ResultPanel } from "./result-panel";
import { ResultSlot } from "./result-slot";

const NOT_FOUND = "NEXT_HTTP_ERROR_FALLBACK;404";
const router = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  replace: vi.fn(),
  prefetch: vi.fn(),
}));
const redirect = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/",
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
  test("the panel sits in a Suspense keyed by paramsKey with the skeleton as fallback, inside ResultSlot", async () => {
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
    expect(suspense.key).toBe("Esper Sentinel|7499|foil");
    const fallback = (suspense.props as { fallback: ReactElement }).fallback;
    expect(fallback.type).toBe(PanelSkeleton);
    const panel = elementsIn(
      (suspense.props as { children: ReactNode }).children,
    ).find((e) => e.type === ResultPanel)!;
    expect((panel.props as { query: unknown }).query).toEqual({
      card: "Esper Sentinel",
      askingPriceCents: 7499,
      finish: "foil",
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
): Promise<ReturnType<typeof vi.fn>> {
  const log = vi.fn();
  const deps: EvaluationDeps = { ...defaultEvaluationDeps, log };
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
      expect(log).toHaveBeenCalledWith("scryfall_failed", expect.anything());
    },
  );
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
