// T19 (AC-9; C1.28 = A; S2.1d18) and T17's page half (AC-8): the result
// page awaited as a function. Bad params never reach Scryfall; a valid query
// streams the panel through a Suspense boundary keyed by the query.
import { EntryForm } from "@/components/entry-form";
import { UI_COPY } from "@/lib/recommendation/ui-copy";
import { render, screen } from "@testing-library/react";
import {
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
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/",
  notFound: () => {
    throw new Error("NEXT_HTTP_ERROR_FALLBACK;404");
  },
}));

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
