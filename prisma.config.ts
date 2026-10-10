import { config as loadDotenv } from "dotenv";
import { defineConfig } from "prisma/config";
import { assertMigrateAllowed } from "./prisma/migrate-guard";

// The prod-migrate flag counts only when set inline for one command (AC-12),
// so read it before .env loads: a copy saved in any .env* file is ignored.
const inlineAllowProdMigrate = process.env["ALLOW_PROD_MIGRATE"];
loadDotenv({ quiet: true });

// Use direct (non-pooling) connection for migrations/db push
// Use pooled connection for runtime queries
const url =
  process.env["POSTGRES_URL_NON_POOLING"] ??
  process.env["POSTGRES_PRISMA_URL"] ??
  process.env["DATABASE_URL"];

// One object feeds both the guard and Prisma, so a shadowDatabaseUrl added here
// later (S0.1 drift checks) is checked too (ADV.2).
const datasource: { url?: string; shadowDatabaseUrl?: string } = { url };

// AC-13: refuse commands that reach a Supabase host unless ALLOW_PROD_MIGRATE=1.
assertMigrateAllowed({
  argv: process.argv.slice(2),
  url: datasource.url,
  shadowUrl: datasource.shadowDatabaseUrl,
  env: { ...process.env, ALLOW_PROD_MIGRATE: inlineAllowProdMigrate },
});

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource,
});
