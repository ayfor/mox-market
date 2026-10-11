// ADV.4 (S0.2d17): the ingest client's client-side query timeout, on a real
// local server. A statement that never answers (a laptop that slept, a
// dropped Wi-Fi connection with no RST) would otherwise leave the run row
// `running` forever; pg rejects it after query_timeout instead, and the run
// ends `error`. pg_sleep stands in for the silent server. Unreachable
// server: fails when CI=true, skips with a warning otherwise.
import { describe, expect, test } from "vitest";
import {
  CI_UNREACHABLE_TEST,
  IN_CI,
  probeScratchServer,
} from "../../../tests/helpers/scratch-db";
import { createIngestDb } from "./db";

const server = await probeScratchServer();

describe.runIf(IN_CI && !server.reachable)(
  "the ingest client (CI without a database)",
  () => {
    test(CI_UNREACHABLE_TEST, () => {
      expect.fail(
        `local Postgres unreachable in CI (${server.reachable ? "" : server.reason})`,
      );
    });
  },
);

describe.skipIf(!server.reachable)(
  "the ingest client's query timeout (ADV.4)",
  () => {
    test(
      "a statement with no answer rejects after query_timeout, and the next one runs",
      { timeout: 20_000 },
      async () => {
        const db = await createIngestDb(server.url!, { queryTimeoutMs: 300 });
        try {
          const started = Date.now();
          await expect(db.query("SELECT pg_sleep(3)")).rejects.toThrow(
            /Query read timeout/,
          );
          expect(Date.now() - started).toBeLessThan(2_500);
        } finally {
          await db.end().catch(() => undefined);
        }
        const fresh = await createIngestDb(server.url!);
        try {
          const result = await fresh.query("SELECT 1 AS one");
          expect(result.rows).toEqual([{ one: 1 }]);
        } finally {
          await fresh.end();
        }
      },
    );
  },
);
