import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

// S1.1d4. Vitest 4 removed environmentMatchGlobs, so three projects carry the
// environment split: *.test.ts runs in node, *.test.tsx in jsdom with RTL, and
// *.int.test.ts in node, one file at a time. Every project reads the same four
// roots; tests/contract/test-discovery.int.test.ts fails on any test file that
// no project collects (ADV.4).
const TEST_ROOTS = "{src,prisma,scripts,tests}";

// S1.3 ADV-1: Vitest rewrites every snapshot when this variable is truthy,
// even in CI, which would let a params change pass the inline-snapshot
// guardrail. A .env file never sets it, and a CI run drops it, so CI never
// writes a snapshot; src/lib/recommendation/params.test.ts also fails any CI
// run whose update mode is not "none", whatever set it.
const SNAPSHOT_UPDATE_VAR = "UPDATE_SNAPSHOT";
const ciValue = process.env.CI;
const IN_CI =
  (ciValue !== undefined && ciValue !== "" && ciValue !== "false") ||
  Boolean(process.env.GITHUB_ACTIONS);

export default defineConfig(({ mode }) => {
  // Vitest does not load .env. Load every variable (the "" prefix opts out of
  // Vite's VITE_-only filter) without overwriting anything already exported.
  const env = loadEnv(mode, root, "");
  for (const [key, value] of Object.entries(env)) {
    if (key === SNAPSHOT_UPDATE_VAR) continue;
    if (process.env[key] === undefined) process.env[key] = value;
  }
  if (IN_CI) delete process.env[SNAPSHOT_UPDATE_VAR];

  const shared = {
    plugins: [react()],
    resolve: { alias: { "@": path.resolve(root, "src") } },
  };

  return {
    ...shared,
    test: {
      projects: [
        {
          ...shared,
          test: {
            name: "unit",
            environment: "node",
            include: [`${TEST_ROOTS}/**/*.test.ts`],
            exclude: [
              "**/node_modules/**",
              "**/*.int.test.ts",
              "scripts/__fixtures__/**",
            ],
            typecheck: {
              enabled: true,
              include: [`${TEST_ROOTS}/**/*.test-d.ts`],
              exclude: ["**/node_modules/**", "scripts/__fixtures__/**"],
              // Engine-only program: Next's generated .next/types stay out (S1.1d4).
              // Its include must cover every *.test-d.ts: tsc never sees a file
              // outside it, and that file's type tests pass silently (ADV.4).
              tsconfig: "tsconfig.vitest.json",
            },
          },
        },
        {
          ...shared,
          test: {
            name: "component",
            environment: "jsdom",
            include: [`${TEST_ROOTS}/**/*.test.tsx`],
            exclude: ["**/node_modules/**", "scripts/__fixtures__/**"],
            setupFiles: ["src/test/setup-dom.ts"],
          },
        },
        {
          ...shared,
          test: {
            name: "integration",
            environment: "node",
            include: [`${TEST_ROOTS}/**/*.int.test.ts`],
            exclude: ["**/node_modules/**", "scripts/__fixtures__/**"],
            fileParallelism: false,
            testTimeout: 60_000,
            hookTimeout: 60_000,
          },
        },
      ],
    },
  };
});
