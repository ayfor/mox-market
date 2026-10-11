// T2 (AC-1, AC-2; S0.3d2, S0.3d4): the route module's exports, 405 for every
// method but GET, and a GET that fails closed before anything runs: with
// CRON_SECRET unset, blank or the .env.example placeholder → 500, with a
// missing or wrong header → 401, and in both no fetch, no import of
// @/lib/prisma, no download directory and no secret in the body.
import { refusingPrismaModule } from "@/test/no-database";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const fsSpies = vi.hoisted(() => ({ mkdtemp: vi.fn() }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  fsSpies.mkdtemp.mockImplementation(actual.mkdtemp);
  return { ...actual, default: actual, mkdtemp: fsSpies.mkdtemp };
});

const SECRET = "route-test-secret-6f1e2d3c4b5a69788796a5b4c3d2e1f0";
const URL = "http://localhost:3000/api/prices/sync-mtgjson";

let prismaImports = 0;
const fetchMock = vi.fn<typeof fetch>();

/** The route module, fresh, with @/lib/prisma counted on import. */
async function loadRoute() {
  vi.resetModules();
  vi.doMock("@/lib/prisma", () => {
    prismaImports += 1;
    return refusingPrismaModule();
  });
  return import("./route");
}

beforeEach(() => {
  prismaImports = 0;
  fetchMock.mockReset();
  fsSpies.mkdtemp.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.doUnmock("@/lib/prisma");
  vi.restoreAllMocks();
});

describe("the module (T2, AC-2)", () => {
  test("exports exactly the route handlers and the segment config", async () => {
    const route = await loadRoute();
    expect(Object.keys(route).sort()).toEqual(
      [
        "DELETE",
        "GET",
        "HEAD",
        "PATCH",
        "POST",
        "PUT",
        "dynamic",
        "maxDuration",
        "runtime",
      ].sort(),
    );
    expect(route.dynamic).toBe("force-dynamic");
    expect(route.maxDuration).toBe(300);
    expect(route.runtime).toBe("nodejs");
    expect(prismaImports).toBe(0);
  });
});

describe("every other method → 405 (T2, AC-2)", () => {
  const METHODS = ["POST", "PUT", "PATCH", "DELETE", "HEAD"] as const;
  const HEADERS: [string, Record<string, string>][] = [
    ["no header", {}],
    ["a wrong secret", { Authorization: "Bearer wrong" }],
    ["the right secret", { Authorization: `Bearer ${SECRET}` }],
  ];

  test.each(
    METHODS.flatMap((method) =>
      HEADERS.map(([label, headers]) => [method, label, headers] as const),
    ),
  )(
    "%s with %s → 405, Allow: GET, empty body, nothing runs",
    async (method, _label, headers) => {
      vi.stubEnv("CRON_SECRET", SECRET);
      const route = await loadRoute();
      const res = await route[method](
        new Request(URL, {
          method,
          headers,
          body: method === "HEAD" ? undefined : "{}",
        }),
      );
      expect(res.status).toBe(405);
      expect(res.headers.get("Allow")).toBe("GET");
      expect(await res.text()).toBe("");
      expect(fetchMock).not.toHaveBeenCalled();
      expect(prismaImports).toBe(0);
      expect(fsSpies.mkdtemp).not.toHaveBeenCalled();
    },
  );
});

describe("GET fails closed (T2, AC-1)", () => {
  test.each([
    ["unset", undefined],
    ["empty", ""],
    ["whitespace", "   "],
    ["the .env.example placeholder", "replace-me"],
  ])(
    "CRON_SECRET %s → 500 whatever the header, nothing runs",
    async (_label, secret) => {
      vi.stubEnv("CRON_SECRET", secret);
      const route = await loadRoute();
      for (const headers of [
        {},
        { Authorization: `Bearer ${secret ?? ""}` },
        { Authorization: `Bearer ${SECRET}` },
      ]) {
        const res = await route.GET(new Request(URL, { headers }));
        expect(res.status).toBe(500);
        expect(res.headers.get("Cache-Control")).toBe("no-store");
        expect(await res.json()).toEqual({
          error: "cron secret not configured",
        });
      }
      expect(fetchMock).not.toHaveBeenCalled();
      expect(prismaImports).toBe(0);
      expect(fsSpies.mkdtemp).not.toHaveBeenCalled();
    },
  );

  test.each([
    ["missing", {}],
    ["wrong", { Authorization: "Bearer not-the-secret" }],
    ["the secret without its scheme", { Authorization: SECRET }],
    ["a lower-case scheme", { Authorization: `bearer ${SECRET}` }],
  ])(
    "a %s header → 401, nothing runs, no secret in the body",
    async (_label, headers) => {
      vi.stubEnv("CRON_SECRET", SECRET);
      const route = await loadRoute();
      const res = await route.GET(new Request(URL, { headers }));
      expect(res.status).toBe(401);
      const text = await res.text();
      expect(JSON.parse(text)).toEqual({ error: "unauthorized" });
      expect(text).not.toContain(SECRET);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(prismaImports).toBe(0);
      expect(fsSpies.mkdtemp).not.toHaveBeenCalled();
    },
  );

  test("an unset POSTGRES_PRISMA_URL cannot turn a 401 into another error", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    vi.stubEnv("POSTGRES_PRISMA_URL", undefined);
    const route = await loadRoute();
    const res = await route.GET(new Request(URL));
    expect(res.status).toBe(401);
  });

  test("with Bearer <secret> it runs: the client is imported only then (here the barrier refuses it, so 500 with no run row)", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    const route = await loadRoute();
    const res = await route.GET(
      new Request(URL, { headers: { Authorization: `Bearer ${SECRET}` } }),
    );
    expect(prismaImports).toBe(1);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toMatchObject({ status: "error", runId: null });
    expect(body.error).toMatch(/must not reach Postgres/);
    expect(fetchMock).not.toHaveBeenCalled();
    // The directory spy is live: a passing guard does create one.
    expect(fsSpies.mkdtemp).toHaveBeenCalledTimes(1);
  });
});
