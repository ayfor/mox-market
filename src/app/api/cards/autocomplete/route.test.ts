// T27 (AC-19) and T28 (AC-20; C1.30; S2.1d14): GET /api/cards/autocomplete
// proxies Scryfall, caches successes on the CDN for a day, and answers every
// failure non-2xx with no-store.
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
  GET(new Request(`http://localhost/api/cards/autocomplete${query}`));
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

describe("success (T27, AC-19)", () => {
  test("Scryfall 200 → 200 { data } with s-maxage=86400; the upstream URL encodes q", async () => {
    fetchMock.mockResolvedValueOnce(
      json({ object: "catalog", total_values: 1, data: ["Esper Sentinel"] }),
    );
    const res = await get("?q=esper%20s%26t");
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ data: ["Esper Sentinel"] });
    const cache = res.headers.get("Cache-Control")!;
    expect(cache).toContain("s-maxage=86400");
    expect(cache).toContain("public");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "https://api.scryfall.com/cards/autocomplete?q=esper%20s%26t",
    );
  });

  test("q is trimmed before it goes upstream", async () => {
    fetchMock.mockResolvedValueOnce(json({ object: "catalog", data: [] }));
    const res = await get("?q=%20%20esper%20");
    expect(res.status).toBe(200);
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "https://api.scryfall.com/cards/autocomplete?q=esper",
    );
  });
});

describe("invalid queries (T27)", () => {
  test.each([
    ["missing", ""],
    ['"a"', "?q=a"],
    ['"  a  "', "?q=%20%20a%20%20"],
    ["142 code points", `?q=${"x".repeat(142)}`],
    ["142 emoji", `?q=${encodeURIComponent("\u{1F0CF}".repeat(142))}`],
    ["a repeated q", "?q=esper&q=sentinel"],
    ["a control character", "?q=esp%00er"],
  ])(
    "q %s → 400 invalid_query, no-store, 0 upstream calls",
    async (_name, query) => {
      const res = await get(query);
      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toEqual({ error: "invalid_query" });
      expect(res.headers.get("Cache-Control")).toBe("no-store");
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  test("141 code points pass", async () => {
    fetchMock.mockResolvedValueOnce(json({ object: "catalog", data: [] }));
    const res = await get(`?q=${encodeURIComponent("\u{1F0CF}".repeat(141))}`);
    expect(res.status).toBe(200);
  });
});

describe("upstream failures (T28, AC-20)", () => {
  test.each([
    [
      "503",
      () =>
        Promise.resolve(
          json({ object: "error", code: "x", status: 503, details: "x" }, 503),
        ),
    ],
    [
      "429",
      () =>
        Promise.resolve(
          json({ object: "error", code: "x", status: 429, details: "x" }, 429),
        ),
    ],
    [
      "an HTML 502",
      () =>
        Promise.resolve(
          new Response("<html>bad gateway</html>", {
            status: 502,
            headers: { "Content-Type": "text/html" },
          }),
        ),
    ],
    ["a body without data", () => Promise.resolve(json({ object: "catalog" }))],
    [
      "a data array of non-strings",
      () => Promise.resolve(json({ object: "catalog", data: [1, 2] })),
    ],
    ["a rejected fetch", () => Promise.reject(new TypeError("fetch failed"))],
  ])(
    "Scryfall %s → 502 upstream, no-store, never s-maxage",
    async (_name, answer) => {
      fetchMock.mockImplementationOnce(answer);
      const res = await get("?q=esper");
      expect(res.status).toBe(502);
      await expect(res.json()).resolves.toEqual({ error: "upstream" });
      const cache = res.headers.get("Cache-Control");
      expect(cache).toBe("no-store");
      expect(cache).not.toContain("s-maxage");
    },
  );

  test("a failure is logged by event name, never the upstream URL", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    await get("?q=esper");
    expect(errorLog).toHaveBeenCalledOnce();
    expect(String(errorLog.mock.calls[0][0])).not.toMatch(
      /scryfall\.com|esper/,
    );
  });
});
