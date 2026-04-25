import type { Metadata } from "next";
import { DecisionAnalysis } from "./decision-analysis";
import "./styles.css";

export const metadata: Metadata = {
  title: "Decision Analysis",
  description:
    "Should you buy this card at this price? Mox Market evaluates a single card listing against the 30-day market.",
};

export default function SamplePage() {
  return <DecisionAnalysis />;
}
