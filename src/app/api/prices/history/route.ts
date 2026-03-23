/**
 * GET /api/prices/history?cardIds=id1,id2,id3&days=30
 * Returns price history for specified cards from the database.
 */

import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const cardIdsParam = searchParams.get("cardIds");
  const days = parseInt(searchParams.get("days") ?? "30", 10);

  if (!cardIdsParam) {
    return NextResponse.json(
      { error: "cardIds parameter required" },
      { status: 400 },
    );
  }

  const cardIds = cardIdsParam.split(",").filter(Boolean);

  if (cardIds.length === 0) {
    return NextResponse.json(
      { error: "At least one cardId required" },
      { status: 400 },
    );
  }

  if (cardIds.length > 75) {
    return NextResponse.json(
      { error: "Maximum 75 cards per request" },
      { status: 400 },
    );
  }

  const since = new Date();
  since.setDate(since.getDate() - days);

  const snapshots = await prisma.priceSnapshot.findMany({
    where: {
      cardId: { in: cardIds },
      timestamp: { gte: since },
    },
    orderBy: { timestamp: "asc" },
    select: {
      cardId: true,
      timestamp: true,
      usd: true,
      usdFoil: true,
      eur: true,
      eurFoil: true,
      tix: true,
    },
  });

  // Group by card ID
  const history: Record<
    string,
    Array<{
      timestamp: string;
      usd: number | null;
      usd_foil: number | null;
      eur: number | null;
      eur_foil: number | null;
      tix: number | null;
    }>
  > = {};

  for (const cardId of cardIds) {
    history[cardId] = [];
  }

  for (const s of snapshots) {
    history[s.cardId]?.push({
      timestamp: s.timestamp.toISOString(),
      usd: s.usd,
      usd_foil: s.usdFoil,
      eur: s.eur,
      eur_foil: s.eurFoil,
      tix: s.tix,
    });
  }

  return NextResponse.json({ history, days, cardCount: cardIds.length });
}
