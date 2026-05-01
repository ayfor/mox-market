import type { Metadata } from "next";

import { EvaluatePageClient } from "./evaluate-client";
import "./evaluate.css";

export const metadata: Metadata = {
  title: "Evaluate",
  description:
    "Enter a card and a price. We'll tell you whether it's a deal.",
};

export default function EvaluatePage() {
  return <EvaluatePageClient />;
}
