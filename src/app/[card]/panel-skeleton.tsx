// The pending state (F2 §UI loading state, AC-8; S2.1d10): a badge
// placeholder, four tile placeholders and the two selector slots S2.3 fills,
// laid out like the result so the swap causes no layout shift. No hooks, so
// the server page uses it as the Suspense fallback and ResultSlot (client)
// shows it while a navigation is pending.
import { LOADING_LABEL } from "@/lib/copy/result-labels";

const TILE_SLOTS = ["delta", "trend", "range", "volatility"] as const;

export function PanelSkeleton() {
  return (
    <div
      className="mm-result mm-skeleton"
      role="status"
      aria-busy="true"
      aria-label={LOADING_LABEL}
    >
      <div className="mm-result-grid">
        <div
          className="mm-card-art mm-skeleton-block"
          data-skeleton-part="image"
        />
        <div className="mm-result-main">
          <div className="mm-card-heading">
            <span
              className="mm-skeleton-block mm-skeleton-title"
              data-skeleton-part="title"
            />
            <span
              className="mm-skeleton-block mm-skeleton-line"
              data-skeleton-part="set"
            />
          </div>
          <div className="mm-selector-row">
            <span
              className="mm-skeleton-block mm-skeleton-selector"
              data-skeleton-part="selector"
            />
            <span
              className="mm-skeleton-block mm-skeleton-selector"
              data-skeleton-part="selector"
            />
          </div>
          <div className="mm-rec-panel">
            <div className="mm-rec-head">
              <span
                className="mm-skeleton-block mm-skeleton-badge"
                data-skeleton-part="badge"
              />
            </div>
            <span
              className="mm-skeleton-block mm-skeleton-line"
              data-skeleton-part="reason"
            />
            <span
              className="mm-skeleton-block mm-skeleton-line mm-skeleton-line--short"
              data-skeleton-part="disclaimer"
            />
            <div className="mm-rec-tiles">
              {TILE_SLOTS.map((slot) => (
                <div
                  key={slot}
                  className="mm-rec-tile mm-skeleton-tile"
                  data-skeleton-part="tile"
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
