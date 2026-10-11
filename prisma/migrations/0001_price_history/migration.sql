-- One transaction (S0.1 ADV.2): prisma migrate deploy sends a migration's
-- statements one by one, so without it a failure part-way would leave some
-- of the objects below behind and the migration marked failed.
BEGIN;

-- CreateEnum
CREATE TYPE "card_finish" AS ENUM ('normal', 'foil', 'etched');

-- CreateEnum
CREATE TYPE "price_sync_trigger" AS ENUM ('cron', 'bulk', 'identifiers');

-- CreateEnum
CREATE TYPE "price_sync_status" AS ENUM ('running', 'ok', 'source_stale', 'budget_stop', 'error');

-- CreateTable
CREATE TABLE "price_history" (
    "scryfall_id" UUID NOT NULL,
    "finish" "card_finish" NOT NULL,
    "date" DATE NOT NULL,
    "price_cents" INTEGER NOT NULL,
    "synced_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "price_history_pkey" PRIMARY KEY ("scryfall_id","finish","date")
);

-- CreateTable
CREATE TABLE "mtgjson_identifiers" (
    "mtgjson_uuid" UUID NOT NULL,
    "scryfall_id" UUID NOT NULL,
    "side" TEXT,
    "edhrec_rank" INTEGER,
    "loaded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mtgjson_identifiers_pkey" PRIMARY KEY ("mtgjson_uuid")
);

-- CreateTable
CREATE TABLE "price_sync_runs" (
    "id" SERIAL NOT NULL,
    "trigger" "price_sync_trigger" NOT NULL,
    "status" "price_sync_status" NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(3),
    "source_date" DATE,
    "source_version" TEXT,
    "rows_written" INTEGER NOT NULL DEFAULT 0,
    "rows_pruned" INTEGER NOT NULL DEFAULT 0,
    "unmapped_uuids" INTEGER NOT NULL DEFAULT 0,
    "db_bytes" BIGINT,
    "error" TEXT,

    CONSTRAINT "price_sync_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "price_sync_runs_status_finished_at_idx" ON "price_sync_runs"("status", "finished_at");

-- Hand-added (F0 §Fields, C2-A.8): Prisma's schema cannot express these two.
ALTER TABLE "price_history" ADD CONSTRAINT "price_history_price_cents_check" CHECK ("price_cents" > 0);
ALTER TABLE "price_history" SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_vacuum_insert_scale_factor = 0.02);

-- Hand-added (S0.1 ADV.7): row level security with no policy, so Supabase's
-- anon and authenticated roles can neither read nor write these tables
-- through the Data API. The owning role, which the app, the ingest and the
-- cron use, is not subject to it.
ALTER TABLE "price_history" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtgjson_identifiers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "price_sync_runs" ENABLE ROW LEVEL SECURITY;

COMMIT;
