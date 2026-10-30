// GET /api/cards/printings (UI patch 2026-10-30): the Set picker's options
// for one exact name. It validates the name, looks the card up exactly,
// answers selectablePrintings' list and order with no prices, caches
// successes on the CDN for an hour, and answers every failure non-2xx with
// no-store: 404 only on Scryfall's own miss, 502 on anything else.
import {
  ESPER_PRINTS_PAGE_1,
  ESPER_PRINTS_PAGE_2,
  ESPER_PRINTS_PAGE_2_URI,
  ESPER_PRINTS_URI,
  ESPER_SENTINEL_PRINTS,
  scryfallCard,
} from "@/lib/__fixtures__/esper-sentinel-prints";
import { printingLine } from "@/lib/evaluation/printing-line";
import { selectablePrintings } from "@/lib/printings";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { GET } from "./route";

vi.mock("@/lib/throttle", () => ({ throttle: () => Promise.resolve() }));

const fetchMock = vi.fn<typeof fetch>();
const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});

beforeEach(() => {
  fetchMock.mockReset();
  errorLog.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const get = (query: string) =>
  GET(new Request(`http://localhost/api/cards/printings${query}`));
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const NAMED = scryfallCard();

/** Scryfall answers the named lookup, then both prints pages. */
const answerAll = () => {
  fetchMock
    .mockResolvedValueOnce(json(NAMED))
    .mockResolvedValueOnce(json(ESPER_PRINTS_PAGE_1))
    .mockResolvedValueOnce(json(ESPER_PRINTS_PAGE_2));
};

describe("success", () => {
  test("an exact lookup, every prints page, and selectablePrintings' list in its order, with s-maxage=3600", async () => {
    answerAll();
    const res = await get("?name=Esper%20Sentinel");
    expect(res.status).toBe(200);
    const cache = res.headers.get("Cache-Control")!;
    expect(cache).toContain("public");
    expect(cache).toContain("s-maxage=3600");
    const urls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(urls).toEqual([
      "https://api.scryfall.com/cards/named?exact=Esper%20Sentinel",
      ESPER_PRINTS_URI,
      ESPER_PRINTS_PAGE_2_URI,
    ]);
    const body = (await res.json()) as { data: Record<string, unknown>[] };
    const expected = selectablePrintings(ESPER_SENTINEL_PRINTS);
    expect(body.data.map((p) => p.id)).toEqual(expected.map((p) => p.id));
    expect(body.data[0]).toEqual({
      id: expected[0].id,
      setName: expected[0].set_name,
      setCode: expected[0].set.toUpperCase(),
      collectorNumber: expected[0].collector_number,
      label: printingLine(expected[0]),
    });
  });

  test("each option carries exactly id, setName, setCode, collectorNumber and label: no prices", async () => {
    answerAll();
    const res = await get("?name=Esper%20Sentinel");
    const body = (await res.json()) as { data: Record<string, unknown>[] };
    expect(body.data.length).toBeGreaterThan(0);
    for (const option of body.data) {
      expect(Object.keys(option).sort()).toEqual([
        "collectorNumber",
        "id",
        "label",
        "setCode",
        "setName",
      ]);
    }
    expect(JSON.stringify(body)).not.toMatch(/usd|eur|tix|price/i);
  });

  test("the name is trimmed before it goes upstream", async () => {
    answerAll();
    await get("?name=%20%20Esper%20Sentinel%20");
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "https://api.scryfall.com/cards/named?exact=Esper%20Sentinel",
    );
  });
});

describe("invalid names", () => {
  test.each([
    ["missing", ""],
    ["empty", "?name="],
    ["whitespace", "?name=%20%20"],
    ["142 code points", `?name=${"x".repeat(142)}`],
    ["a repeated name", "?name=a&name=b"],
    ["a control character", "?name=Esp%00er"],
  ])(
    "name %s → 400 invalid_name, no-store, 0 upstream calls",
    async (_name, query) => {
      const res = await get(query);
      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toEqual({ error: "invalid_name" });
      expect(res.headers.get("Cache-Control")).toBe("no-store");
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
});

describe("misses and failures", () => {
  test("Scryfall's own 404 → 404 not_found, no-store, no prints call", async () => {
    fetchMock.mockResolvedValueOnce(
      json(
        {
          object: "error",
          code: "not_found",
          status: 404,
          details: "No cards found matching “xyz”",
        },
        404,
      ),
    );
    const res = await get("?name=xyz");
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: "not_found" });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  test.each([
    [
      "a 503 on the lookup",
      () => {
        fetchMock.mockResolvedValueOnce(
          json({ object: "error", code: "x", status: 503, details: "x" }, 503),
        );
      },
    ],
    [
      "an HTML 404 on the lookup",
      () => {
        fetchMock.mockResolvedValueOnce(
          new Response("<html>nope</html>", {
            status: 404,
            headers: { "Content-Type": "text/html" },
          }),
        );
      },
    ],
    [
      "a rejected lookup",
      () => {
        fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
      },
    ],
    [
      "a failed prints page",
      () => {
        fetchMock
          .mockResolvedValueOnce(json(NAMED))
          .mockResolvedValueOnce(json(ESPER_PRINTS_PAGE_1))
          .mockRejectedValueOnce(new TypeError("fetch failed"));
      },
    ],
    [
      "a prints page without data",
      () => {
        fetchMock
          .mockResolvedValueOnce(json(NAMED))
          .mockResolvedValueOnce(json({ object: "list", has_more: false }));
      },
    ],
  ])("%s → 502 upstream, no-store", async (_name, arrange) => {
    arrange();
    const res = await get("?name=Esper%20Sentinel");
    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toEqual({ error: "upstream" });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  test("a failure is logged by event name, never the upstream URL or the name", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    await get("?name=Esper%20Sentinel");
    expect(errorLog).toHaveBeenCalledOnce();
    expect(String(errorLog.mock.calls[0][0])).not.toMatch(
      /scryfall\.com|esper/i,
    );
  });
});
