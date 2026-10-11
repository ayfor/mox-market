// Unit and component setup (S0.1 ADV.10, S0.1d23): neither project ever
// reaches Postgres. Since S0.1 the default history reader imports
// @/lib/prisma on its first call, so a test that leaves the reader at its
// default would otherwise open a connection to whatever POSTGRES_PRISMA_URL
// holds (CI exports one to every step). Here both clients refuse every use
// with a message saying why; the integration project, which is meant to
// reach the local database, does not load this file. A unit test of the real
// module (src/lib/prisma.test.ts) opts out with vi.unmock("@/lib/prisma").
import { afterAll, vi } from "vitest";

const barrier = vi.hoisted(() => {
  const message =
    "unit and component tests must not reach Postgres: pass emptyHistoryReader or a fake client";
  /** A stand-in client: any property read throws (except a thenable probe). */
  const refusingClient = () =>
    new Proxy(
      {},
      {
        get(_target, property) {
          if (typeof property === "symbol" || property === "then") {
            return undefined;
          }
          throw new Error(message);
        },
      },
    );
  return {
    message,
    module: () => ({
      prisma: refusingClient(),
      historyPrisma: refusingClient(),
    }),
  };
});

export const NO_DATABASE_MESSAGE = barrier.message;

/** The mocked @/lib/prisma, for a test that lifted the barrier and restores it. */
export const refusingPrismaModule = barrier.module;

vi.mock("@/lib/prisma", () => barrier.module());

// No database URL either: removed (not blanked, so a test that reads .env
// files itself still sees an unexported variable) and put back after the
// file, so nothing leaks into a later file that shares this worker.
const DATABASE_URL_VARS = [
  "POSTGRES_PRISMA_URL",
  "POSTGRES_URL_NON_POOLING",
  "DATABASE_URL",
] as const;
const saved = DATABASE_URL_VARS.map((name) => [name, process.env[name]]);
for (const name of DATABASE_URL_VARS) delete process.env[name];
afterAll(() => {
  for (const [name, value] of saved) {
    if (value === undefined) delete process.env[name!];
    else process.env[name!] = value;
  }
});
