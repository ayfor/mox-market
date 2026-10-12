import type { Metadata } from "next";

import { EVALUATE_COPY } from "@/lib/copy/entry-points";
import { EvaluatePageClient } from "./evaluate-client";
import "./evaluate.css";

export const metadata: Metadata = {
  title: EVALUATE_COPY.title,
  description: EVALUATE_COPY.description,
};

export default function EvaluatePage() {
  return <EvaluatePageClient />;
}
