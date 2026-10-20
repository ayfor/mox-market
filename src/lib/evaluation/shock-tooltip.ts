// F3's shock tooltip for the result page (S3.2d9; F3 §UI, F1 locked copy):
// SHOCK_TOOLTIP filled with signedX, "+" or "−" (U+2212) then
// Math.round(|magnitude|), so half rounds away from zero. Pure formatting
// over the served signals; adds no wording (S3.2d10).
import { fillTemplate, SHOCK_TOOLTIP } from "@/lib/recommendation/copy";
import type { ShockAnnotation } from "@/lib/recommendation/types";

/** The plus sign for a rise. */
const PLUS = "+";

/** The minus sign for a fall (U+2212, as tiles.ts and copy.ts use). */
const MINUS = "−";

/** signedX for SHOCK_TOOLTIP: "+45", "−46". */
export function shockSignedX(magnitude: number): string {
  const sign = magnitude < 0 ? MINUS : PLUS;
  return `${sign}${Math.round(Math.abs(magnitude))}`;
}

/** "Price moved +45% over the last 7 days." for a served shock annotation. */
export function shockTooltip(annotation: ShockAnnotation): string {
  return fillTemplate(SHOCK_TOOLTIP, {
    signedX: shockSignedX(annotation.magnitude),
  });
}
