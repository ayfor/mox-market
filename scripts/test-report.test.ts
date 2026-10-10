// T10 (AC-6): the report script's pure functions.
import { describe, expect, test } from "vitest";
import * as reportModule from "./test-report.mjs";

type Assertion = { status: string; title?: string; fullName?: string };
type Suite = {
  name: string;
  status?: string;
  message?: string;
  startTime?: number;
  endTime?: number;
  assertionResults: Assertion[];
};
type Report = { success?: boolean; testResults: Suite[] };
type Rendered = { markdown: string; allGreen: boolean };

const {
  featureOf,
  typeOf,
  renderReport,
  envWarnings,
  parseArgs,
  renderStub,
  FEATURE_ORDER,
} = reportModule as unknown as {
  featureOf: (file: string) => string;
  typeOf: (file: string) => string;
  renderReport: (
    report: Report,
    opts: { root: string; generatedAt?: string; exitCode?: number },
  ) => Rendered;
  envWarnings: (env: Record<string, string | undefined>) => string[];
  parseArgs: (argv: string[]) => { config?: string; out?: string };
  renderStub: (opts: { generatedAt?: string; exitCode?: number }) => string;
  FEATURE_ORDER: string[];
};

const ROOT = "/repo";
const passed = (title: string): Assertion => ({
  status: "passed",
  title,
  fullName: title,
});
const failed = (title: string): Assertion => ({
  status: "failed",
  title,
  fullName: title,
});
const suite = (
  file: string,
  assertions: Assertion[],
  extra: Partial<Suite> = {},
): Suite => ({
  name: `${ROOT}/${file}`,
  status: assertions.some((a) => a.status === "failed") ? "failed" : "passed",
  startTime: 0,
  endTime: 5,
  assertionResults: assertions,
  ...extra,
});
const render = (report: Report, exitCode = 0) =>
  renderReport(report, {
    root: ROOT,
    generatedAt: "2026-10-10 00:00 UTC",
    exitCode,
  });

describe("featureOf", () => {
  test.each([
    ["src/lib/price-history/reader.test.ts", "F0 · Price History"],
    ["src/lib/price_history.int.test.ts", "F0 · Price History"],
    ["src/app/api/prices/sync-mtgjson/route.test.ts", "F0 · Price History"],
    ["scripts/MTGJson-load.test.ts", "F0 · Price History"],
    ["src/lib/price-sync/run.test.ts", "F0 · Price History"],
    ["src/lib/recommendation/tier2.test.ts", "F3 · Market Adjustments"],
    ["src/lib/recommendation/volatility.test.ts", "F3 · Market Adjustments"],
    ["src/lib/recommendation/shock.test.ts", "F3 · Market Adjustments"],
    ["src/lib/classification/rules.test.ts", "F4 · Card Classification"],
    ["src/lib/Category.test.ts", "F4 · Card Classification"],
    ["src/lib/recommendation-log/write.test.ts", "F5 · Recommendation Log"],
    ["src/lib/ops/digest.test.ts", "F5 · Recommendation Log"],
    ["src/app/[card]/disagree.test.tsx", "F5 · Recommendation Log"],
    ["src/app/[card]/page.test.tsx", "F2 · Live Evaluation"],
    ["src/app/evaluate/form.test.tsx", "F2 · Live Evaluation"],
    ["src/app/api/cards/route.test.ts", "F2 · Live Evaluation"],
    ["src/components/footer.test.tsx", "F2 · Live Evaluation"],
    ["src/lib/ui-copy.test.ts", "F2 · Live Evaluation"],
    ["src/app/page.test.tsx", "F2 · Live Evaluation"],
    ["src/lib/recommendation/params.test.ts", "F1 · Recommendation Engine"],
    ["src/lib/prisma.test.ts", "F1 · Recommendation Engine"],
    ["prisma/migrate-guard.test.ts", "F1 · Recommendation Engine"],
    ["prisma/baseline.int.test.ts", "F1 · Recommendation Engine"],
    ["scripts/test-report.test.ts", "F1 · Recommendation Engine"],
    ["src/test/environment.test.tsx", "F1 · Recommendation Engine"],
    ["tests/contract/readme.test.ts", "F1 · Recommendation Engine"],
    ["tests/helpers/local-db.test.ts", "F1 · Recommendation Engine"],
  ])("%s → %s", (file, feature) => {
    expect(featureOf(file)).toBe(feature);
  });

  test("[card] is the literal route segment, not a character class (C3.5)", () => {
    expect(featureOf("src/app/[card]/page.test.tsx")).toBe(
      "F2 · Live Evaluation",
    );
    expect(featureOf("src/app/a/x.test.ts")).toBe("Unmapped");
    expect(featureOf("src/app/c/x.test.ts")).toBe("Unmapped");
  });

  test("an unknown path is Unmapped", () => {
    expect(featureOf("src/lib/scryfall.test.ts")).toBe("Unmapped");
    expect(featureOf("")).toBe("Unmapped");
  });

  test("Windows separators map like POSIX ones", () => {
    expect(featureOf("src\\lib\\recommendation\\params.test.ts")).toBe(
      "F1 · Recommendation Engine",
    );
  });
});

describe("typeOf", () => {
  test.each([
    ["prisma/baseline.int.test.ts", "integration"],
    ["src/app/x.int.test.tsx", "integration"],
    ["src/test/environment.test.tsx", "component"],
    ["src/lib/recommendation/params.test.ts", "unit"],
    ["src/lib/recommendation/types.test-d.ts", "unit"],
  ])("%s → %s", (file, type) => {
    expect(typeOf(file)).toBe(type);
  });
});

describe("renderReport", () => {
  test("lists features in the order F0, F1, F2, F3, F4, F5, Unmapped", () => {
    expect(FEATURE_ORDER).toEqual([
      "F0 · Price History",
      "F1 · Recommendation Engine",
      "F2 · Live Evaluation",
      "F3 · Market Adjustments",
      "F4 · Card Classification",
      "F5 · Recommendation Log",
      "Unmapped",
    ]);
    const files = [
      "src/lib/scryfall.test.ts",
      "src/lib/recommendation-log/a.test.ts",
      "src/lib/classification/a.test.ts",
      "src/lib/recommendation/trend.test.ts",
      "src/components/a.test.tsx",
      "src/lib/recommendation/params.test.ts",
      "src/lib/price-history/a.test.ts",
    ];
    const { markdown, allGreen } = render({
      success: true,
      testResults: files.map((f) => suite(f, [passed("ok")])),
    });
    expect(allGreen).toBe(true);
    const byFeature = markdown
      .split("## By feature")[1]
      .split("## By test type")[0];
    const order = FEATURE_ORDER.map((name) => byFeature.indexOf(`| ${name} |`));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(markdown).toContain("✅ All green");
    expect(markdown).not.toContain("❌");
  });

  test("an Unmapped row appears whenever a file is unmapped, and only then", () => {
    const mapped = render({
      success: true,
      testResults: [
        suite("src/lib/recommendation/params.test.ts", [passed("a")]),
      ],
    });
    expect(mapped.markdown).not.toContain("| Unmapped |");
    const unmapped = render({
      success: true,
      testResults: [suite("src/lib/scryfall.test.ts", [passed("a")])],
    });
    expect(unmapped.markdown).toContain(
      "| Unmapped | 1 | 1 | 1 | 0 | 0 | ✅ |",
    );
  });

  test("a failed assertion renders ❌ and names the test under Failures", () => {
    const { markdown, allGreen } = render(
      {
        success: false,
        testResults: [
          suite("src/lib/recommendation/params.test.ts", [
            passed("a"),
            failed("b is red"),
          ]),
        ],
      },
      1,
    );
    expect(allGreen).toBe(false);
    expect(markdown).toContain("❌ Failures present");
    expect(markdown).toContain("## ❌ Failures");
    expect(markdown).toContain("  - b is red");
  });

  test("a failed suite with zero assertions renders ❌ and a Failures entry (C3.2)", () => {
    const { markdown, allGreen } = render({
      testResults: [
        {
          name: `${ROOT}/src/lib/recommendation/broken.test.ts`,
          status: "failed",
          message: "Failed to load url ./missing\n    at stack",
          assertionResults: [],
        },
      ],
    });
    expect(allGreen).toBe(false);
    expect(markdown).toContain("❌ Failures present");
    expect(markdown).not.toContain("✅ All green");
    expect(markdown).toContain("- `src/lib/recommendation/broken.test.ts`");
    expect(markdown).toContain(
      "  - suite failed: Failed to load url ./missing",
    );
    expect(markdown).not.toContain("at stack");
  });

  test("report.success === false alone is not green", () => {
    const { allGreen, markdown } = render({
      success: false,
      testResults: [
        suite("src/lib/recommendation/params.test.ts", [passed("a")]),
      ],
    });
    expect(allGreen).toBe(false);
    expect(markdown).toContain("## ❌ Failures");
  });

  test("a non-zero vitest exit alone is not green (typecheck or unhandled errors)", () => {
    const { allGreen, markdown } = render(
      {
        success: true,
        testResults: [
          suite("src/lib/recommendation/params.test.ts", [passed("a")]),
        ],
      },
      1,
    );
    expect(allGreen).toBe(false);
    expect(markdown).toContain("vitest exit 1");
  });

  test("an empty report is green only when vitest itself succeeded", () => {
    expect(render({ success: true, testResults: [] }).allGreen).toBe(true);
    expect(render({ testResults: [] }, 1).allGreen).toBe(false);
  });

  test("skipped assertions are counted in the Skipped column", () => {
    const { markdown } = render({
      success: true,
      testResults: [
        suite("prisma/baseline.int.test.ts", [
          { status: "skipped", title: "deploys" },
          { status: "pending", title: "diffs" },
        ]),
      ],
    });
    expect(markdown).toContain(
      "| F1 · Recommendation Engine | 1 | 2 | 0 | 0 | 2 | ✅ |",
    );
    expect(markdown).toContain("| integration | 1 | 2 |");
  });

  test("the stub says vitest produced no results", () => {
    const stub = renderStub({ generatedAt: "x", exitCode: 2 });
    expect(stub).toContain("# Mox Market — Test Report");
    expect(stub).toContain("vitest produced no results (exit 2)");
    expect(stub).not.toContain("All green");
  });
});

describe("envWarnings", () => {
  test("warns on a missing POSTGRES_PRISMA_URL, not DATABASE_URL", () => {
    const warnings = envWarnings({});
    expect(warnings.some((w) => w.includes("POSTGRES_PRISMA_URL"))).toBe(true);
    expect(warnings.some((w) => w.includes("DATABASE_URL"))).toBe(false);
  });

  test("is quiet when both database URLs are set", () => {
    expect(
      envWarnings({
        POSTGRES_PRISMA_URL:
          "postgresql://postgres:postgres@localhost:5432/mox_market",
        POSTGRES_URL_NON_POOLING:
          "postgresql://postgres:postgres@localhost:5432/mox_market",
      }),
    ).toEqual([]);
  });
});

describe("parseArgs", () => {
  test("reads --config and --out in both forms", () => {
    expect(parseArgs([])).toEqual({ config: undefined, out: undefined });
    expect(parseArgs(["--config", "a.mts", "--out=b.md"])).toEqual({
      config: "a.mts",
      out: "b.md",
    });
  });

  test("refuses unknown arguments and a flag without a value", () => {
    expect(() => parseArgs(["--watch"])).toThrow("unknown argument: --watch");
    expect(() => parseArgs(["--out"])).toThrow("--out needs a value");
  });
});
