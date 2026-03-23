import {
  Breadcrumb,
  BreadcrumbHome,
  Breadcrumbs,
  BreadcrumbSeparator,
} from "@/components/breadcrumbs";
import { SidebarLayoutContent } from "@/components/sidebar-layout";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Dashboard",
  description: "Monitor your MTG card prices in real time.",
};

export default function DashboardPage() {
  return (
    <SidebarLayoutContent
      breadcrumbs={
        <Breadcrumbs>
          <BreadcrumbHome />
          <BreadcrumbSeparator />
          <Breadcrumb>Dashboard</Breadcrumb>
        </Breadcrumbs>
      }
    >
      <div className="mx-auto max-w-7xl">
        <div className="py-10 sm:py-14">
          <h1 className="text-3xl/10 font-normal tracking-tight text-gray-950 dark:text-white">
            Price Dashboard
          </h1>
          <p className="mt-4 max-w-xl text-base/7 text-gray-600 dark:text-gray-400">
            Add cards to your watchlist to track price movements. Search in the
            sidebar or import a decklist.
          </p>

          {/* Aggregate stats bar - placeholder */}
          <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: "Total Value", value: "$0.00" },
              { label: "Cards Tracked", value: "0" },
              { label: "Biggest Gainer", value: "--" },
              { label: "Biggest Loser", value: "--" },
            ].map((stat) => (
              <div
                key={stat.label}
                className="rounded-lg border border-gray-950/10 p-4 dark:border-white/10"
              >
                <p className="text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  {stat.label}
                </p>
                <p className="mt-1 text-2xl font-semibold tabular-nums text-gray-950 dark:text-white">
                  {stat.value}
                </p>
              </div>
            ))}
          </div>

          {/* Card table - empty state */}
          <div className="mt-10 rounded-lg border border-dashed border-gray-950/10 p-12 text-center dark:border-white/10">
            <div className="mx-auto max-w-sm">
              <svg
                className="mx-auto size-12 text-gray-400 dark:text-gray-500"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z"
                />
              </svg>
              <h3 className="mt-4 text-sm font-semibold text-gray-950 dark:text-white">
                No cards in your watchlist
              </h3>
              <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                Search for cards in the sidebar, or import a decklist to get
                started.
              </p>
            </div>
          </div>
        </div>
      </div>
    </SidebarLayoutContent>
  );
}
