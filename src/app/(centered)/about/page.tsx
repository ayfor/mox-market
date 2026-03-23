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

const techStack = [
  { name: "Next.js 16", description: "React framework with App Router" },
  { name: "TypeScript", description: "End-to-end type safety" },
  { name: "Tailwind CSS 4", description: "Utility-first styling with custom Mox jewel palette" },
  { name: "Zustand", description: "Lightweight state management with localStorage persistence" },
  { name: "Recharts", description: "Price sparklines and charts" },
  { name: "Scryfall API", description: "Card data, images, and pricing" },
  { name: "Headless UI", description: "Accessible component primitives" },
];

const features = [
  {
    title: "Card Search",
    description: "Fuzzy search powered by Scryfall autocomplete. Find any card instantly.",
  },
  {
    title: "Watchlist",
    description: "Session-based card tracking with localStorage persistence. No account required.",
  },
  {
    title: "Price Dashboard",
    description: "Live prices with aggregate stats, sorting, and sparkline history.",
  },
  {
    title: "Multi-Currency",
    description: "View prices in USD, CAD, EUR, or MTGO tickets.",
  },
  {
    title: "Decklist Import",
    description: "Paste MTGO, Arena, or plain text formats. Batch resolve via Scryfall.",
  },
  {
    title: "Export / Import",
    description: "Save your watchlist as JSON. Share it or restore it later.",
  },
];

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

      {/* Features */}
      <div className="mt-16">
        <h2 className="text-xl font-medium tracking-tight text-gray-950 dark:text-white">
          Features
        </h2>
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => (
            <div
              key={feature.title}
              className="rounded-lg border border-gray-950/10 p-4 dark:border-white/10"
            >
              <h3 className="text-sm font-semibold text-gray-950 dark:text-white">
                {feature.title}
              </h3>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Tech Stack */}
      <div className="mt-16">
        <h2 className="text-xl font-medium tracking-tight text-gray-950 dark:text-white">
          Tech Stack
        </h2>
        <div className="mt-6 rounded-lg border border-gray-950/10 dark:border-white/10">
          {techStack.map((tech, i) => (
            <div
              key={tech.name}
              className="flex items-baseline justify-between border-b border-gray-950/5 px-4 py-3 last:border-0 dark:border-white/5"
            >
              <span className="text-sm font-semibold text-gray-950 dark:text-white">
                {tech.name}
              </span>
              <span className="text-sm text-gray-500 dark:text-gray-400">
                {tech.description}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Source */}
      <div className="mt-16 pb-16">
        <h2 className="text-xl font-medium tracking-tight text-gray-950 dark:text-white">
          Source
        </h2>
        <p className="mt-4 text-sm text-gray-600 dark:text-gray-400">
          Mox Market is open source.{" "}
          <a
            href="https://github.com/ayfor/mox-market"
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-gray-950 underline decoration-gray-950/25 underline-offset-2 hover:decoration-gray-950/50 dark:text-white dark:decoration-white/25 dark:hover:decoration-white/50"
          >
            View on GitHub
          </a>
        </p>
      </div>
    </CenteredPageLayout>
  );
}
