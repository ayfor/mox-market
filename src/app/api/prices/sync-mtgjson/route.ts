// GET /api/prices/sync-mtgjson: F0's daily MTGJson sync (S0.3; Design F0
// W2). Vercel Cron calls it with GET at 17:00 UTC (vercel.json), adding
// `Authorization: Bearer <CRON_SECRET>` when the variable is set. The GET
// writes, under Standards' narrow exception for a secret-guarded cron route
// (Josh, 2026-10-05): it fails closed, 500 when CRON_SECRET is unset and 401
// on a missing or wrong header, before anything else runs
// (src/lib/cron-auth.ts, src/lib/mtgjson/sync-handler.ts).
//
// Every other method answers 405 with `Allow: GET` and runs nothing. HEAD is
// exported explicitly because Next answers HEAD from GET when HEAD is absent,
// which would run a sync (S0.3d2). OPTIONS stays Next's own answer.
import { createSyncHandler } from "@/lib/mtgjson/sync-handler";

export const dynamic = "force-dynamic";
// Fluid compute is on (Bitey's read-only check, 2026-10-10): 300 s is the
// Hobby ceiling. The sync's own deadline is 30 s under it (SYNC_DEADLINE_MS).
export const maxDuration = 300;
// node:crypto (the guard) and node:zlib (the source).
export const runtime = "nodejs";

export const GET = createSyncHandler();

const methodNotAllowed = (): Response =>
  new Response(null, { status: 405, headers: { Allow: "GET" } });

export const POST = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
export const HEAD = methodNotAllowed;
