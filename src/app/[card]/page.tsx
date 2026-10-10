// The result route /[card]?price=&finish= (C1.06 = A; S2.1d5, S2.1d9): an
// async server component. It validates the params before any Scryfall call,
// then streams the server-computed panel into a Suspense boundary keyed by
// the query, under the prefilled entry form. Renders write nothing (C1.28).
import { EntryForm } from "@/components/entry-form";
import { NavBar } from "@/components/nav-bar";
import { ResultNavigationProvider } from "@/components/result-navigation";
import {
  parseResultParams,
  type ResultSearchParams,
} from "@/lib/evaluation/result-params";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
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

export default async function ResultPage({
  params,
  searchParams,
}: ResultPageProps) {
  const [{ card }, search] = await Promise.all([params, searchParams]);
  const parsed = parseResultParams(card, search);
  if (parsed.kind === "not_found") notFound();

  const formKey = `${parsed.card}|${parsed.price}|${parsed.kind}`;
  return (
    <div className="mm-app">
      <NavBar active="evaluate" />
      <main className="mm-stage mm-result-page">
        <ResultNavigationProvider>
          <EntryForm
            key={formKey}
            initialCard={parsed.card}
            initialPrice={parsed.price}
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
        </ResultNavigationProvider>
      </main>
    </div>
  );
}
