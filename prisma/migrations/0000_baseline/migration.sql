-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "tracked_cards" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "set" TEXT NOT NULL,
    "set_name" TEXT NOT NULL,
    "collector_number" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tracked_cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_snapshots" (
    "id" TEXT NOT NULL,
    "card_id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usd" DOUBLE PRECISION,
    "usd_foil" DOUBLE PRECISION,
    "eur" DOUBLE PRECISION,
    "eur_foil" DOUBLE PRECISION,
    "tix" DOUBLE PRECISION,

    CONSTRAINT "price_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "price_snapshots_card_id_timestamp_idx" ON "price_snapshots"("card_id", "timestamp");

-- AddForeignKey
ALTER TABLE "price_snapshots" ADD CONSTRAINT "price_snapshots_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "tracked_cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

