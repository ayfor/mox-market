"use client";

// Where the result renders (AC-8; S2.1d10). While a navigation or retry from
// the shared transition is pending, the slot shows the skeleton instead of its
// children, so the previous panel unmounts the moment the user submits.
import { useResultNavigation } from "@/components/result-navigation";
import type { ReactNode } from "react";
import { PanelSkeleton } from "./panel-skeleton";

export function ResultSlot({ children }: { children: ReactNode }) {
  const { isPending } = useResultNavigation();
  return (
    <div className="mm-result-slot">
      {isPending ? <PanelSkeleton /> : children}
    </div>
  );
}
