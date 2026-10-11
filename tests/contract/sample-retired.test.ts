// T17 (AC-12; S2.4d10, S2.4d12): the V1 demo is gone. Only the redirect and
// its test remain under src/app/sample, no non-test source names the path,
// and the S1.3 and S2.2 contracts no longer list the deleted files.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

const ROOT = path.resolve(__dirname, "..", "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const toPosix = (p: string) => p.split(path.sep).join("/");

function filesUnder(dir: string): string[] {
  return readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap(
    (entry) => {
      const rel = toPosix(path.join(dir, entry.name));
      return entry.isDirectory() ? filesUnder(rel) : [rel];
    },
  );
}

const isTest = (f: string) => /\.(test|spec)(-d)?\.[cm]?[jt]sx?$/.test(f);

describe("the V1 demo is retired (T17, AC-12)", () => {
  test("src/app/sample holds only route.ts and route.test.ts", () => {
    expect(readdirSync(path.join(ROOT, "src/app/sample")).sort()).toEqual([
      "route.test.ts",
      "route.ts",
    ]);
    for (const gone of [
      "src/app/sample/page.tsx",
      "src/app/sample/page.test.tsx",
      "src/app/sample/decision-analysis.tsx",
      "src/app/sample/styles.css",
    ]) {
      expect(existsSync(path.join(ROOT, gone)), gone).toBe(false);
    }
  });

  test("no non-test file under src/ contains /sample", () => {
    const files = filesUnder("src").filter(
      (f) => !isTest(f) && !f.startsWith("src/generated/"),
    );
    expect(files).toEqual(
      expect.arrayContaining([
        "src/app/landing.css",
        "src/components/nav-bar.css",
      ]),
    );
    expect(files.filter((f) => read(f).includes("/sample"))).toEqual([]);
  });

  test("copy-lock's single-source exemptions no longer list the demo", () => {
    const source = read("tests/contract/copy-lock.test.ts");
    const list = /const SINGLE_SOURCE_EXEMPT = new Set\(\[([\s\S]*?)\]\)/.exec(
      source,
    );
    expect(list).not.toBeNull();
    expect(list![1]).not.toMatch(/sample/);
  });

  test("the footer contract no longer names the demo stylesheet or the demo page", () => {
    const source = read("tests/contract/site-footer.test.ts");
    expect(source).not.toMatch(/src\/app\/sample\//);
  });
});
