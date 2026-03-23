"use client";

import { CardSearch, WatchlistCardRow } from "@/components/card-search";
import { IconButton } from "@/components/icon-button";
import { Logo } from "@/components/logo";
import { useWatchlistStore } from "@/store/watchlist";
import { SidebarIcon } from "@/icons/sidebar-icon";
import {
  CloseButton,
  Dialog,
  DialogBackdrop,
  DialogPanel,
} from "@headlessui/react";
import { clsx } from "clsx";
import type React from "react";
import { createContext, useContext, useState } from "react";
import { Navbar } from "./navbar";

export const SidebarContext = createContext<{
  isSidebarOpen: boolean;
  setIsSidebarOpen: (isSidebarOpen: boolean) => void;
  isMobileDialogOpen: boolean;
  setIsMobileDialogOpen: (isMobileDialogOpen: boolean) => void;
}>({
  isSidebarOpen: true,
  setIsSidebarOpen: () => {},
  isMobileDialogOpen: false,
  setIsMobileDialogOpen: () => {},
});

function WatchlistSidebar({ className }: { className?: string }) {
  const cards = useWatchlistStore((s) => s.cards);
  const removeCard = useWatchlistStore((s) => s.removeCard);
  const clearAll = useWatchlistStore((s) => s.clearAll);

  return (
    <div className={clsx(className)}>
      <Logo className="mb-4" />
      <CardSearch />
      <div className="mt-4 space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
            Watchlist ({cards.length})
          </h2>
          {cards.length > 0 && (
            <button
              type="button"
              onClick={clearAll}
              className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            >
              Clear all
            </button>
          )}
        </div>
        {cards.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-950/10 p-4 text-center dark:border-white/10">
            <p className="text-xs text-gray-400 dark:text-gray-500">
              Search above to add cards
            </p>
          </div>
        ) : (
          <div className="space-y-0.5">
            {cards.map((card) => (
              <WatchlistCardRow
                key={card.id}
                card={card}
                onRemove={removeCard}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function MobileWatchlist({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} className="xl:hidden">
      <DialogBackdrop className="fixed inset-0 bg-gray-950/25" />
      <DialogPanel className="fixed inset-y-0 left-0 isolate w-sm max-w-[calc(100%-(--spacing(11)))] overflow-y-auto bg-white ring ring-gray-950/10 sm:w-xs dark:bg-gray-950 dark:ring-white/10">
        <div className="sticky top-0 z-10 px-4 py-4 sm:px-6">
          <div className="flex h-6 shrink-0">
            <CloseButton as={IconButton}>
              <SidebarIcon className="shrink-0 stroke-gray-950 dark:stroke-white" />
            </CloseButton>
          </div>
        </div>
        <WatchlistSidebar className="px-4 pb-4 sm:px-6" />
      </DialogPanel>
    </Dialog>
  );
}

export function SidebarLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let [isSidebarOpen, setIsSidebarOpen] = useState(true);
  let [isMobileDialogOpen, setIsMobileDialogOpen] = useState(false);

  return (
    <SidebarContext.Provider
      value={{
        isSidebarOpen,
        setIsSidebarOpen,
        isMobileDialogOpen,
        setIsMobileDialogOpen,
      }}
    >
      <div
        data-sidebar-collapsed={isSidebarOpen ? undefined : ""}
        className="group"
      >
        <aside className="fixed inset-y-0 left-0 w-2xs overflow-y-auto border-r border-gray-950/10 group-data-sidebar-collapsed:hidden max-xl:hidden dark:border-white/10">
          <nav className="px-6 py-4">
            <div className="sticky top-4 flex h-6">
              <IconButton onClick={() => setIsSidebarOpen(!isSidebarOpen)}>
                <SidebarIcon className="shrink-0 stroke-gray-950 dark:stroke-white" />
              </IconButton>
              <MobileWatchlist
                open={isMobileDialogOpen}
                onClose={() => setIsMobileDialogOpen(false)}
              />
            </div>
            <div className="mt-3">
              <WatchlistSidebar className="max-xl:hidden" />
            </div>
          </nav>
        </aside>
        <div className="xl:not-group-data-sidebar-collapsed:ml-(--container-2xs)">
          {children}
        </div>
      </div>
    </SidebarContext.Provider>
  );
}

export function SidebarLayoutContent({
  breadcrumbs,
  children,
}: {
  breadcrumbs: React.ReactNode;
  children: React.ReactNode;
}) {
  let {
    isSidebarOpen,
    setIsSidebarOpen,
    isMobileDialogOpen,
    setIsMobileDialogOpen,
  } = useContext(SidebarContext);

  return (
    <>
      <Navbar>
        <div className="flex min-w-0 shrink items-center gap-x-4">
          <IconButton
            onClick={() => setIsMobileDialogOpen(!isMobileDialogOpen)}
            className="xl:hidden"
          >
            <SidebarIcon className="shrink-0 stroke-gray-950 dark:stroke-white" />
          </IconButton>
          {!isSidebarOpen && (
            <IconButton
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className="max-xl:hidden"
            >
              <SidebarIcon className="shrink-0 stroke-gray-950 dark:stroke-white" />
            </IconButton>
          )}
          <div className="min-w-0">{breadcrumbs}</div>
        </div>
      </Navbar>
      <main className="px-4 sm:px-6">{children}</main>
    </>
  );
}
