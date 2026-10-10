"use client";

// The error panel's retry (AC-4): refreshes the result route inside the shared
// transition, so the slot shows the skeleton until the new render arrives.
import { useResultNavigation } from "@/components/result-navigation";
import { FORM_LABELS } from "@/lib/copy/result-labels";

export function RetryButton() {
  const { isPending, refresh } = useResultNavigation();
  return (
    <button
      type="button"
      className="mm-retry-btn"
      disabled={isPending}
      onClick={() => refresh()}
    >
      {FORM_LABELS.retry}
    </button>
  );
}
