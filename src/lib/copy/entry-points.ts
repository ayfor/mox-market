// The landing page's and the nav bar's strings (S2.4d5, S2.4d11; AC-10,
// C1.54), frozen, under S1.3's forbidden-phrase lint, copy hygiene and
// one-home suites like every module under src/lib/copy. Labels and marketing
// copy, not F1's locked table: the miss strings and the "soon" marker stay in
// ui-copy.ts. The ruby band's question is one string, the one LINT_ALLOWLIST
// entry (S1.3d14: a question to the user, not a prediction; Josh can
// overturn by rewording it); the page breaks it into its designed lines. The
// page title keeps its one home in the root layout's title.default. String
// literals only, so client components may import it.

/** Every visible string on the landing page, plus its meta description. */
export const LANDING_COPY = Object.freeze({
  /** The wordmark's two words. */
  wordmarkTop: "Mox",
  wordmarkBottom: "Market",
  tagline: "Market moves at instant speed.",
  /** The ruby band's question; the page sets its line breaks. */
  question: "Should you buy it?",
  /** The prompt above the form, one entry per designed line. */
  prompt: Object.freeze([
    "Enter a",
    "Card and",
    "a Price.",
    "We'll Tell",
    "You.",
  ] as const),
  description:
    "Enter a card and a price. We'll tell you. Single-card price evaluation against the 30-day market.",
  cardPlaceholder: "Card name...",
  pricePlaceholder: "$ Price",
} as const);

/** The nav bar's link and tab labels, and the accessible names of its two icon links. */
export const NAV_LABELS = Object.freeze({
  brand: "Mox Market",
  brandHome: "Mox Market home",
  evaluate: "Evaluate",
  import: "Import",
  about: "About",
  cta: "New Listing Analysis",
  ctaName: "New listing analysis",
} as const);
