// Legal copy for ruling R6: the site footer and the recommendation disclaimer.
//
// Verbatim from docs/specs/attribution-footer.md, never paraphrased (AGENTS.md
// Legal text). legal.test.ts asserts each string equals its spec blockquote,
// so change the spec (vault note first) and this file together. String
// literals only: this module imports nothing and never loads markdown at
// runtime (S2.2d2). The affiliate line ships at affiliate launch, not here.

/** The one link in the footer, in footer line 1. */
export const FAN_CONTENT_POLICY_LINK = Object.freeze({
  text: "Fan Content Policy",
  href: "https://company.wizards.com/en/legal/fancontentpolicy",
} as const);

/**
 * Footer line 1 split around its link, so the footer renders the link
 * without splitting strings at render time. before + link.text + after is
 * SITE_FOOTER_LINES[0].
 */
export const FAN_CONTENT_LINE = Object.freeze({
  before: "Mox Market is unofficial Fan Content permitted under the ",
  link: FAN_CONTENT_POLICY_LINK,
  after:
    ". Not approved/endorsed by Wizards. Portions of the materials used are property of Wizards of the Coast. ©Wizards of the Coast LLC.",
} as const);

/** The three footer lines, in spec order ("## Site footer, every page"). */
export const SITE_FOOTER_LINES: readonly [string, string, string] =
  Object.freeze([
    FAN_CONTENT_LINE.before +
      FAN_CONTENT_POLICY_LINK.text +
      FAN_CONTENT_LINE.after,
    "This product uses TCGplayer data but is not endorsed or certified by TCGplayer.",
    "Card prices are daily estimates from third-party sources and are not guaranteed. Recommendations are automated informational signals, not financial, investment, or purchasing advice.",
  ] as const);

/**
 * Placed next to the recommendation itself ("## Recommendation-adjacent
 * disclaimer"). S2.1 renders it below the reason line in the panel.
 */
export const RECOMMENDATION_DISCLAIMER =
  "Recommendations are automated informational signals derived from third-party price data that updates daily. They are estimates, not personalized financial, investment, or purchasing advice, and accuracy is not guaranteed. You are responsible for your own purchase decisions.";
