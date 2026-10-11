// @vitest-environment jsdom
// T3 (AC-2, AC-3) and T4 (AC-15; C2-B.10): the one validator both forms use,
// and the submit marker S5.1 consumes. jsdom, for T4's history half.
import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, test, vi } from "vitest";
import {
  ENTRY_SUBMISSIONS,
  HOSTILE_NAMES,
  REJECTED_ENTRIES,
} from "./__fixtures__/entry-submissions";
import {
  checkEntry,
  clearSubmitMarker,
  consumerMarkerKey,
  isEntryEmpty,
  markSubmit,
  RESERVED_TOP_LEVEL_SEGMENTS,
  submitMarkerKey,
  type MarkerEnv,
} from "./entry-submit";
import { resultHref } from "./result-href";

const ROOT = path.resolve(__dirname, "..", "..");

/** Next's metadata files: served at the root under their own names. */
const METADATA_FILE =
  /^(favicon\.ico|(icon|apple-icon|opengraph-image|twitter-image)\d*\.\w+|robots\.\w+|sitemap\.\w+|manifest\.\w+)$/;

/** A file that makes its directory a route of its own. */
const ROUTE_FILE = /^(page|route)\.[cm]?[jt]sx?$/;

/**
 * Every top-level path a built route or a static file answers, read from
 * disk: each src/app directory that is not dynamic ([x]), a group ((x)),
 * private (_x) or a parallel slot (@x) and holds its own page or route file
 * (a directory with only nested routes, such as api, falls through to
 * [card], checked on `next start`); each metadata file at the app root (only
 * favicon.ico today: another one fails here until its served name is added);
 * and each file at the top of public (a public directory falls through too).
 */
function staticTopLevelSegments(): string[] {
  const segments = new Set<string>();
  const app = path.join(ROOT, "src/app");
  for (const entry of readdirSync(app, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (/^[[(_@]/.test(entry.name)) continue;
      const own = readdirSync(path.join(app, entry.name));
      if (own.some((name) => ROUTE_FILE.test(name))) segments.add(entry.name);
    } else if (METADATA_FILE.test(entry.name)) {
      expect(entry.name, "a new metadata file: add its served name").toBe(
        "favicon.ico",
      );
      segments.add(entry.name);
    }
  }
  for (const entry of readdirSync(path.join(ROOT, "public"), {
    withFileTypes: true,
  })) {
    if (entry.isFile()) segments.add(entry.name);
  }
  return [...segments].sort();
}

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("checkEntry (T3, AC-2, AC-3)", () => {
  test.each(REJECTED_ENTRIES.map((row) => [row.name, row]))(
    "%s → its status",
    (_name, row) => {
      expect(checkEntry(row.card, row.price)).toEqual({ status: row.status });
    },
  );

  test.each(ENTRY_SUBMISSIONS.map((row) => [row.card, row]))(
    "%j → ok with exactly its href",
    (_card, row) => {
      expect(checkEntry(row.card, row.price)).toEqual({
        status: "ok",
        href: row.href,
      });
    },
  );

  test("empty wins over a bad card, and a bad card over a bad price", () => {
    expect(checkEntry("..", "")).toEqual({ status: "empty" });
    expect(checkEntry("..", "74.999")).toEqual({ status: "bad_card" });
  });

  test("a 142-code-point card fails the guard; 141 passes", () => {
    expect(checkEntry("x".repeat(142), "1")).toEqual({ status: "bad_card" });
    expect(checkEntry("x".repeat(141), "1").status).toBe("ok");
  });

  test("never throws: 1,000 random strings over every code point, lone surrogates included (ADV-2)", () => {
    // A fixed-seed generator, so a failure reproduces.
    let seed = 0x2f6e2b1;
    const next = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed;
    };
    // A quarter printable ASCII (so some cards pass), a quarter lone
    // surrogates (U+D800 to U+DFFF), the rest anywhere up to U+10FFFF.
    const randomUnit = () => {
      const pick = next() % 4;
      if (pick === 0) return String.fromCharCode(0x20 + (next() % 0x5f));
      if (pick === 1) return String.fromCharCode(0xd800 + (next() % 0x800));
      return String.fromCodePoint(next() % 0x110000);
    };
    const randomString = () =>
      Array.from({ length: next() % 24 }, randomUnit).join("");
    const LONE_SURROGATE = /\p{Cs}/u;
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i += 1) {
      const card = i % 5 === 0 ? `Esper${randomUnit()}` : randomString();
      const price = i % 3 === 0 ? String(1 + (next() % 99999)) : randomString();
      let result: ReturnType<typeof checkEntry> | undefined;
      expect(() => {
        result = checkEntry(card, price);
      }).not.toThrow();
      expect(() => isEntryEmpty(card, price)).not.toThrow();
      expect(["empty", "bad_card", "bad_price", "ok"]).toContain(
        result!.status,
      );
      seen.add(result!.status);
      if (result!.status === "ok") {
        expect(LONE_SURROGATE.test(card)).toBe(false);
        expect(result!.href).toBe(resultHref(card, price));
      }
    }
    // The generator reaches every branch, so the property is not vacuous.
    expect([...seen].sort()).toEqual(["bad_card", "bad_price", "empty", "ok"]);
  });

  test.each([
    ["a high surrogate at the end", "Esper\uD800"],
    ["a low surrogate at the start", "\uDC00Sentinel"],
    ["a reversed pair", "Esper \uDE00\uD83D"],
  ])(
    "%s with a valid price → bad_card, never a URIError (ADV-2)",
    (_name, card) => {
      expect(checkEntry(card, "5")).toEqual({ status: "bad_card" });
      expect(isEntryEmpty(card, "5")).toBe(false);
    },
  );

  test("isEntryEmpty: true only when a field is empty or whitespace", () => {
    expect(isEntryEmpty("", "5")).toBe(true);
    expect(isEntryEmpty("Esper", " \t")).toBe(true);
    expect(isEntryEmpty("..", "x")).toBe(false);
    expect(isEntryEmpty("Esper\uD800", "5")).toBe(false);
  });

  test.each([...RESERVED_TOP_LEVEL_SEGMENTS])(
    "a card that is exactly the built route %j → bad_card (ADV-6)",
    (segment) => {
      expect(checkEntry(segment, "1")).toEqual({ status: "bad_card" });
      expect(checkEntry(` ${segment} `, "1")).toEqual({ status: "bad_card" });
    },
  );

  test("only an exact match is reserved: routes are case-sensitive, a longer name is a card, and a path no route answers stays a card (ADV-6, C2-B.11 = A)", () => {
    for (const card of [
      "Sample",
      "SAMPLE",
      "samples",
      "Evaluate",
      "api",
      "_next",
      "assets",
      "import",
      "about",
    ]) {
      expect(checkEntry(card, "1")).toEqual({
        status: "ok",
        href: resultHref(card, "1"),
      });
    }
  });

  test("RESERVED_TOP_LEVEL_SEGMENTS is exactly the top-level routes and files of src/app and public (ADV-6)", () => {
    expect(staticTopLevelSegments()).toEqual(
      [...RESERVED_TOP_LEVEL_SEGMENTS].sort(),
    );
    expect(Object.isFrozen(RESERVED_TOP_LEVEL_SEGMENTS)).toBe(true);
  });
});

/** A sessionStorage stand-in over a Map. */
function memoryStorage() {
  const items = new Map<string, string>();
  return {
    items,
    storage: {
      setItem: vi.fn((key: string, value: string) => {
        items.set(key, value);
      }),
      removeItem: vi.fn((key: string) => {
        items.delete(key);
      }),
    },
  };
}

describe("the submit marker (T4, AC-15)", () => {
  test("markSubmit stores a v4 UUID under mm:submit:<href> and returns true", () => {
    const { items, storage } = memoryStorage();
    const env: MarkerEnv = {
      storage: () => storage,
      uuid: () => crypto.randomUUID(),
    };
    const href = "/Esper%20Sentinel?price=74.99";
    expect(markSubmit(href, env)).toBe(true);
    expect([...items.keys()]).toEqual([`mm:submit:${href}`]);
    expect(submitMarkerKey(href)).toBe(`mm:submit:${href}`);
    const first = items.get(`mm:submit:${href}`)!;
    expect(first).toMatch(UUID_V4);
    expect(markSubmit(href, env)).toBe(true);
    const second = items.get(`mm:submit:${href}`)!;
    expect(second).toMatch(UUID_V4);
    expect(second).not.toBe(first);
    expect(items.size).toBe(1);
  });

  test("the default env writes to the global sessionStorage with crypto.randomUUID", () => {
    const { items, storage } = memoryStorage();
    vi.stubGlobal("sessionStorage", storage);
    try {
      expect(markSubmit("/x?price=1")).toBe(true);
      expect(items.get("mm:submit:/x?price=1")).toMatch(UUID_V4);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test.each<[string, () => MarkerEnv]>([
    [
      "setItem throwing SecurityError",
      () => ({
        storage: () => ({
          setItem: () => {
            throw new DOMException("blocked", "SecurityError");
          },
          removeItem: () => {},
        }),
        uuid: () => crypto.randomUUID(),
      }),
    ],
    [
      "setItem throwing QuotaExceededError",
      () => ({
        storage: () => ({
          setItem: () => {
            throw new DOMException("full", "QuotaExceededError");
          },
          removeItem: () => {},
        }),
        uuid: () => crypto.randomUUID(),
      }),
    ],
    [
      "a sessionStorage getter that throws",
      () => ({
        storage: () => {
          throw new DOMException("denied", "SecurityError");
        },
        uuid: () => crypto.randomUUID(),
      }),
    ],
    [
      "no sessionStorage",
      () => ({ storage: () => undefined, uuid: () => crypto.randomUUID() }),
    ],
    [
      "crypto.randomUUID undefined (an insecure origin)",
      () => ({
        storage: () => memoryStorage().storage,
        uuid: () =>
          (
            ({ randomUUID: undefined }) as unknown as {
              randomUUID: () => string;
            }
          ).randomUUID(),
      }),
    ],
  ])("%s → false, never a throw", (_name, env) => {
    expect(() => markSubmit("/x?price=1", env())).not.toThrow();
    expect(markSubmit("/x?price=1", env())).toBe(false);
  });

  test("the default env with a throwing sessionStorage getter and no randomUUID → false", () => {
    const original = Object.getOwnPropertyDescriptor(
      globalThis,
      "sessionStorage",
    );
    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      get() {
        throw new DOMException("denied", "SecurityError");
      },
    });
    try {
      expect(markSubmit("/x?price=1")).toBe(false);
    } finally {
      if (original)
        Object.defineProperty(globalThis, "sessionStorage", original);
      else delete (globalThis as { sessionStorage?: unknown }).sessionStorage;
    }
    const { storage } = memoryStorage();
    vi.stubGlobal("sessionStorage", storage);
    vi.stubGlobal("crypto", {});
    try {
      expect(markSubmit("/x?price=1")).toBe(false);
      expect(storage.setItem).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("clearSubmitMarker (ADV-5)", () => {
  test("removes only that href's marker and returns true", () => {
    const { items, storage } = memoryStorage();
    const env: MarkerEnv = {
      storage: () => storage,
      uuid: () => crypto.randomUUID(),
    };
    markSubmit("/A?price=1", env);
    markSubmit("/B?price=1", env);
    expect(clearSubmitMarker("/A?price=1", env)).toBe(true);
    expect([...items.keys()]).toEqual(["mm:submit:/B?price=1"]);
    // Clearing a marker that is not there is harmless.
    expect(clearSubmitMarker("/A?price=1", env)).toBe(true);
    expect([...items.keys()]).toEqual(["mm:submit:/B?price=1"]);
  });

  test.each<[string, () => MarkerEnv]>([
    [
      "removeItem throwing SecurityError",
      () => ({
        storage: () => ({
          setItem: () => {},
          removeItem: () => {
            throw new DOMException("blocked", "SecurityError");
          },
        }),
        uuid: () => crypto.randomUUID(),
      }),
    ],
    [
      "a sessionStorage getter that throws",
      () => ({
        storage: () => {
          throw new DOMException("denied", "SecurityError");
        },
        uuid: () => crypto.randomUUID(),
      }),
    ],
    [
      "no sessionStorage",
      () => ({ storage: () => null, uuid: () => crypto.randomUUID() }),
    ],
  ])("%s → false, never a throw", (_name, env) => {
    expect(() => clearSubmitMarker("/x?price=1", env())).not.toThrow();
    expect(clearSubmitMarker("/x?price=1", env())).toBe(false);
  });

  test("the default env removes from the global sessionStorage", () => {
    const { items, storage } = memoryStorage();
    vi.stubGlobal("sessionStorage", storage);
    try {
      items.set("mm:submit:/x?price=1", "u");
      expect(clearSubmitMarker("/x?price=1")).toBe(true);
      expect(items.size).toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("consumerMarkerKey(window.location) matches submitMarkerKey(href) (T4, AC-15)", () => {
  const hrefs = [
    ...ENTRY_SUBMISSIONS.map((row) => row.href),
    ...HOSTILE_NAMES.map((name) => resultHref(name, "5")),
  ];

  test.each(hrefs.map((href) => [href]))("%s", (href) => {
    window.history.pushState(null, "", href);
    expect(consumerMarkerKey(window.location)).toBe(submitMarkerKey(href));
  });
});
