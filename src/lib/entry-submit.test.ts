// @vitest-environment jsdom
// T3 (AC-2, AC-3) and T4 (AC-15; C2-B.10): the one validator both forms use,
// and the submit marker S5.1 consumes. jsdom, for T4's history half.
import { describe, expect, test, vi } from "vitest";
import {
  ENTRY_SUBMISSIONS,
  HOSTILE_NAMES,
  REJECTED_ENTRIES,
} from "./__fixtures__/entry-submissions";
import {
  checkEntry,
  consumerMarkerKey,
  markSubmit,
  submitMarkerKey,
  type MarkerEnv,
} from "./entry-submit";
import { resultHref } from "./result-href";

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

  test("never throws: 200 random strings give one of the four statuses", () => {
    // A fixed-seed generator, so a failure reproduces.
    let seed = 0x2f6e2b1;
    const next = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed;
    };
    const randomString = () =>
      Array.from({ length: next() % 24 }, () =>
        String.fromCodePoint(next() % 0x2fff),
      ).join("");
    for (let i = 0; i < 200; i += 1) {
      const card = randomString();
      const price = i % 3 === 0 ? String(next() % 100000) : randomString();
      let result: ReturnType<typeof checkEntry> | undefined;
      expect(() => {
        result = checkEntry(card, price);
      }).not.toThrow();
      expect(["empty", "bad_card", "bad_price", "ok"]).toContain(
        result!.status,
      );
      if (result!.status === "ok") {
        expect(result!.href).toBe(resultHref(card, price));
      }
    }
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
