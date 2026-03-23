import {
  Breadcrumb,
  BreadcrumbHome,
  Breadcrumbs,
  BreadcrumbSeparator,
} from "@/components/breadcrumbs";
import { CenteredPageLayout } from "@/components/centered-layout";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Import Cards",
  description:
    "Import cards from a decklist, MTGO format, or pasted text to add to your watchlist.",
};

export default function ImportPage() {
  return (
    <CenteredPageLayout
      breadcrumbs={
        <Breadcrumbs>
          <BreadcrumbHome />
          <BreadcrumbSeparator />
          <Breadcrumb>Import</Breadcrumb>
        </Breadcrumbs>
      }
    >
      <h1 className="mt-10 text-3xl/10 font-normal tracking-tight text-gray-950 sm:mt-14 dark:text-white">
        Import Cards
      </h1>
      <p className="mt-6 max-w-xl text-base/7 text-gray-600 dark:text-gray-400">
        Paste a decklist, MTGO export, Arena format, or plain card names to add
        them to your watchlist.
      </p>

      <div className="mt-10 max-w-2xl">
        <textarea
          placeholder={`Paste your card list here...\n\nSupported formats:\n- One card per line: Lightning Bolt\n- MTGO format: 4 Lightning Bolt\n- Arena format: 4 Lightning Bolt (M21) 199`}
          rows={12}
          className="block w-full rounded-lg bg-white px-4 py-3 text-sm/6 text-gray-950 outline -outline-offset-1 outline-gray-950/15 placeholder:text-gray-400 focus:outline-2 focus:-outline-offset-2 focus:outline-mox-sapphire dark:bg-white/10 dark:text-white dark:outline-white/15 dark:placeholder:text-gray-500 dark:focus:outline-mox-sapphire-light"
        />
        <div className="mt-4 flex items-center gap-3">
          <button className="inline-flex items-center rounded-full bg-gray-950 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800 dark:bg-gray-700 dark:hover:bg-gray-600">
            Parse & Add Cards
          </button>
          <span className="text-xs text-gray-500 dark:text-gray-400">
            Cards will be added to your watchlist
          </span>
        </div>
      </div>
    </CenteredPageLayout>
  );
}
