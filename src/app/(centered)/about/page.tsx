import {
  Breadcrumb,
  BreadcrumbHome,
  Breadcrumbs,
  BreadcrumbSeparator,
} from "@/components/breadcrumbs";
import { CenteredPageLayout } from "@/components/centered-layout";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "About",
  description:
    "Mox Market is an MTG card price monitor built by Twin Spruce Studio.",
};

export default function AboutPage() {
  return (
    <CenteredPageLayout
      breadcrumbs={
        <Breadcrumbs>
          <BreadcrumbHome />
          <BreadcrumbSeparator />
          <Breadcrumb>About</Breadcrumb>
        </Breadcrumbs>
      }
    >
      <h1 className="mt-10 text-3xl/10 font-normal tracking-tight text-gray-950 sm:mt-14 dark:text-white">
        About Mox Market
      </h1>
      <div className="mt-6 max-w-xl space-y-4 text-base/7 text-gray-600 dark:text-gray-400">
        <p>
          Mox Market is a card price monitoring dashboard for Magic: The
          Gathering players and collectors. Track price movements, build
          watchlists, and import decklists to see how your cards are performing.
        </p>
        <p>
          Built by{" "}
          <span className="font-semibold text-gray-950 dark:text-white">
            Twin Spruce Studio
          </span>{" "}
          as part of an MTG tools ecosystem. Powered by the{" "}
          <a
            href="https://scryfall.com/docs/api"
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-gray-950 underline decoration-gray-950/25 underline-offset-2 hover:decoration-gray-950/50 dark:text-white dark:decoration-white/25 dark:hover:decoration-white/50"
          >
            Scryfall API
          </a>
          .
        </p>
      </div>
    </CenteredPageLayout>
  );
}
