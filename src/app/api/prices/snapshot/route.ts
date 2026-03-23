/**
 * POST /api/prices/snapshot
 * Fetches current prices from Scryfall for all tracked cards and stores snapshots.
 * Called by Vercel cron job daily, or manually via the Refresh button.
 *
 * Body: { cardIds?: string[] }
 * - If cardIds provided, only snapshot those cards
 * - If omitted, snapshot all tracked cards in the database
 *
 * Also accepts GET for cron job invocation (no body needed).
 */

import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

const SCRYFALL_COLLECTION_URL = "https://api.scryfall.com/cards/collection";

export async function GET(request: Request) {
  // Verify cron secret in production
  const authHeader = request.headers.get("authorization");
  if (
    process.env.CRON_SECRET &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return snapshotAllTrackedCards();
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const cardIds: string[] | undefined = body.cardIds;

  if (cardIds && cardIds.length > 0) {
    return snapshotSpecificCards(cardIds);
  }

  return snapshotAllTrackedCards();
}

async function snapshotAllTrackedCards() {
  const tracked = await prisma.trackedCard.findMany();

  if (tracked.length === 0) {
    return NextResponse.json({ message: "No tracked cards", snapshots: 0 });
  }

  const ids = tracked.map((c) => c.id);
  return snapshotSpecificCards(ids);
}

async function snapshotSpecificCards(cardIds: string[]) {
  // Batch fetch from Scryfall (75 per request max)
  interface ScryfallResult {
    id: string;
    name: string;
    set: string;
    set_name: string;
    collector_number: string;
    prices: Record<string, string | null>;
  }
  const allCards: ScryfallResult[] = [];

  for (let i = 0; i < cardIds.length; i += 75) {
    const chunk = cardIds.slice(i, i + 75);
    const identifiers = chunk.map((id) => ({ id }));

    // Throttle between chunks
    if (i > 0) {
      await new Promise((r) => setTimeout(r, 100));
    }

    const res = await fetch(SCRYFALL_COLLECTION_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "MoxMarket/0.1.0",
      },
      body: JSON.stringify({ identifiers }),
    });

    if (res.ok) {
      const data = await res.json();
      allCards.push(...data.data);
    }
  }

  // Ensure all cards exist in tracked_cards table
  for (const card of allCards) {
    await prisma.trackedCard.upsert({
      where: { id: card.id },
      create: {
        id: card.id,
        name: card.name ?? "Unknown",
        set: card.set ?? "",
        setName: card.set_name ?? "",
        collectorNumber: card.collector_number ?? "",
      },
      update: {},
    });
  }

  // Create snapshots
  const snapshots = allCards.map((card) => ({
    cardId: card.id,
    usd: card.prices.usd ? parseFloat(card.prices.usd) : null,
    usdFoil: card.prices.usd_foil ? parseFloat(card.prices.usd_foil) : null,
    eur: card.prices.eur ? parseFloat(card.prices.eur) : null,
    eurFoil: card.prices.eur_foil ? parseFloat(card.prices.eur_foil) : null,
    tix: card.prices.tix ? parseFloat(card.prices.tix) : null,
  }));

  await prisma.priceSnapshot.createMany({ data: snapshots });

  return NextResponse.json({
    message: `Snapshot complete`,
    snapshots: snapshots.length,
    timestamp: new Date().toISOString(),
  });
}
