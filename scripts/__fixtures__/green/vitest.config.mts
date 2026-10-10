// Fixture for scripts/test-report.int.test.ts (T11). Outside the main suite's
// include, so it only runs when the report script is pointed at it.
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  // Keep Vite's cache out of the repo (the fixture root has no node_modules).
  cacheDir: path.join(tmpdir(), "mox-market-report-fixtures"),
  test: {
    include: ["*.fixture.test.ts"],
    environment: "node",
  },
});
