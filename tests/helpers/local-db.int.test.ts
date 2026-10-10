// T21 (AC-11; ADV.6): probeLocalDatabase against real sockets. A port with no
// server is "unreachable" (the suite may skip); a server that answers and
// refuses is a configuration error that fails in every environment.
import { describe, expect, test } from "vitest";
import {
  LocalDatabaseRejectedError,
  probeLocalDatabase,
  scratchDatabaseName,
  withDatabase,
} from "./local-db";

const IN_CI = process.env.CI === "true";
const serverUrl = process.env.POSTGRES_URL_NON_POOLING;
const probe = serverUrl
  ? await probeLocalDatabase(serverUrl, 3_000)
  : { reachable: false as const, reason: "POSTGRES_URL_NON_POOLING unset" };

describe("probeLocalDatabase", () => {
  test("a local port with no server is unreachable, not an error", async () => {
    await expect(
      probeLocalDatabase("postgresql://postgres:postgres@127.0.0.1:1/x", 3_000),
    ).resolves.toEqual({ reachable: false, reason: "ECONNREFUSED" });
  });

  test("dual-stack localhost with no server is unreachable, not an error", async () => {
    await expect(
      probeLocalDatabase("postgresql://postgres:postgres@localhost:1/x", 3_000),
    ).resolves.toMatchObject({ reachable: false });
  });

  test("refuses a non-local host before connecting", async () => {
    await expect(
      probeLocalDatabase(
        "postgresql://postgres@localhost:5432/x?host=db.abc.supabase.co",
      ),
    ).rejects.toThrow(/non-local database host db\.abc\.supabase\.co/);
  });

  test.runIf(IN_CI && !probe.reachable)(
    "the postgres:16 service must be reachable in CI",
    () => {
      expect.fail(
        `local Postgres unreachable in CI (${probe.reachable ? "" : probe.reason})`,
      );
    },
  );

  test.skipIf(!probe.reachable)(
    "a running server with a missing database rejects with 3D000",
    async () => {
      const missing = withDatabase(
        serverUrl!,
        scratchDatabaseName("mox_missing"),
      );
      const result = probeLocalDatabase(missing, 3_000);
      await expect(result).rejects.toBeInstanceOf(LocalDatabaseRejectedError);
      await expect(result).rejects.toMatchObject({ code: "3D000" });
    },
  );
});
