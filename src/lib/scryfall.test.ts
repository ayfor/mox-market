// T4 (AC-4, AC-10, AC-20; S2.1d7, S2.1d21; story Notes): getAllPrintings
// follows every page or throws, autocomplete throws instead of returning [],
// and every request aborts after SCRYFALL_TIMEOUT_MS.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  ESPER_PRINTS_URI,
  ESPER_SENTINEL_PRINTS,
} from "./__fixtures__/esper-sentinel-prints";
import { MAX_PRINT_PAGES, SCRYFALL_TIMEOUT_MS } from "./evaluation/consts";
import {
  autocomplete,
  getAllPrintings,
  getCardByName,
  getPrintings,
} from "./scryfall";

// The throttle spaces real requests 100 ms apart; the client logic is under test here.
vi.mock("./throttle", () => ({ throttle: () => Promise.resolve() }));

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const html502 = () =>
  new Response("<html><body>Bad gateway</body></html>", {
    status: 502,
    headers: { "Content-Type": "text/html" },
  });
const scryfallError = (status: number) =>
  json({ object: "error", code: "x", status, details: "failed" }, status);

const PAGE_2 =
  "https://api.scryfall.com/cards/search?page=2&q=oracleid%3Ax&unique=prints";
const page = (data: unknown[], next?: string) => ({
  object: "list",
  total_cards: 8,
  has_more: next !== undefined,
  ...(next ? { next_page: next } : {}),
  data,
});
const requestedUrls = () => fetchMock.mock.calls.map(([url]) => String(url));

describe("getAllPrintings (T4)", () => {
  const card = { prints_search_uri: ESPER_PRINTS_URI };
  const first = ESPER_SENTINEL_PRINTS.slice(0, 5);
  const second = ESPER_SENTINEL_PRINTS.slice(5);

  test("follows prints_search_uri then next_page until has_more is false, one request per page, order kept", async () => {
    fetchMock
      .mockResolvedValueOnce(json(page(first, PAGE_2)))
      .mockResolvedValueOnce(json(page(second)));
    const printings = await getAllPrintings(card);
    expect(printings.map((p) => p.id)).toEqual(
      ESPER_SENTINEL_PRINTS.map((p) => p.id),
    );
    expect(requestedUrls()).toEqual([ESPER_PRINTS_URI, PAGE_2]);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(new Headers(init.headers).get("User-Agent")).toMatch(/MoxMarket/);
  });

  test.each([
    ["a 503", () => scryfallError(503)],
    ["an HTML 502", html502],
  ])("%s on page 2 throws (no partial list)", async (_name, failure) => {
    fetchMock
      .mockResolvedValueOnce(json(page(first, PAGE_2)))
      .mockResolvedValueOnce(failure());
    await expect(getAllPrintings(card)).rejects.toThrow();
  });

  test("a rejected fetch throws", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    await expect(getAllPrintings(card)).rejects.toThrow("fetch failed");
  });

  test("a next_page off https://api.scryfall.com is never fetched", async () => {
    for (const next of [
      "https://evil.example/cards/search?page=2",
      "http://api.scryfall.com/cards/search?page=2",
      "https://api.scryfall.com.evil.example/x",
    ]) {
      fetchMock.mockReset();
      fetchMock.mockResolvedValueOnce(json(page(first, next)));
      await expect(getAllPrintings(card)).rejects.toThrow();
      expect(requestedUrls()).toEqual([ESPER_PRINTS_URI]);
    }
  });

  test("a missing prints_search_uri throws before any request", async () => {
    await expect(
      getAllPrintings({} as { prints_search_uri: string }),
    ).rejects.toThrow();
    await expect(getAllPrintings({ prints_search_uri: "" })).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("a page without a data array throws", async () => {
    fetchMock.mockResolvedValueOnce(json({ object: "list", has_more: false }));
    await expect(getAllPrintings(card)).rejects.toThrow();
  });

  test("has_more without a next_page throws", async () => {
    fetchMock.mockResolvedValueOnce(
      json({ object: "list", has_more: true, data: first }),
    );
    await expect(getAllPrintings(card)).rejects.toThrow();
  });

  test(`has_more still true after ${MAX_PRINT_PAGES} pages throws`, async () => {
    fetchMock.mockImplementation(async () => json(page(first, PAGE_2)));
    await expect(getAllPrintings(card)).rejects.toThrow(/pages/);
    expect(fetchMock).toHaveBeenCalledTimes(MAX_PRINT_PAGES);
  });
});

describe("autocomplete (T4)", () => {
  test("returns the names on 200, with q encoded", async () => {
    fetchMock.mockResolvedValueOnce(
      json({
        object: "catalog",
        total_values: 2,
        data: ["Esper Sentinel", "Esper Charm"],
      }),
    );
    await expect(autocomplete("esper s&t")).resolves.toEqual([
      "Esper Sentinel",
      "Esper Charm",
    ]);
    expect(requestedUrls()).toEqual([
      "https://api.scryfall.com/cards/autocomplete?q=esper%20s%26t",
    ]);
  });

  test.each([
    ["503", () => Promise.resolve(scryfallError(503))],
    ["429", () => Promise.resolve(scryfallError(429))],
    ["a rejected fetch", () => Promise.reject(new TypeError("fetch failed"))],
  ])(
    "throws on %s (the catch { return [] } is gone)",
    async (_name, answer) => {
      fetchMock.mockImplementationOnce(answer);
      await expect(autocomplete("esper")).rejects.toThrow();
    },
  );

  test("makes no request under 2 characters", async () => {
    await expect(autocomplete("e")).resolves.toEqual([]);
    await expect(autocomplete("")).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("getPrintings and getCardByName", () => {
  test("getPrintings throws instead of returning [] (its catch is gone)", async () => {
    fetchMock.mockResolvedValueOnce(scryfallError(503));
    await expect(getPrintings("Esper Sentinel")).rejects.toThrow();
  });

  test("getCardByName: 404 → null, 503 → throws", async () => {
    fetchMock.mockResolvedValueOnce(scryfallError(404));
    await expect(getCardByName("Nope", true)).resolves.toBeNull();
    fetchMock.mockResolvedValueOnce(scryfallError(503));
    await expect(getCardByName("Esper", true)).rejects.toThrow();
  });
});

describe("request timeout (T4, S2.1d21)", () => {
  /** A fetch that never answers but rejects when its signal aborts. */
  const hangingFetch = (_url: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () =>
        reject(new DOMException("aborted", "AbortError")),
      );
    });

  test.each([
    ["getCardByName", () => getCardByName("Esper Sentinel", true)],
    [
      "getAllPrintings",
      () => getAllPrintings({ prints_search_uri: ESPER_PRINTS_URI }),
    ],
    ["autocomplete", () => autocomplete("esper")],
  ])("%s aborts after SCRYFALL_TIMEOUT_MS and throws", async (_name, call) => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(hangingFetch);
    const outcome = call().then(
      () => "resolved",
      (error: unknown) => (error as Error).name,
    );
    await vi.advanceTimersByTimeAsync(SCRYFALL_TIMEOUT_MS - 1);
    const signal = (fetchMock.mock.calls[0][1] as RequestInit).signal!;
    expect(signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(signal.aborted).toBe(true);
    await expect(outcome).resolves.toBe("AbortError");
  });

  test("a settled request clears its timer", async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValueOnce(
      json({ object: "catalog", data: ["Esper Sentinel"] }),
    );
    await autocomplete("esper");
    expect(vi.getTimerCount()).toBe(0);
  });
});
