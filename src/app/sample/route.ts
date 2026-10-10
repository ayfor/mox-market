// The retired demo route (S2.4d10; AC-11, AC-12; C1.06 = A, C1.13 = C): a
// 307 to the canonical demo link, now that the result route serves specific
// cards. It reads nothing from the request, so any query is dropped and no
// input reaches Location; a static segment wins over [card], so the request
// never reaches the result route or Scryfall. 307, not 308: the target is a
// ruling that can change, and browsers cache a 308. Dynamic, so no build-time
// redirect is cached at the edge.
import { DEMO_RESULT_HREF } from "@/lib/result-href";

export const dynamic = "force-dynamic";

function redirectToDemo(): Response {
  return new Response(null, {
    status: 307,
    headers: { Location: DEMO_RESULT_HREF, "Cache-Control": "no-store" },
  });
}

export function GET(): Response {
  return redirectToDemo();
}

export function HEAD(): Response {
  return redirectToDemo();
}
