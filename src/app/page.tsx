import type { Metadata } from "next";
import "./landing.css";

export const metadata: Metadata = {
  title: { absolute: "Mox Market — Should you buy it?" },
  description:
    "Enter a card and a price. We'll tell you. Single-card price evaluation against the 30-day market.",
};

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
            Mox
          </h1>
          <p className="landing-wordmark market" aria-hidden="true">
            Market
          </p>

          <div className="landing-dots-vert" aria-hidden="true">
            <span className="dot" />
            <span className="dot" />
            <span className="dot" />
          </div>

          <p className="landing-tagline">Market moves at instant speed.</p>

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
              Should
              <br />
              you buy
              <br />
              it?
            </h2>
            <span className="landing-ruby-band-dot" aria-hidden="true" />
          </div>

          <div className="landing-dark-section">
            <span className="landing-dark-deco-plus" aria-hidden="true">
              +
            </span>

            <p className="landing-prompt" id="landing-prompt-heading">
              Enter a
              <br />
              Card and
              <br />
              a Price.
              <br />
              We&rsquo;ll Tell
              <br />
              You.
            </p>

            <form className="landing-form" action="/sample" method="get">
              <input
                className="landing-form-input"
                type="text"
                name="card"
                placeholder="Card name..."
                aria-label="Card name"
                autoComplete="off"
              />
              <input
                className="landing-form-input price"
                type="text"
                name="price"
                placeholder="$ Price"
                aria-label="Price"
                inputMode="decimal"
                autoComplete="off"
              />
              <button className="landing-form-submit" type="submit">
                Evaluate
              </button>
            </form>
          </div>
        </section>
      </div>
    </main>
  );
}
