// The pending state (F2 §UI loading state, AC-8; S2.1d10): a badge
// placeholder, four tile placeholders and the two selector slots, laid out
// like the result so the swap causes no layout shift. Each slot fills its
// track of the fixed-height .mm-selector-row, as PrintingSelect and
// FinishSelect do (S2.3d7, AC-12). With `staleBanner` it keeps the stale
// banner the last panel showed, the same element and text, so its height
// matches at every width (S2.3 ADV-1); the copy is aria-hidden, since the
// panel already announced it. No hooks: ResultSlot and SlotSkeleton (client)
// decide `staleBanner`.
import { LOADING_LABEL } from "@/lib/copy/result-labels";
import { UI_COPY } from "@/lib/recommendation/ui-copy";

const TILE_SLOTS = ["delta", "trend", "range", "volatility"] as const;

export function PanelSkeleton({
  staleBanner = false,
}: {
  /** Reserve the stale banner above the grid, as the ok panel shows it. */
  readonly staleBanner?: boolean;
}) {
  return (
    <div
      className="mm-result mm-skeleton"
      role="status"
      aria-busy="true"
      aria-label={LOADING_LABEL}
    >
      {staleBanner && (
        <p
          className="mm-stale-banner"
          aria-hidden="true"
          data-skeleton-part="banner"
        >
          {UI_COPY.staleBanner}
        </p>
      )}
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
