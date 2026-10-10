// The result route /[card]?price=&finish= (C1.06 = A; S2.1d5, S2.1d9): an
// async server component. It validates the params before any Scryfall call
// (no price is the prefilled form and no call, S2.4 AC-16), then streams the
// server-computed panel, a lookup miss or the error panel into a Suspense
// boundary keyed by the query, under the prefilled entry form. The form and
// the slot share one field, so a miss message describes the card field
// (S2.4d9). Renders write nothing (C1.28).
import { EntryForm } from "@/components/entry-form";
import { NavBar } from "@/components/nav-bar";
import { ResultNavigationProvider } from "@/components/result-navigation";
import {
  normalisePrice,
  parseResultParams,
  type ResultParams,
  type ResultSearchParams,
} from "@/lib/evaluation/result-params";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ResultField } from "./lookup-miss";
import { PanelSkeleton } from "./panel-skeleton";
import { ResultPanel } from "./result-panel";
import { ResultSlot } from "./result-slot";
import "./result.css";

export const metadata: Metadata = {
  title: "Evaluation",
  robots: { index: false, follow: false },
};

interface ResultPageProps {
  params: Promise<{ card: string }>;
  searchParams: Promise<ResultSearchParams>;
}

/**
 * The price the form shows: a valid one normalised ("$5" as "5", S2.4d9); a
 * blank one empty (AC-16); an invalid one as typed, so the error points at
 * what was typed.
 */
function shownPrice(parsed: Exclude<ResultParams, { kind: "not_found" }>) {
  if (parsed.kind === "ok") return normalisePrice(parsed.price);
  return parsed.price.trim() === "" ? "" : parsed.price;
}

export default async function ResultPage({
  params,
  searchParams,
}: ResultPageProps) {
  const [{ card }, search] = await Promise.all([params, searchParams]);
  const parsed = parseResultParams(card, search);
  if (parsed.kind === "not_found") notFound();

  return (
    <div className="mm-app">
      <NavBar active="evaluate" />
      <main className="mm-stage mm-result-page">
        <ResultNavigationProvider>
          <ResultField>
            {/* Not keyed: the form takes new URL values into unedited fields (ADV-8). */}
            <EntryForm
              initialCard={parsed.card}
              initialPrice={shownPrice(parsed)}
              initialError={parsed.kind === "form" && parsed.error}
            />
            {parsed.kind === "ok" && (
              <ResultSlot>
                <Suspense key={parsed.paramsKey} fallback={<PanelSkeleton />}>
                  <ResultPanel
                    query={{
                      card: parsed.card,
                      askingPriceCents: parsed.askingPriceCents,
                      finish: parsed.finish,
                    }}
                  />
                </Suspense>
              </ResultSlot>
            )}
          </ResultField>
        </ResultNavigationProvider>
      </main>
    </div>
  );
}
