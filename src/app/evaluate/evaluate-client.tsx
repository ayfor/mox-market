"use client";

import { EntryForm } from "@/components/entry-form";
import { NavBar } from "@/components/nav-bar";

/* ────────────────────────────────────────────────────────────
   Mox Market V2 — /evaluate
   Utility entry point for returning users.

   Ported from the Claude Design handoff (2026-05-01). The form is the
   shared EntryForm: it validates the price and pushes the result route
   /[card]?price=, where the recommendation is computed on the server.
   S2.1 deleted the client-side mock market and the Recent Evaluations
   list (C1.33, C1.44 = A); that list returns with F6/F7.
   ──────────────────────────────────────────────────────────── */

/* ─── Hero — page header ─── */

function Hero() {
  return (
    <section className="mm-hero">
      <div className="mm-hero-text">
        <div className="mm-hero-eyebrow">Evaluate</div>
        <h1 className="mm-hero-headline">Evaluate a card.</h1>
        <p className="mm-hero-subhead">
          Enter a card and a price. We&rsquo;ll tell you whether it&rsquo;s a
          deal.
        </p>
      </div>
      <svg className="mm-hero-hex" viewBox="0 0 96 96" aria-hidden="true">
        <polygon
          points="48,4 88,26 88,70 48,92 8,70 8,26"
          fill="none"
          stroke="rgba(254,255,254,0.5)"
          strokeWidth="1"
        />
        <polygon
          points="48,18 76,33 76,63 48,78 20,63 20,33"
          fill="none"
          stroke="rgba(158,0,49,0.55)"
          strokeWidth="1"
        />
        <polygon
          points="48,32 64,40 64,56 48,64 32,56 32,40"
          fill="none"
          stroke="rgba(254,255,254,0.3)"
          strokeWidth="1"
        />
      </svg>
    </section>
  );
}

/* ─── Page ─── */

export function EvaluatePageClient() {
  return (
    <div className="mm-app">
      <NavBar active="evaluate" />
      <div className="mm-stage">
        <Hero />
        <EntryForm autoFocus />
      </div>
    </div>
  );
}
