"use client";

import Link from "next/link";
import "./nav-bar.css";

type NavSection = "evaluate" | "import" | "about";

type NavBarProps = {
  /** Which top-level section this page belongs to. Drives the active-tab highlight. */
  active?: NavSection;
};

/**
 * Canonical Mox Market navbar.
 *
 * Layout (full-width banner with internal padding, 1fr/auto/1fr grid):
 *   - Brand mark (logo + wordmark) on the left, links to /
 *   - Segmented `Evaluate / Import / About` pill in the center,
 *     active section gets a Ruby-tinted glass background (state indicator)
 *   - Solid Ruby `+ New Listing Analysis` CTA on the right (action)
 *
 * Per the design grammar in `software--mox-market-design-language.md`:
 *   solid = action, glass with tint = state. The CTA is solid Ruby; the
 *   active tab is glass with Ruby tint. Don't deviate without revisiting
 *   the grammar in that note.
 */
export function NavBar({ active = "evaluate" }: NavBarProps) {
  return (
    <nav className="mm-nav">
      <Link className="mm-brand" href="/" aria-label="Mox Market home">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/assets/logo-mark.png" width={48} height={48} alt="" />
        <span className="mm-brand-text">Mox Market</span>
      </Link>

      <div className="mm-nav-links" role="tablist">
        <Link
          className={`mm-nav-link${active === "evaluate" ? " on" : ""}`}
          href="/evaluate"
          role="tab"
          aria-selected={active === "evaluate"}
        >
          Evaluate
        </Link>
        <Link
          className={`mm-nav-link${active === "import" ? " on" : ""}`}
          href="/import"
          role="tab"
          aria-selected={active === "import"}
        >
          Import
        </Link>
        <Link
          className={`mm-nav-link${active === "about" ? " on" : ""}`}
          href="/about"
          role="tab"
          aria-selected={active === "about"}
        >
          About
        </Link>
      </div>

      <Link className="mm-nav-cta" href="/" aria-label="New listing analysis">
        <span className="mm-nav-cta-ico" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
        </span>
        <span>New Listing Analysis</span>
      </Link>
    </nav>
  );
}
