// T3, T4 (S1.1 AC-2): F1's eleven params at design values, and PARAMS_VERSION.
// S1.3 T11 (AC-4) pins values and version in one inline snapshot; S1.3 T13
// checks each param's JSDoc.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, test } from "vitest";
import {
  canonicalJson,
  PARAMS_VERSION,
  paramsVersionOf,
  RECOMMENDATION_PARAMS,
  type RecommendationParams,
} from "./params";

const F1_PARAMS = {
  fairBandPct: 5,
  buyThresholdAsymmetry: 0.6,
  minSnapshotsForVerdict: 7,
  minSnapshotsForRange: 14,
  lowConfidenceSnapshotCount: 14,
  highConfidenceSnapshotCount: 28,
  trendThresholdPct: 0.5,
  minSnapshotsForTrend: 7,
  minSnapshotsForVolatility: 14,
  windowDays: 30,
  shortSlopeDays: 7,
};

describe("RECOMMENDATION_PARAMS (T3)", () => {
  test("deep-equals exactly F1's eleven params at design values", () => {
    expect(RECOMMENDATION_PARAMS).toStrictEqual(F1_PARAMS);
    expect(Object.keys(RECOMMENDATION_PARAMS).sort()).toEqual(
      Object.keys(F1_PARAMS).sort(),
    );
  });

  test("holds no F3 params or TIER2_ENABLED yet (S1.1d8, C3.7 = B)", () => {
    for (const key of [
      "TIER2_ENABLED",
      "staleDays",
      "trendShiftFactor",
      "volatileCV",
      "volatilityWideningCap",
      "lowConfidenceWidening",
      "shockWindowDays",
      "shockMagnitudePct",
    ]) {
      expect(RECOMMENDATION_PARAMS).not.toHaveProperty(key);
    }
  });

  test("is frozen, so a stray write cannot retune the engine", () => {
    expect(Object.isFrozen(RECOMMENDATION_PARAMS)).toBe(true);
    expect(() => {
      (RECOMMENDATION_PARAMS as { fairBandPct: number }).fairBandPct = 99;
    }).toThrow(TypeError);
    expect(RECOMMENDATION_PARAMS.fairBandPct).toBe(5);
  });
});

describe("PARAMS_VERSION (T4)", () => {
  test("is the first 8 hex chars of SHA-256 over sorted-key JSON", () => {
    const p = F1_PARAMS as Record<string, unknown>;
    const expected = createHash("sha256")
      .update(JSON.stringify(p, Object.keys(p).sort()))
      .digest("hex")
      .slice(0, 8);
    expect(PARAMS_VERSION).toMatch(/^[0-9a-f]{8}$/);
    expect(PARAMS_VERSION).toBe(expected);
    expect(paramsVersionOf(RECOMMENDATION_PARAMS)).toBe(PARAMS_VERSION);
  });

  test("ignores key order", () => {
    const reversed = Object.fromEntries(
      Object.entries(RECOMMENDATION_PARAMS).reverse(),
    ) as unknown as RecommendationParams;
    expect(Object.keys(reversed)[0]).toBe("shortSlopeDays");
    expect(paramsVersionOf(reversed)).toBe(PARAMS_VERSION);
  });

  test.each(Object.keys(F1_PARAMS))("changes when %s changes", (key) => {
    const bumped = {
      ...RECOMMENDATION_PARAMS,
      [key]: RECOMMENDATION_PARAMS[key as keyof RecommendationParams] + 1,
    };
    expect(paramsVersionOf(bumped)).not.toBe(PARAMS_VERSION);
  });

  test("canonicalJson sorts keys at every level", () => {
    expect(canonicalJson({ b: 1, a: { d: [{ y: 1, x: 2 }], c: null } })).toBe(
      '{"a":{"c":null,"d":[{"x":2,"y":1}]},"b":1}',
    );
  });
});

/**
 * Whether this run is CI by the rule Vitest uses (std-env): CI set to
 * anything but "false", or a CI provider's own variable (GitHub Actions').
 */
const inCI = (env: NodeJS.ProcessEnv) =>
  (env.CI !== undefined && env.CI !== "" && env.CI !== "false") ||
  Boolean(env.GITHUB_ACTIONS);

/** Why a run may not check snapshots this way, or null (ADV-1). */
function snapshotModeOffence(
  env: NodeJS.ProcessEnv,
  mode: string | undefined,
): string | null {
  if (!inCI(env) || mode === "none") return null;
  return `CI runs must never write snapshots, but the update mode is ${JSON.stringify(mode)}`;
}

describe("params guardrail (S1.3 T11, AC-4; C1.58)", () => {
  // ADV-1: Vitest turns any truthy UPDATE_SNAPSHOT (a shell, a workflow env
  // or a .env file loaded by vitest.config.mts) or -u into "rewrite every
  // snapshot", even in CI, and the snapshot below would then pass. This reads
  // the mode the run actually has, so every route fails in CI.
  test("self-test: in CI only the none mode passes", () => {
    expect(snapshotModeOffence({ CI: "true" }, "none")).toBeNull();
    expect(snapshotModeOffence({ GITHUB_ACTIONS: "true" }, "none")).toBeNull();
    expect(snapshotModeOffence({ CI: "true" }, "all")).toMatch(/"all"/);
    expect(snapshotModeOffence({ CI: "1" }, "new")).toMatch(/"new"/);
    expect(snapshotModeOffence({ GITHUB_ACTIONS: "true" }, "all")).toMatch(
      /"all"/,
    );
    expect(snapshotModeOffence({ CI: "true" }, undefined)).toMatch(/undefined/);
    expect(snapshotModeOffence({}, "all")).toBeNull();
    expect(snapshotModeOffence({ CI: "false" }, "new")).toBeNull();
  });

  test("a CI run never writes snapshots, whatever set the mode (ADV-1)", () => {
    const mode = expect.getState().snapshotState?.snapshotUpdateState;
    expect(mode).toMatch(/^(none|new|all)$/);
    expect(snapshotModeOffence(process.env, mode)).toBeNull();
  });

  // Values and version together, so the pin is not tautological: any value
  // change fails here unless the same change updates this snapshot, and CI
  // never writes snapshots (tests/contract/ci-workflow.test.ts). A change
  // still needs a plan-doc deviation and Josh's ruling (AGENTS.md).
  test("RECOMMENDATION_PARAMS and PARAMS_VERSION match the inline snapshot", () => {
    expect({ PARAMS_VERSION, RECOMMENDATION_PARAMS }).toMatchInlineSnapshot(`
      {
        "PARAMS_VERSION": "46ec1cd7",
        "RECOMMENDATION_PARAMS": {
          "buyThresholdAsymmetry": 0.6,
          "fairBandPct": 5,
          "highConfidenceSnapshotCount": 28,
          "lowConfidenceSnapshotCount": 14,
          "minSnapshotsForRange": 14,
          "minSnapshotsForTrend": 7,
          "minSnapshotsForVerdict": 7,
          "minSnapshotsForVolatility": 14,
          "shortSlopeDays": 7,
          "trendThresholdPct": 0.5,
          "windowDays": 30,
        },
      }
    `);
  });
});

// --- S1.3 T13: every param documents its meaning, unit and rationale --------
interface FieldDocs {
  readonly name: string;
  readonly doc: string | null;
}

/** Each property of `interface <name>` with its JSDoc text, read from the AST. */
function interfaceFieldDocs(
  file: string,
  source: string,
  name: string,
): FieldDocs[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const decl = sf.statements.find(
    (s): s is ts.InterfaceDeclaration =>
      ts.isInterfaceDeclaration(s) && s.name.text === name,
  );
  if (!decl) throw new Error(`interface ${name} not found in ${file}`);
  return decl.members.filter(ts.isPropertySignature).map((member) => {
    const docs = ts
      .getJSDocCommentsAndTags(member)
      .filter(ts.isJSDoc)
      .map((d) => d.getText(sf));
    return {
      name: member.name.getText(sf),
      doc: docs.length > 0 ? docs.join("\n") : null,
    };
  });
}

/** Fields whose JSDoc is missing, or lacks "Unit:" or "Why:". */
function undocumented(fields: FieldDocs[]): string[] {
  return fields.flatMap(({ name, doc }) => {
    if (doc === null) return [`${name}: no JSDoc`];
    return ["Unit:", "Why:"]
      .filter((label) => !doc.includes(label))
      .map((label) => `${name}: no ${label}`);
  });
}

describe("param docs (S1.3 T13; S1.3d9)", () => {
  const PARAMS_SOURCE = readFileSync(path.join(__dirname, "params.ts"), "utf8");

  test("self-test: flags an undocumented field and one missing Why:", () => {
    const sample = [
      "export interface Sample {",
      "  /** Meaning. Unit: percent. Why: F1. */",
      "  readonly good: number;",
      "  readonly bare: number;",
      "  // Unit: and Why: in a line comment do not count.",
      "  readonly lineComment: number;",
      "  /** Meaning. Unit: days. */",
      "  readonly noWhy: number;",
      "}",
    ].join("\n");
    expect(
      undocumented(interfaceFieldDocs("sample.ts", sample, "Sample")),
    ).toEqual(["bare: no JSDoc", "lineComment: no JSDoc", "noWhy: no Why:"]);
  });

  test("every field of RecommendationParams has Unit: and Why:", () => {
    const fields = interfaceFieldDocs(
      "params.ts",
      PARAMS_SOURCE,
      "RecommendationParams",
    );
    expect(fields.map((f) => f.name).sort()).toEqual(
      Object.keys(RECOMMENDATION_PARAMS).sort(),
    );
    expect(undocumented(fields)).toEqual([]);
  });
});
