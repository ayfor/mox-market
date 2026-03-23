import {
  Breadcrumb,
  BreadcrumbHome,
  Breadcrumbs,
  BreadcrumbSeparator,
} from "@/components/breadcrumbs";
import { CenteredPageLayout } from "@/components/centered-layout";
import { ImportForm } from "@/components/import-form";
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
      <ImportForm />
    </CenteredPageLayout>
  );
}
