// The landing page (S2.4d4, S2.4d5): a server component, so it keeps its
// metadata; the form is the client LandingForm, which navigates to the
// result route (C1.06 = A). Every visible string comes from LANDING_COPY
// (C1.54). No title of its own: the root layout's title.default is the
// landing title, with one home.
import { LANDING_COPY } from "@/lib/copy/entry-points";
import type { Metadata } from "next";
import { Fragment } from "react";
import { LandingForm } from "./landing-form";
import "./landing.css";

export const metadata: Metadata = {
  description: LANDING_COPY.description,
};

/** The ruby band's designed line breaks, as words per line: "Should / you buy / it?". */
const QUESTION_LINE_WORDS: readonly number[] = [1, 2, 1];

/**
 * `text` split into lines of `counts` words each; words past the counts join
 * the last line, and a line with no words is dropped, so a reworded question
 * still renders whole.
 */
function wordLines(text: string, counts: readonly number[]): string[] {
  const words = text.split(" ").filter((word) => word !== "");
  const lines: string[] = [];
  let at = 0;
  for (const count of counts) {
    lines.push(words.slice(at, at + count).join(" "));
    at += count;
  }
  if (at < words.length && lines.length > 0) {
    lines[lines.length - 1] = [lines[lines.length - 1], ...words.slice(at)]
      .filter((part) => part !== "")
      .join(" ");
  }
  return lines.filter((line) => line !== "");
}

/** A designed multi-line heading: its lines with a <br /> between each. */
function Lines({ lines }: { lines: readonly string[] }) {
  return lines.map((line, index) => (
    <Fragment key={line}>
      {index > 0 && <br />}
      {line}
    </Fragment>
  ));
}

export default function LandingPage() {
  return (
    <main className="landing-page">
      <div className="landing-grid">
        {/* ───── Left panel — wordmark ───── */}
        <section
          className="landing-panel landing-panel-left"
          aria-labelledby="landing-brand"
        >
          <span className="landing-deco-plus-left" aria-hidden="true">
            +
          </span>
          <span className="landing-deco-diamond-text" aria-hidden="true">
            ◇
          </span>
          <span className="landing-deco-diamond" aria-hidden="true" />

          <span className="landing-divider-top" aria-hidden="true" />

          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className="landing-hex-gem"
            src="/assets/logo-mark.png"
            alt=""
            aria-hidden="true"
          />

          <h1 className="landing-wordmark mox" id="landing-brand">
            {LANDING_COPY.wordmarkTop}
          </h1>
          <p className="landing-wordmark market" aria-hidden="true">
            {LANDING_COPY.wordmarkBottom}
          </p>

          <div className="landing-dots-vert" aria-hidden="true">
            <span className="dot" />
            <span className="dot" />
            <span className="dot" />
          </div>

          <p className="landing-tagline">{LANDING_COPY.tagline}</p>

          <div className="landing-dots-horiz" aria-hidden="true">
            <span className="dot" />
            <span className="dot" />
            <span className="dot" />
            <span className="dot" />
          </div>
        </section>

        {/* ───── Right panel — Ruby band + form ───── */}
        <section
          className="landing-panel landing-panel-right"
          aria-labelledby="landing-prompt-heading"
        >
          {/* Decorative iso hex gem — sits behind the prompt text */}
          <div className="landing-iso-gem-wrap" aria-hidden="true">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              className="landing-iso-gem"
              src="/assets/iso-hex-gem.png"
              alt=""
            />
          </div>

          <div className="landing-ruby-band">
            <span className="landing-ruby-band-line" aria-hidden="true" />
            <h2 className="landing-ruby-question">
              <Lines
                lines={wordLines(LANDING_COPY.question, QUESTION_LINE_WORDS)}
              />
            </h2>
            <span className="landing-ruby-band-dot" aria-hidden="true" />
          </div>

          <div className="landing-dark-section">
            <span className="landing-dark-deco-plus" aria-hidden="true">
              +
            </span>

            <p className="landing-prompt" id="landing-prompt-heading">
              <Lines lines={LANDING_COPY.prompt} />
            </p>

            <LandingForm />
          </div>
        </section>
      </div>
    </main>
  );
}
