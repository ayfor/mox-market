// S4.1 T1 (AC-1), T2 (AC-2), T3 (AC-3), T5's unit half (AC-6) and T6's
// classify half (production safety): F4's classifier. Every expected value
// was worked out from F4's rules alone before the build (plan, Test
// Manifest). asOf is the engine fixtures' 2026-10-10.
import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { afterEach, describe, expect, test, vi } from "vitest";
import { classify } from "./classify";
import {
  CLASSIFY_FIXTURES,
  classifyFixtureNamed,
  FIXTURE_AS_OF,
  legalIn,
} from "./fixtures";
import { RECOMMENDATION_PARAMS } from "./params";
import {
  CARD_AGES,
  DEFAULT_CARD_CATEGORY,
  FORMAT_PROFILES,
  POPULARITY_BUCKETS,
  type CardCategory,
  type ClassifiableCard,
} from "./types";

const AS_OF = "2026-10-10";
const CATEGORY_KEYS = [
  "reservedList",
  "age",
  "popularity",
  "formatProfile",
  "digital",
];

const withField = (field: keyof ClassifiableCard, value: unknown) =>
  ({ [field]: value }) as ClassifiableCard;

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the AC-1 fixtures (T1)", () => {
  test("the fixtures pin the engine's asOf", () => {
    expect(FIXTURE_AS_OF).toBe(AS_OF);
  });

  test("the plan's expected categories, abbreviated in Fields-table order", () => {
    const rows = Object.fromEntries(
      CLASSIFY_FIXTURES.map((f) => [
        f.name,
        [
          f.expected.reservedList,
          f.expected.age,
          f.expected.popularity,
          f.expected.formatProfile,
          f.expected.digital,
        ],
      ]),
    );
    expect(rows).toStrictEqual({
      "CL-RESERVED": [true, "vintage-era", "top5000", "edh", false],
      "CL-RECENT": [false, "recent", "longtail", "competitive", false],
      "CL-TOP1000": [false, "modern-era", "top1000", "competitive", false],
      "CL-STANDARD": [false, "modern-era", "unranked", "competitive", false],
      "CL-COMMANDER": [false, "modern-era", "top5000", "edh", false],
      "CL-PRE8ED": [false, "vintage-era", "longtail", "edh", false],
      "CL-8ED": [false, "modern-era", "longtail", "edh", false],
      "CL-DIGITAL": [false, "modern-era", "unranked", "casual", true],
      "CL-PREVIEW": [false, "recent", "unranked", "casual", false],
      "CL-DEFAULT": [false, "unknown", "unranked", "casual", false],
    });
    expect(classifyFixtureNamed("CL-DEFAULT").expected).toStrictEqual(
      DEFAULT_CARD_CATEGORY,
    );
  });

  test.each(CLASSIFY_FIXTURES.map((f) => [f.name, f] as const))(
    "%s classifies to its expected category, with exactly the five keys",
    (_name, fixture) => {
      const category = classify(fixture.card, AS_OF);
      expect(category).toStrictEqual(fixture.expected);
      expect(Object.keys(category)).toEqual(CATEGORY_KEYS);
    },
  );

  test("every value is one of F4's Fields-table values", () => {
    for (const { card } of CLASSIFY_FIXTURES) {
      const c = classify(card, AS_OF);
      expect(CARD_AGES).toContain(c.age);
      expect(POPULARITY_BUCKETS).toContain(c.popularity);
      expect(FORMAT_PROFILES).toContain(c.formatProfile);
      expect(typeof c.reservedList).toBe("boolean");
      expect(typeof c.digital).toBe("boolean");
    }
  });

  test("with the clock faked to 2031-01-01 every result is unchanged (classify never reads the clock)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2031-01-01T00:00:00Z"));
    for (const { card, expected } of CLASSIFY_FIXTURES) {
      expect(classify(card, AS_OF)).toStrictEqual(expected);
    }
  });

  test("age is measured at the caller's asOf: CL-RECENT is recent at 2026-12-01 (122 days) and modern-era at 2027-02-01 (184 days)", () => {
    const { card } = classifyFixtureNamed("CL-RECENT");
    expect(classify(card, "2026-12-01").age).toBe("recent");
    expect(classify(card, "2027-02-01").age).toBe("modern-era");
  });

  test("the inputs are not mutated", () => {
    for (const { card } of CLASSIFY_FIXTURES) {
      const before = structuredClone(card);
      classify(Object.freeze({ ...card }), AS_OF);
      expect(card).toStrictEqual(before);
    }
  });

  test("a 2025 reprint of a 1994 card is classified by its own released_at (F4)", () => {
    const reprint = {
      ...classifyFixtureNamed("CL-RESERVED").card,
      released_at: "2026-08-01",
    };
    expect(classify(reprint, AS_OF).age).toBe("recent");
  });
});

describe("popularity (T2, AC-2; S4.1d4)", () => {
  test.each([
    [1, "top1000"],
    [1000, "top1000"],
    [1001, "top5000"],
    [5000, "top5000"],
    [5001, "longtail"],
    [30000, "longtail"],
  ] as const)("edhrec_rank %s gives %s", (rank, bucket) => {
    expect(classify(withField("edhrec_rank", rank), AS_OF).popularity).toBe(
      bucket,
    );
  });

  test.each([
    ["undefined", undefined],
    ["null", null],
    ["0", 0],
    ["-3", -3],
    ["1.5", 1.5],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ['"12"', "12"],
    ["2 ** 53", 2 ** 53],
  ])("edhrec_rank %s gives unranked", (_label, rank) => {
    expect(classify(withField("edhrec_rank", rank), AS_OF).popularity).toBe(
      "unranked",
    );
  });

  test("an absent edhrec_rank gives unranked", () => {
    expect(classify({}, AS_OF).popularity).toBe("unranked");
  });

  test("the bucket bounds are the params (moving one moves the boundary)", () => {
    const params = {
      ...RECOMMENDATION_PARAMS,
      edhrecTop1Rank: 10,
      edhrecTop2Rank: 20,
    };
    const at = (rank: number) =>
      classify(withField("edhrec_rank", rank), AS_OF, params).popularity;
    expect([at(10), at(11), at(20), at(21)]).toEqual([
      "top1000",
      "top5000",
      "top5000",
      "longtail",
    ]);
  });
});

describe("age (T3, AC-3; S4.1d5)", () => {
  test.each([
    ['""', ""],
    ['"2026-02-30"', "2026-02-30"],
    ['"2026-10-1"', "2026-10-1"],
    ['"26-10-01"', "26-10-01"],
    ['"not a date"', "not a date"],
    ['"2026-10-10T00:00:00Z"', "2026-10-10T00:00:00Z"],
    ['"0099-01-01"', "0099-01-01"],
    ["20261010", 20261010],
    ["null", null],
    ["true", true],
    ["undefined", undefined],
  ])("released_at %s gives unknown", (_label, value) => {
    expect(classify(withField("released_at", value), AS_OF).age).toBe(
      "unknown",
    );
  });

  test("an absent released_at gives unknown", () => {
    expect(classify({}, AS_OF).age).toBe("unknown");
  });

  test.each([
    ["2026-04-10", "183 days", "modern-era"],
    ["2026-04-11", "182 days", "recent"],
    ["2026-10-10", "0 days", "recent"],
    ["2026-11-14", "future, clamped to 0", "recent"],
    ["2003-07-28", "8th Edition", "modern-era"],
    ["2003-07-27", "the day before 8th Edition", "vintage-era"],
  ])("released_at %s (%s) at asOf 2026-10-10 gives %s", (date, _why, age) => {
    expect(classify(withField("released_at", date), AS_OF).age).toBe(age);
  });

  test.each([["2026-13-01"], [""], ["2026-10-10T12:00:00Z"]])(
    "an invalid asOf %j gives unknown",
    (asOf) => {
      expect(classify(withField("released_at", "2026-08-01"), asOf).age).toBe(
        "unknown",
      );
    },
  );

  test("with recentPrintingDays 0 a future printing is not recent (clamped age 0 is not < 0) and reads modern-era", () => {
    const params = { ...RECOMMENDATION_PARAMS, recentPrintingDays: 0 };
    expect(
      classify(withField("released_at", "2026-11-14"), AS_OF, params).age,
    ).toBe("modern-era");
    expect(classify(withField("released_at", AS_OF), AS_OF, params).age).toBe(
      "modern-era",
    );
  });

  test("the era boundary is modernEraStart (moving it moves the boundary)", () => {
    const params = { ...RECOMMENDATION_PARAMS, modernEraStart: "2010-01-01" };
    const at = (date: string) =>
      classify(withField("released_at", date), AS_OF, params).age;
    expect([at("2009-12-31"), at("2010-01-01")]).toEqual([
      "vintage-era",
      "modern-era",
    ]);
  });

  test("the recent window is recentPrintingDays (moving it moves the boundary)", () => {
    const params = { ...RECOMMENDATION_PARAMS, recentPrintingDays: 10 };
    const at = (date: string) =>
      classify(withField("released_at", date), AS_OF, params).age;
    expect([at("2026-10-01"), at("2026-09-30")]).toEqual([
      "recent",
      "modern-era",
    ]);
  });

  test("leap days and month ends count as UTC calendar days", () => {
    // 2024-02-29 is real; 183 days before 2024-08-30 is 2024-02-29.
    expect(
      classify(withField("released_at", "2024-02-29"), "2024-08-30").age,
    ).toBe("modern-era");
    expect(
      classify(withField("released_at", "2024-03-01"), "2024-08-30").age,
    ).toBe("recent");
    expect(classify(withField("released_at", "2025-02-29"), AS_OF).age).toBe(
      "unknown",
    );
  });
});

describe("formatProfile (F4's decision rule; S4.1d4)", () => {
  test.each([
    [["standard"], "competitive"],
    [["pioneer"], "competitive"],
    [["modern"], "competitive"],
    [["modern", "commander"], "competitive"],
    [["commander"], "edh"],
    [["commander", "legacy", "vintage"], "edh"],
    [["legacy", "vintage", "pauper"], "casual"],
    [[], "casual"],
  ] as const)("legal in %j gives %s", (formats, profile) => {
    expect(
      classify({ legalities: legalIn(...formats) }, AS_OF).formatProfile,
    ).toBe(profile);
  });

  test.each(["restricted", "banned", "not_legal", "LEGAL", true, 1])(
    "a competitive format at %j is not legal",
    (status) => {
      expect(
        classify(
          { legalities: { ...legalIn(), modern: status, commander: status } },
          AS_OF,
        ).formatProfile,
      ).toBe("casual");
    },
  );

  test("a missing key counts as not legal", () => {
    expect(
      classify({ legalities: { commander: "legal" } }, AS_OF).formatProfile,
    ).toBe("edh");
  });

  test("an inherited key is not read (only the record's own keys count)", () => {
    const inherited = Object.create({ standard: "legal" });
    expect(classify({ legalities: inherited }, AS_OF).formatProfile).toBe(
      "casual",
    );
  });
});

describe("reservedList and digital are exactly true or false", () => {
  test.each([
    [true, true],
    [false, false],
    ["true", false],
    [1, false],
    [null, false],
    [undefined, false],
  ])("reserved %j gives %s and digital %j gives %s", (value, expected) => {
    expect(classify(withField("reserved", value), AS_OF).reservedList).toBe(
      expected,
    );
    expect(classify(withField("digital", value), AS_OF).digital).toBe(expected);
  });
});

describe("production safety: hostile and missing fields (T6; S4.1d4)", () => {
  test.each([
    ["null", null],
    ["undefined", undefined],
    ['"x"', "x" as never],
    ["42", 42 as never],
    ["an array", [] as never],
  ])("classify(%s) returns the defaults without throwing", (_label, card) => {
    expect(classify(card, AS_OF)).toStrictEqual(DEFAULT_CARD_CATEGORY);
  });

  const DEFAULT_FOR: Record<string, Partial<CardCategory>> = {
    legalities: { formatProfile: "casual" },
    reserved: { reservedList: false },
    digital: { digital: false },
  };

  test.each([
    ["legalities", null],
    ["legalities", []],
    ["legalities", "legal"],
    ["legalities", { standard: true }],
    ["reserved", "true"],
    ["digital", 1],
  ] as const)("%s %j returns the default for that field", (field, value) => {
    const category = classify(withField(field, value), AS_OF);
    expect(category).toMatchObject(DEFAULT_FOR[field]);
    expect(category).toStrictEqual(DEFAULT_CARD_CATEGORY);
  });

  test("a card with none of the five fields classifies to DEFAULT_CARD_CATEGORY", () => {
    expect(classify({}, AS_OF)).toStrictEqual(DEFAULT_CARD_CATEGORY);
  });

  test("DEFAULT_CARD_CATEGORY is frozen and holds F4's Fields-table defaults", () => {
    expect(Object.isFrozen(DEFAULT_CARD_CATEGORY)).toBe(true);
    expect(DEFAULT_CARD_CATEGORY).toStrictEqual({
      reservedList: false,
      age: "unknown",
      popularity: "unranked",
      formatProfile: "casual",
      digital: false,
    });
  });

  test("classify's result is a fresh object, never DEFAULT_CARD_CATEGORY itself", () => {
    expect(classify({}, AS_OF)).not.toBe(DEFAULT_CARD_CATEGORY);
  });
});

describe("no fetch for classification (T5, AC-6; S4.1d13)", () => {
  test("with fetch stubbed to a throwing spy, classify over every fixture and every T2/T3 input returns and the spy has no call", () => {
    const spy = vi.fn(() => {
      throw new Error("classify must not fetch");
    });
    vi.stubGlobal("fetch", spy);
    const inputs: ClassifiableCard[] = [
      ...CLASSIFY_FIXTURES.map((f) => f.card),
      ...[1, 1000, 1001, 5000, 5001, null, 0, -3, 1.5, Number.NaN, "12"].map(
        (rank) => withField("edhrec_rank", rank),
      ),
      ...["", "2026-02-30", "not a date", null, true, "2026-04-10"].map(
        (date) => withField("released_at", date),
      ),
    ];
    for (const card of inputs) {
      expect(() => classify(card, AS_OF)).not.toThrow();
    }
    expect(spy).not.toHaveBeenCalled();
  });

  const SOURCE_FILE = path.join(__dirname, "classify.ts");
  const SOURCE = readFileSync(SOURCE_FILE, "utf8");

  test("classify.ts imports exactly ./params, ./types and ./window (AST scan)", () => {
    const sf = ts.createSourceFile(
      SOURCE_FILE,
      SOURCE,
      ts.ScriptTarget.Latest,
      true,
    );
    const specs: string[] = [];
    const visit = (node: ts.Node) => {
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      ) {
        specs.push(node.moduleSpecifier.text);
      }
      if (
        ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) &&
            node.expression.text === "require"))
      ) {
        specs.push("<dynamic>");
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
    expect(specs.sort()).toEqual(["./params", "./types", "./window"]);
  });

  test("classify.ts's code names no fetch, XMLHttpRequest or clock", () => {
    const sf = ts.createSourceFile(
      SOURCE_FILE,
      SOURCE,
      ts.ScriptTarget.Latest,
      true,
    );
    const identifiers = new Set<string>();
    const visit = (node: ts.Node) => {
      if (ts.isIdentifier(node)) identifiers.add(node.text);
      ts.forEachChild(node, visit);
    };
    visit(sf);
    for (const name of ["fetch", "XMLHttpRequest", "Date", "performance"]) {
      expect(identifiers.has(name), name).toBe(false);
    }
  });
});
