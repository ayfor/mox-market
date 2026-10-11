// T12, unit half (AC-10; S0.1d10): every scratch-db helper refuses a
// non-local URL before it constructs a pg.Client or spawns Prisma.
import { beforeEach, describe, expect, test, vi } from "vitest";

const clientBuilt = vi.fn();
const spawned = vi.fn();

vi.mock("pg", async (importOriginal) => {
  const actual = await importOriginal<typeof import("pg")>();
  class SpyClient {
    constructor() {
      clientBuilt();
      throw new Error("a pg.Client was constructed");
    }
  }
  const pg = { ...actual, Client: SpyClient };
  return { ...pg, default: pg };
});

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    spawnSync: (...args: unknown[]) => {
      spawned(...args);
      throw new Error("a process was spawned");
    },
  };
});

const {
  createScratchDatabase,
  dropScratchDatabase,
  prismaCli,
  probeScratchServer,
  SCRATCH_NAME,
} = await import("./scratch-db");
const { scratchDatabaseName } = await import("./local-db");

const REMOTE = [
  "postgresql://postgres:pw@db.abcdefgh.supabase.co:5432/postgres",
  "postgresql://postgres:pw@localhost:5432/postgres?host=db.x.supabase.co",
  "postgresql://postgres:pw@localhost:5432/postgres?hostaddr=10.1.2.3",
  "postgresql://postgres:pw@aws-0-us-east-1.pooler.supabase.com:6543/postgres",
];
const REFUSAL =
  /refusing (non-local database host|a database URL with no host)/;

beforeEach(() => {
  clientBuilt.mockClear();
  spawned.mockClear();
});

describe("scratch-db refuses non-local URLs before any client (T12)", () => {
  test.each(REMOTE)("createScratchDatabase(%s)", async (url) => {
    await expect(createScratchDatabase(url, "mox_x")).rejects.toThrow(REFUSAL);
    expect(clientBuilt).not.toHaveBeenCalled();
  });

  test.each(REMOTE)("dropScratchDatabase(%s)", async (url) => {
    await expect(dropScratchDatabase(url, "mox_x_1")).rejects.toThrow(REFUSAL);
    expect(clientBuilt).not.toHaveBeenCalled();
  });

  test.each(REMOTE)("prismaCli(…, %s) spawns nothing", (url) => {
    expect(() => prismaCli(["migrate", "deploy"], url)).toThrow(REFUSAL);
    expect(spawned).not.toHaveBeenCalled();
  });

  test.each([
    "POSTGRES_URL_NON_POOLING",
    "POSTGRES_PRISMA_URL",
    "DATABASE_URL",
  ])("probeScratchServer refuses a remote %s before probing", async (name) => {
    await expect(
      probeScratchServer({
        POSTGRES_URL_NON_POOLING:
          "postgresql://postgres:pw@127.0.0.1:1/mox_market",
        [name]: REMOTE[0],
      }),
    ).rejects.toThrow(REFUSAL);
    expect(clientBuilt).not.toHaveBeenCalled();
  });

  test("a local server URL reaches the client constructor (the spy is live)", async () => {
    await expect(
      createScratchDatabase(
        "postgresql://postgres:pw@localhost:55432/postgres",
        "mox_x",
      ),
    ).rejects.toThrow("a pg.Client was constructed");
    expect(clientBuilt).toHaveBeenCalledOnce();
  });

  test.each([
    "mox_market",
    "postgres",
    "template1",
    "mox_s01_x",
    "mox_s01_x_1",
  ])(
    "dropScratchDatabase refuses %s, which scratchDatabaseName never returns (ADV.11)",
    async (name) => {
      await expect(
        dropScratchDatabase(
          "postgresql://postgres:pw@localhost:55432/postgres",
          name,
        ),
      ).rejects.toThrow("bad scratch database name");
      expect(clientBuilt).not.toHaveBeenCalled();
    },
  );

  test("dropScratchDatabase accepts a scratchDatabaseName name (it reaches the client)", async () => {
    const name = scratchDatabaseName("mox_s01_x");
    expect(name).toMatch(SCRATCH_NAME);
    await expect(
      dropScratchDatabase(
        "postgresql://postgres:pw@localhost:55432/postgres",
        name,
      ),
    ).rejects.toThrow("a pg.Client was constructed");
    expect(clientBuilt).toHaveBeenCalledOnce();
  });

  test("dropScratchDatabase refuses an unsafe database name", async () => {
    await expect(
      dropScratchDatabase(
        "postgresql://postgres:pw@localhost:55432/postgres",
        'x"; DROP DATABASE mox_market; --',
      ),
    ).rejects.toThrow("bad scratch database name");
    expect(clientBuilt).not.toHaveBeenCalled();
  });
});
