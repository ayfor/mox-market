// T2 (AC-1, AC-2; S0.3d2, S0.3d4, S0.3d24): the route module's exports, 405
// for every method but GET, and a GET that fails closed before anything
// runs: with CRON_SECRET unset, blank, the .env.example placeholder, padded,
// not printable ASCII or short → 500, with a missing or wrong header → 401,
// with a non-local database outside Vercel Production → 500 (ADV.7), and in
// each no fetch, no import of @/lib/prisma, no download directory, no secret
// in the body, and exactly one fixed log line that never holds the header or
// the secret (ADV.9).
import {
  NON_LOCAL_DATABASE_BODY,
  REFUSED_NON_LOCAL_LINE,
  REFUSED_SECRET_LINES,
  REFUSED_UNAUTHORIZED_LINE,
} from "@/lib/mtgjson/sync-handler";
import { refusingPrismaModule } from "@/test/no-database";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const fsSpies = vi.hoisted(() => ({ mkdtemp: vi.fn() }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  fsSpies.mkdtemp.mockImplementation(actual.mkdtemp);
  return { ...actual, default: actual, mkdtemp: fsSpies.mkdtemp };
});

const SECRET = "route-test-secret-6f1e2d3c4b5a69788796a5b4c3d2e1f0";
const HEX64 =
  "9b8a7f6e5d4c3b2a19087f6e5d4c3b2a19087f6e5d4c3b2a19087f6e5d4c3b2a";
const URL = "http://localhost:3000/api/prices/sync-mtgjson";
const LOCAL_DB = "postgresql://postgres:postgres@localhost:5432/mox_market";

/** Every line console.info, warn and error received, by level. */
function consoleLines() {
  const of = (method: "info" | "warn" | "error") =>
    (
      console[method] as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls.map((call) => call.map(String).join(" "));
  return { info: of("info"), warn: of("warn"), error: of("error") };
}

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
  vi.stubEnv("VERCEL_ENV", undefined);
  vi.stubEnv("POSTGRES_PRISMA_URL", LOCAL_DB);
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

describe("the sync's time budget fits the route's maxDuration (T2, ADV.11)", () => {
  test("SYNC_DEADLINE_MS is 30 s under maxDuration, and the final update's grace still fits", async () => {
    const route = await loadRoute();
    const { SYNC_DEADLINE_MS, SYNC_FINISH_GRACE_MS } =
      await import("@/lib/mtgjson/consts");
    expect(SYNC_DEADLINE_MS).toBe(270_000);
    expect(SYNC_DEADLINE_MS).toBeLessThanOrEqual(
      route.maxDuration * 1000 - 30_000,
    );
    expect(SYNC_FINISH_GRACE_MS).toBeGreaterThan(0);
    expect(SYNC_DEADLINE_MS + SYNC_FINISH_GRACE_MS).toBeLessThan(
      route.maxDuration * 1000,
    );
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

describe("an unusable CRON_SECRET → 500 through the route (T2, S0.3d24, ADV.3)", () => {
  test.each([
    ["a", "short"],
    ["short-real-secret", "short"],
    ['"replace-me"', "placeholder"],
    [` ${HEX64}`, "whitespace"],
    [`${HEX64}\n`, "whitespace"],
    ["s3cret-ünïcødé-🔑-0123456789abcdef0123456789", "charset"],
  ] as const)(
    "CRON_SECRET %j → 500 'cron secret not configured', one %s line, nothing runs",
    async (secret, problem) => {
      vi.stubEnv("CRON_SECRET", secret);
      const route = await loadRoute();
      // The header a real client can send for that value: trimmed, and
      // latin1 for a multi-byte one (Node reads header bytes as latin1).
      const sendable = Buffer.from(secret.trim(), "utf8").toString("latin1");
      const res = await route.GET(
        new Request(URL, {
          headers: { Authorization: `Bearer ${sendable}` },
        }),
      );
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: "cron secret not configured" });
      expect(prismaImports).toBe(0);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(fsSpies.mkdtemp).not.toHaveBeenCalled();
      const lines = consoleLines();
      expect(lines.error).toEqual([REFUSED_SECRET_LINES[problem]]);
      expect(lines.warn).toEqual([]);
      expect(lines.info).toEqual([]);
    },
  );
});

describe("each refusal logs one fixed line, never the header or the secret (T2, ADV.9)", () => {
  const headers = [
    `Bearer ${SECRET}x`,
    `Bearer ${SECRET.slice(0, -1)}`,
    `Bearer ${SECRET}`,
  ];

  test.each(headers)(
    "CRON_SECRET unset, header %j → 500 and exactly one error line",
    async (header) => {
      vi.stubEnv("CRON_SECRET", undefined);
      const route = await loadRoute();
      const res = await route.GET(
        new Request(URL, { headers: { Authorization: header } }),
      );
      expect(res.status).toBe(500);
      const lines = consoleLines();
      expect(lines.error).toEqual([REFUSED_SECRET_LINES.unset]);
      expect(lines.warn).toEqual([]);
      expect(lines.info).toEqual([]);
      for (const line of [...lines.error, await res.text()]) {
        expect(line).not.toContain(header.slice("Bearer ".length));
        expect(line).not.toContain(SECRET.slice(0, 16));
      }
    },
  );

  test.each(headers.slice(0, 2))(
    "CRON_SECRET set, header %j → 401 and exactly one warning line",
    async (header) => {
      vi.stubEnv("CRON_SECRET", SECRET);
      const route = await loadRoute();
      const res = await route.GET(
        new Request(URL, { headers: { Authorization: header } }),
      );
      expect(res.status).toBe(401);
      const lines = consoleLines();
      expect(lines.warn).toEqual([REFUSED_UNAUTHORIZED_LINE]);
      expect(lines.error).toEqual([]);
      expect(lines.info).toEqual([]);
      for (const line of [...lines.warn, await res.text()]) {
        expect(line).not.toContain(header.slice("Bearer ".length));
        expect(line).not.toContain(SECRET.slice(0, 16));
      }
    },
  );
});

describe("a non-local database outside Vercel Production → 500 through the route (T2, ADV.7)", () => {
  test.each([
    [undefined, "postgresql://u:p@db.example.invalid:5432/postgres"],
    [
      "preview",
      "postgresql://u:p@aws-0-ca-central-1.pooler.supabase.com:6543/postgres",
    ],
    [
      "development",
      "postgresql://u:p@localhost:5432/x?host=db.example.invalid",
    ],
  ])(
    "VERCEL_ENV %s with a remote host → 500, the client never imported",
    async (vercelEnv, url) => {
      vi.stubEnv("CRON_SECRET", SECRET);
      vi.stubEnv("VERCEL_ENV", vercelEnv);
      vi.stubEnv("POSTGRES_PRISMA_URL", url);
      const route = await loadRoute();
      const res = await route.GET(
        new Request(URL, { headers: { Authorization: `Bearer ${SECRET}` } }),
      );
      expect(res.status).toBe(500);
      const text = await res.text();
      expect(JSON.parse(text)).toEqual(NON_LOCAL_DATABASE_BODY);
      expect(prismaImports).toBe(0);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(fsSpies.mkdtemp).not.toHaveBeenCalled();
      const lines = consoleLines();
      expect(lines.error).toEqual([REFUSED_NON_LOCAL_LINE]);
      for (const line of [text, ...lines.error]) {
        expect(line).not.toContain("u:p@");
        expect(line).not.toContain(SECRET);
      }
    },
  );
});
