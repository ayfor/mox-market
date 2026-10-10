import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

// S1.1d4. Vitest 4 removed environmentMatchGlobs, so three projects carry the
// environment split: *.test.ts runs in node, *.test.tsx in jsdom with RTL, and
// *.int.test.ts in node, one file at a time.
export default defineConfig(({ mode }) => {
  // Vitest does not load .env. Load every variable (the "" prefix opts out of
  // Vite's VITE_-only filter) without overwriting anything already exported.
  const env = loadEnv(mode, root, "");
  for (const [key, value] of Object.entries(env)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }

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
            include: ["{src,prisma,scripts,tests}/**/*.test.ts"],
            exclude: [
              "**/node_modules/**",
              "**/*.int.test.ts",
              "scripts/__fixtures__/**",
            ],
            typecheck: {
              enabled: true,
              include: ["src/**/*.test-d.ts"],
              // Engine-only program: Next's generated .next/types stay out (S1.1d4).
              tsconfig: "tsconfig.vitest.json",
            },
          },
        },
        {
          ...shared,
          test: {
            name: "component",
            environment: "jsdom",
            include: ["src/**/*.test.tsx"],
            setupFiles: ["src/test/setup-dom.ts"],
          },
        },
        {
          ...shared,
          test: {
            name: "integration",
            environment: "node",
            include: ["{src,prisma,scripts,tests}/**/*.int.test.ts"],
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
