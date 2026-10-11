// T16 (AC-11, AC-12; S2.4d10; S2.2 AC-2's switch): the retired demo route
// answers 307 to the demo link, drops any query, sends no body, calls no one,
// and reads nothing from the request. Replaces S2.2's /sample footer test.
import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { parseResultParams } from "../../lib/evaluation/result-params";
import { DEMO_RESULT_HREF } from "../../lib/result-href";
import * as route from "./route";

const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const URLS = [
  "https://mox.test/sample",
  "https://mox.test/sample?card=Foo&price=1",
  "https://mox.test/sample?next=//evil.example",
  "https://mox.test/sample?price=1&finish=foil#x",
];

describe("the retired demo route (T16, AC-11)", () => {
  test.each(
    URLS.flatMap((url) => [
      ["GET", url],
      ["HEAD", url],
    ]),
  )(
    "%s %s → 307 to the demo link, no-store, empty body",
    async (method, url) => {
      const handler = method === "GET" ? route.GET : route.HEAD;
      const handlerWithRequest = handler as unknown as (
        request: Request,
      ) => Response;
      const res = handlerWithRequest(new Request(url, { method }));
      expect(res.status).toBe(307);
      expect(res.headers.get("Location")).toBe("/Esper%20Sentinel?price=74.99");
      expect(res.headers.get("Location")).toBe(DEMO_RESULT_HREF);
      expect(res.headers.get("Cache-Control")).toBe("no-store");
      expect(await res.text()).toBe("");
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  test("dynamic, so no build-time 307 is cached", () => {
    expect(route.dynamic).toBe("force-dynamic");
  });

  test("exports only GET, HEAD and dynamic", () => {
    expect(Object.keys(route).sort()).toEqual(["GET", "HEAD", "dynamic"]);
  });

  test("imports nothing from Scryfall or the evaluation, and reads no request", () => {
    const file = path.resolve(__dirname, "route.ts");
    const source = readFileSync(file, "utf8");
    const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const specs = sf.statements
      .filter(ts.isImportDeclaration)
      .map((s) => (s.moduleSpecifier as ts.StringLiteral).text);
    expect(specs).toEqual(["@/lib/result-href"]);
    for (const spec of specs) {
      expect(spec).not.toMatch(/scryfall|evaluation/);
    }
    // The handlers take no parameters, so no input can reach Location.
    expect(route.GET.length).toBe(0);
    expect(route.HEAD.length).toBe(0);
  });

  test("the demo link parses to Esper Sentinel at 7499 cents, finish normal", () => {
    const [, segment, price] = /^\/([^?]+)\?price=(.+)$/.exec(
      DEMO_RESULT_HREF,
    )!;
    expect(parseResultParams(segment, { price })).toMatchObject({
      kind: "ok",
      card: "Esper Sentinel",
      askingPriceCents: 7499,
      finish: "normal",
    });
  });
});
