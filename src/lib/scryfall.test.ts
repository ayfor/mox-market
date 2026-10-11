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
  getCardById,
  getCardByName,
  getPrintings,
  ScryfallApiError,
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

  test("getCardById still resolves null on 404 (unchanged)", async () => {
    fetchMock.mockResolvedValueOnce(scryfallError(404));
    await expect(getCardById("nope")).resolves.toBeNull();
  });
});

describe("getCardByName and ScryfallApiError (T8, AC-5)", () => {
  /** The error a call rejects with, or a failure if it resolves. */
  const rejection = async (call: Promise<unknown>) =>
    call.then(
      (value) => {
        throw new Error(`resolved with ${JSON.stringify(value)}`);
      },
      (error: unknown) => error,
    );

  test("200 → the card, from a fuzzy named lookup", async () => {
    const card = ESPER_SENTINEL_PRINTS[0];
    fetchMock.mockResolvedValueOnce(json(card));
    await expect(getCardByName("esper sentinal", true)).resolves.toEqual(card);
    expect(requestedUrls()).toEqual([
      "https://api.scryfall.com/cards/named?fuzzy=esper%20sentinal",
    ]);
  });

  test('404 {type: "ambiguous"} → ScryfallApiError 404, code not_found, type ambiguous', async () => {
    fetchMock.mockResolvedValueOnce(
      json(
        {
          object: "error",
          code: "not_found",
          status: 404,
          type: "ambiguous",
          details: "Too many cards match ambiguous name “jace”.",
        },
        404,
      ),
    );
    const error = await rejection(getCardByName("jace", true));
    expect(error).toBeInstanceOf(ScryfallApiError);
    expect(error).toMatchObject({
      status: 404,
      code: "not_found",
      type: "ambiguous",
      message: "Too many cards match ambiguous name “jace”.",
    });
  });

  test("404 without a type → status 404, type undefined", async () => {
    fetchMock.mockResolvedValueOnce(
      json(
        {
          object: "error",
          code: "not_found",
          status: 404,
          details: "No cards found matching “asdfqwer”",
        },
        404,
      ),
    );
    const error = (await rejection(
      getCardByName("asdfqwer", true),
    )) as ScryfallApiError;
    expect(error).toBeInstanceOf(ScryfallApiError);
    expect(error.status).toBe(404);
    expect(error.code).toBe("not_found");
    expect(error.type).toBeUndefined();
  });

  test.each([503, 429, 400, 500])(
    "%i → ScryfallApiError with that status",
    async (status) => {
      fetchMock.mockResolvedValueOnce(scryfallError(status));
      const error = (await rejection(
        getCardByName("Esper Sentinel", true),
      )) as ScryfallApiError;
      expect(error).toBeInstanceOf(ScryfallApiError);
      expect(error.status).toBe(status);
      expect(error.code).toBe("x");
      expect(error.message).toBe("failed");
    },
  );

  test.each<[string, () => Response, number]>([
    ["a 502 with an HTML body", html502, 502],
    ["a 500 with an empty body", () => new Response("", { status: 500 }), 500],
    [
      "a 503 with a JSON array",
      () => new Response("[1,2]", { status: 503 }),
      503,
    ],
    ["a 404 with JSON null", () => new Response("null", { status: 404 }), 404],
  ])(
    "%s → ScryfallApiError with that status and code unknown, never a SyntaxError",
    async (_name, answer, status) => {
      fetchMock.mockResolvedValueOnce(answer());
      const error = (await rejection(
        getCardByName("Esper Sentinel", true),
      )) as ScryfallApiError;
      expect(error).toBeInstanceOf(ScryfallApiError);
      expect(error).not.toBeInstanceOf(SyntaxError);
      expect(error.status).toBe(status);
      expect(error.code).toBe("unknown");
      expect(error.type).toBeUndefined();
      expect(error.message).toBe(`HTTP ${status}`);
    },
  );

  test("the status text is the message when the body has no details", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("<html></html>", { status: 502, statusText: "Bad Gateway" }),
    );
    const error = await rejection(getCardByName("x", true));
    expect(error).toMatchObject({ status: 502, message: "Bad Gateway" });
  });

  test("non-string code, type and details are ignored", async () => {
    fetchMock.mockResolvedValueOnce(
      json(
        { object: "error", code: 7, status: 404, type: 5, details: {} },
        404,
      ),
    );
    const error = (await rejection(
      getCardByName("x", true),
    )) as ScryfallApiError;
    expect(error.status).toBe(404);
    expect(error.code).toBe("unknown");
    expect(error.type).toBeUndefined();
    expect(error.message).toBe("HTTP 404");
  });

  test("a rejected fetch rejects with the original error, not a ScryfallApiError", async () => {
    const original = new TypeError("fetch failed");
    fetchMock.mockRejectedValueOnce(original);
    const error = await rejection(getCardByName("Esper Sentinel", true));
    expect(error).toBe(original);
    expect(error).not.toBeInstanceOf(ScryfallApiError);
  });

  test("the 8 s timeout rejects with the AbortError, not a ScryfallApiError", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) =>
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          ),
        ),
    );
    const outcome = rejection(getCardByName("Esper Sentinel", true));
    await vi.advanceTimersByTimeAsync(SCRYFALL_TIMEOUT_MS);
    const error = await outcome;
    expect((error as Error).name).toBe("AbortError");
    expect(error).not.toBeInstanceOf(ScryfallApiError);
  });

  test.each([
    ["JSON null", "null"],
    ["a number", "5"],
    ["a string", '"Esper Sentinel"'],
  ])("a 200 with %s → TypeError, never null", async (_name, body) => {
    fetchMock.mockResolvedValueOnce(new Response(body, { status: 200 }));
    const error = await rejection(getCardByName("x", true));
    expect(error).toBeInstanceOf(TypeError);
  });

  test("never resolves null: every non-2xx rejects", async () => {
    for (const status of [400, 404, 410, 422, 429, 500, 502, 503]) {
      fetchMock.mockResolvedValueOnce(scryfallError(status));
      await expect(getCardByName("x", true)).rejects.toBeInstanceOf(
        ScryfallApiError,
      );
    }
  });

  test("ScryfallApiError is an exported Error named ScryfallApiError", () => {
    const error = new ScryfallApiError(404, "not_found", "nope", "ambiguous");
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("ScryfallApiError");
    expect(error).toMatchObject({
      status: 404,
      code: "not_found",
      type: "ambiguous",
      message: "nope",
    });
    expect(new ScryfallApiError(500, "x", "y").type).toBeUndefined();
  });

  test("ThrottleBacklogError passes through unchanged", async () => {
    vi.resetModules();
    vi.doMock("./throttle", async (importOriginal) => {
      const actual = await importOriginal<typeof import("./throttle")>();
      return {
        ...actual,
        throttle: () => Promise.reject(new actual.ThrottleBacklogError(9_000)),
      };
    });
    try {
      const fresh = await import("./scryfall");
      const throttleModule = await import("./throttle");
      const error = await rejection(fresh.getCardByName("x", true));
      expect(error).toBeInstanceOf(throttleModule.ThrottleBacklogError);
      expect(error).not.toBeInstanceOf(fresh.ScryfallApiError);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.doUnmock("./throttle");
      vi.resetModules();
    }
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
