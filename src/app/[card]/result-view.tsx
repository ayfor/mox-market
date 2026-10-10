// The recommendation panel by props (S2.1d9; F2 §UI): a pure server
// component, so every state is testable without Scryfall or the reader.
// Every string comes from a copy module (C1.54).
import { RECOMMENDATION_DISCLAIMER, SOURCE_LABEL } from "@/lib/copy/legal";
import { CONFIDENCE_LABELS, KIND_LABELS } from "@/lib/copy/result-labels";
import type {
  EvaluatedPrinting,
  Evaluation,
} from "@/lib/evaluation/build-evaluation";
import { STALENESS_FLAG_HOURS } from "@/lib/evaluation/consts";
import { isHistoryStale, relativeTime } from "@/lib/evaluation/staleness";
import { signalTiles } from "@/lib/evaluation/tiles";
import { FALLBACK_NOTICE, fillTemplate } from "@/lib/recommendation/copy";
import { FINISH_LABELS, UI_COPY } from "@/lib/recommendation/ui-copy";
import { getCardImageUri } from "@/lib/scryfall";
import { RetryButton } from "./retry-button";

/** Scryfall's normal image size, 488 × 680: the card's aspect. */
const CARD_IMAGE_WIDTH = 488;
const CARD_IMAGE_HEIGHT = 680;

type OkEvaluation = Extract<Evaluation, { status: "ok" }>;

/** "Modern Horizons 2 (MH2) · #12", one string everywhere (S2.1d13). */
export function printingLine(printing: EvaluatedPrinting): string {
  return fillTemplate(UI_COPY.printingOption, {
    set_name: printing.set_name,
    SET: printing.set.toUpperCase(),
    collector_number: printing.collector_number,
  });
}

/** The D2 card header's image, beside the glass panel, never under it (R3, R4). */
function CardArt({ printing }: { printing: EvaluatedPrinting }) {
  const src = getCardImageUri(printing, "normal");
  if (src === null) return null;
  return (
    <div className="mm-card-art">
      {/* R4: the full card, uncropped and unfiltered, as Scryfall serves it. */}
      {/* eslint-disable-next-line @next/next/no-img-element -- R4 needs the original image untouched; next/image would re-encode it */}
      <img
        className="mm-card-image"
        src={src}
        alt={printing.name}
        width={CARD_IMAGE_WIDTH}
        height={CARD_IMAGE_HEIGHT}
      />
    </div>
  );
}

/** Source label, then the history line or the no-history line (AC-7, ADV-7). */
function DataFooter({ evaluation }: { evaluation: OkEvaluation }) {
  const { latestSnapshotAt, now, recommendation, historyUnavailable } =
    evaluation;
  let historyLine: string | null;
  let staleFlag: string | null = null;
  if (historyUnavailable) {
    // The reason line already says the history is unavailable.
    historyLine = null;
  } else if (latestSnapshotAt === null) {
    // "No history" only when nothing was computed from rows either (ADV-7).
    historyLine =
      recommendation.signals.snapshotCount30d === 0 ? UI_COPY.noHistory : null;
  } else {
    historyLine = fillTemplate(UI_COPY.historyLine, {
      N: recommendation.signals.snapshotCount30d,
      relativeTime: relativeTime(latestSnapshotAt, now),
    });
    if (isHistoryStale(latestSnapshotAt, now)) {
      staleFlag = fillTemplate(UI_COPY.staleFlag, {
        hours: STALENESS_FLAG_HOURS,
      });
    }
  }
  return (
    <div className="mm-data-footer">
      <p className="mm-data-source">{SOURCE_LABEL}</p>
      {historyLine !== null && (
        <p className="mm-data-history">
          {historyLine}
          {staleFlag !== null && (
            <>
              {" "}
              <span className="mm-data-stale">{staleFlag}</span>
            </>
          )}
        </p>
      )}
    </div>
  );
}

function OkView({ evaluation }: { evaluation: OkEvaluation }) {
  const { printing, recommendation, requestedFinish, historyUnavailable } =
    evaluation;
  const { kind, confidence, reason, signals } = recommendation;
  const insufficient = kind === "insufficient_data";
  const reasonText =
    insufficient && historyUnavailable ? UI_COPY.historyUnavailable : reason;

  return (
    <div className="mm-result" data-status="ok">
      {evaluation.syncStale && (
        <p className="mm-stale-banner" role="status">
          {UI_COPY.staleBanner}
        </p>
      )}
      <div className="mm-result-grid">
        <CardArt printing={printing} />
        <div className="mm-result-main">
          <div className="mm-card-heading">
            <h1 className="mm-card-name">{printing.name}</h1>
            <p className="mm-card-set">{printingLine(printing)}</p>
          </div>
          {/* Reserved for S2.3's selectors, so the skeleton's slots cause no shift. */}
          <div className="mm-selector-row" />
          <section
            className="mm-rec-panel"
            data-kind={kind}
            aria-label={printing.name}
          >
            {!insufficient && (
              <div className="mm-rec-head">
                <span className={`mm-rec-badge mm-rec-badge--${kind}`}>
                  {KIND_LABELS[kind]}
                </span>
                <span className="mm-rec-chip">
                  {CONFIDENCE_LABELS[confidence]}
                </span>
              </div>
            )}
            <p className="mm-rec-reason">{reasonText}</p>
            <p className="mm-rec-disclaimer">{RECOMMENDATION_DISCLAIMER}</p>
            {signals.fallbackNotice && (
              <p className="mm-rec-notice" role="note">
                {fillTemplate(FALLBACK_NOTICE, {
                  finish: FINISH_LABELS[requestedFinish],
                })}
              </p>
            )}
            {!insufficient && (
              <ul className="mm-rec-tiles">
                {signalTiles(signals).map((tile) => (
                  <li key={tile.id} className="mm-rec-tile" data-tile={tile.id}>
                    <span className="mm-rec-tile-label">{tile.label}</span>
                    <span className="mm-rec-tile-value">{tile.value}</span>
                    {tile.caption !== null && (
                      <span className="mm-rec-tile-caption">
                        {tile.caption}
                      </span>
                    )}
                    {tile.thinData && (
                      <span className="mm-rec-tile-note">
                        {UI_COPY.thinDataNote}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <DataFooter evaluation={evaluation} />
          </section>
        </div>
      </div>
    </div>
  );
}

/** One evaluation's panel: the result, the error panel, or a message. */
export function ResultView({ evaluation }: { evaluation: Evaluation }) {
  switch (evaluation.status) {
    case "ok":
      return <OkView evaluation={evaluation} />;
    case "error":
      return (
        <div
          className="mm-result mm-result-message"
          data-status="error"
          role="alert"
        >
          <p className="mm-result-message-text">{UI_COPY.errorPanel}</p>
          <RetryButton />
        </div>
      );
    case "not_found":
      return (
        <div
          className="mm-result mm-result-message"
          data-status="not_found"
          role="status"
        >
          <p className="mm-result-message-text">{UI_COPY.cardNotFound}</p>
        </div>
      );
    case "invalid":
      return (
        <div
          className="mm-result mm-result-message"
          data-status="invalid"
          role="alert"
        >
          <p className="mm-result-message-text">{UI_COPY.validationError}</p>
        </div>
      );
  }
}
