"use client";

// The result route's error boundary (ADV-4). buildEvaluation never throws,
// but a render over malformed Scryfall data could, after the streamed 200 is
// sent; Next then renders this instead of its generic crash. It shows the
// same error panel and Retry as ResultView's error state (AC-4): Retry
// re-renders the route on the server and resets the boundary in one
// transition, so the panel stays until the new render is ready.
import { NavBar } from "@/components/nav-bar";
import { FORM_LABELS } from "@/lib/copy/result-labels";
import { UI_COPY } from "@/lib/recommendation/ui-copy";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import "./result.css";

export default function ResultError({ reset }: { reset: () => void }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const retry = () =>
    startTransition(() => {
      router.refresh();
      reset();
    });

  return (
    <div className="mm-app">
      <NavBar active="evaluate" />
      <main className="mm-stage mm-result-page">
        <div
          className="mm-result mm-result-message"
          data-status="error"
          role="alert"
        >
          <p className="mm-result-message-text">{UI_COPY.errorPanel}</p>
          <button
            type="button"
            className="mm-retry-btn"
            disabled={isPending}
            onClick={retry}
          >
            {FORM_LABELS.retry}
          </button>
        </div>
      </main>
    </div>
  );
}
