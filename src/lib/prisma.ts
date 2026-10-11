import { PrismaClient } from "@/generated/prisma/client";
import {
  HISTORY_POOL_LIMITS,
  type PoolLimits,
  rootCertFrom,
  runtimePoolConfig,
} from "@/lib/prisma-pool";
import { PrismaPg } from "@prisma/adapter-pg";

// One name is the runtime contract (S1.1d19): no DATABASE_URL fallback, and a
// missing URL fails loudly at module load instead of connecting to nothing.
const connectionString = process.env.POSTGRES_PRISMA_URL;
if (!connectionString) {
  throw new Error("POSTGRES_PRISMA_URL unset");
}
// S0.1d20: the root a remote host's certificate must chain to (unset: Node's
// CA store). Never plaintext and never unverified to a remote host.
const caCert = rootCertFrom(process.env.POSTGRES_SSL_ROOT_CERT);

const globalForPrisma = globalThis as unknown as {
  prisma: InstanceType<typeof PrismaClient> | undefined;
  historyPrisma: InstanceType<typeof PrismaClient> | undefined;
};

function createClient(url: string, limits?: PoolLimits) {
  const adapter = new PrismaPg(runtimePoolConfig(url, { caCert, limits }));
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createClient(connectionString);

/**
 * The history reader's own client (S0.1d21): a bounded pool, so a read that
 * F2's race abandoned frees its slot within query_timeout instead of queueing
 * later reads behind it. No connection opens until the first read.
 */
export const historyPrisma =
  globalForPrisma.historyPrisma ??
  createClient(connectionString, HISTORY_POOL_LIMITS);

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
  globalForPrisma.historyPrisma = historyPrisma;
}
