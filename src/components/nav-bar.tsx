"use client";

import { NAV_LABELS } from "@/lib/copy/entry-points";
import { UI_COPY } from "@/lib/recommendation/ui-copy";
import Link from "next/link";
import "./nav-bar.css";

/** The one section with a page today; Import and About are "soon" (C1.45 = B). */
type NavSection = "evaluate";

type NavBarProps = {
  /** Which top-level section this page belongs to. Drives the active-tab highlight. */
  active?: NavSection;
};

/**
 * A tab with no page yet (S2.4d11, AC-14): a span, not a link, so it has no
 * href, takes no focus, never navigates and is never prefetched.
 */
function SoonTab({ label }: { label: string }) {
  return (
    <span
      className="mm-nav-link mm-nav-link--soon"
      role="tab"
      aria-disabled="true"
      aria-selected="false"
    >
      {label}
      <span className="mm-nav-soon">{UI_COPY.navSoon}</span>
    </span>
  );
}

/**
 * Canonical Mox Market navbar.
 *
 * Layout (full-width banner with internal padding, 1fr/auto/1fr grid):
 *   - Brand mark (logo + wordmark) on the left, links to /
 *   - Segmented `Evaluate / Import / About` pill in the center,
 *     active section gets a Ruby-tinted glass background (state indicator);
 *     Import and About are disabled "soon" segments until they exist
 *   - Solid Ruby `+ New Listing Analysis` CTA on the right (action)
 *
 * Per the design grammar in `software--mox-market-design-language.md`:
 *   solid = action, glass with tint = state. The CTA is solid Ruby; the
 *   active tab is glass with Ruby tint. Don't deviate without revisiting
 *   the grammar in that note. Every string comes from a copy module (C1.54).
 */
export function NavBar({ active = "evaluate" }: NavBarProps) {
  return (
    <nav className="mm-nav">
      <Link className="mm-brand" href="/" aria-label={NAV_LABELS.brandHome}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/assets/logo-mark.png" width={48} height={48} alt="" />
        <span className="mm-brand-text">{NAV_LABELS.brand}</span>
      </Link>

      <div className="mm-nav-links" role="tablist">
        <Link
          className={`mm-nav-link${active === "evaluate" ? "on" : ""}`}
          href="/evaluate"
          role="tab"
          aria-selected={active === "evaluate"}
        >
          {NAV_LABELS.evaluate}
        </Link>
        <SoonTab label={NAV_LABELS.import} />
        <SoonTab label={NAV_LABELS.about} />
      </div>

      <Link className="mm-nav-cta" href="/" aria-label={NAV_LABELS.ctaName}>
        <span className="mm-nav-cta-ico" aria-hidden="true">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
        </span>
        <span>{NAV_LABELS.cta}</span>
      </Link>
    </nav>
  );
}
