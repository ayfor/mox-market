import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import { defineConfig, globalIgnores } from "eslint/config";

// S1.1d5: billd's flat config. No rule is disabled globally; baseline
// exceptions are line-scoped and listed in the S1.1 plan's Deviations.
const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Mox Market: generated Prisma client and coverage output
    "src/generated/**",
    "coverage/**",
  ]),
]);

export default eslintConfig;
