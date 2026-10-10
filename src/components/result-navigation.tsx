"use client";

// One shared transition for the result page (S2.1d10, AC-8). The entry form
// and the retry button navigate inside it, and ResultSlot swaps the previous
// panel for the skeleton while it is pending, so a stale result never sits
// beside a pending compute.
import { useRouter } from "next/navigation";
import {
  createContext,
  useContext,
  useMemo,
  useTransition,
  type ReactNode,
} from "react";

export interface ResultNavigation {
  /** A navigation or refresh started here has not finished. */
  readonly isPending: boolean;
  /** router.push(href) inside the transition. */
  navigate(href: string): void;
  /** router.refresh() inside the transition. */
  refresh(): void;
}

const ResultNavigationContext = createContext<ResultNavigation | null>(null);

function useOwnNavigation(): ResultNavigation {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  return useMemo(
    () => ({
      isPending,
      // The router's promise (when it returns one) keeps the transition
      // pending until the navigation settles.
      navigate: (href: string) => startTransition(() => router.push(href)),
      refresh: () => startTransition(() => router.refresh()),
    }),
    [isPending, router],
  );
}

/** Shares one transition between the form, the retry button and ResultSlot. */
export function ResultNavigationProvider({
  children,
}: {
  children: ReactNode;
}) {
  const navigation = useOwnNavigation();
  return (
    <ResultNavigationContext.Provider value={navigation}>
      {children}
    </ResultNavigationContext.Provider>
  );
}

/** The shared transition inside a provider; outside one (on /evaluate), a transition of the caller's own. */
export function useResultNavigation(): ResultNavigation {
  const shared = useContext(ResultNavigationContext);
  const own = useOwnNavigation();
  return shared ?? own;
}
