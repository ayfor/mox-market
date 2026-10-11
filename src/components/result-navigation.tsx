"use client";

// One shared transition for the result page (S2.1d10, AC-8). The entry form,
// the retry button and the selectors (S2.3) navigate inside it, and
// ResultSlot swaps the previous panel for the skeleton while it is pending,
// so a stale result never sits beside a pending compute.
//
// A selector switch remounts the keyed Suspense, so the control just used
// unmounts. The switch records which control changed (S2.3d7, AC-12); the
// selectors take that request when they next mount and focus the control.
// Any other navigation or a refresh clears it, so a later mount takes no
// focus.
import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useTransition,
  type ReactNode,
} from "react";

/** The control a selector switch returns focus to. */
export type FocusTarget = "printing" | "finish";

export interface NavigateOptions {
  /** Return focus to this control when the selectors next mount. */
  readonly focus?: FocusTarget;
}

export interface ResultNavigation {
  /** A navigation or refresh started here has not finished. */
  readonly isPending: boolean;
  /** router.push(href) inside the transition; records or clears the focus request. */
  navigate(href: string, options?: NavigateOptions): void;
  /** router.refresh() inside the transition; clears the focus request. */
  refresh(): void;
  /** The pending focus request, cleared as it is returned; null when none. */
  takeFocus(): FocusTarget | null;
}

const ResultNavigationContext = createContext<ResultNavigation | null>(null);

function useOwnNavigation(): ResultNavigation {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const focusRequest = useRef<FocusTarget | null>(null);
  const takeFocus = useCallback(() => {
    const target = focusRequest.current;
    focusRequest.current = null;
    return target;
  }, []);
  return useMemo(
    () => ({
      isPending,
      // The router's promise (when it returns one) keeps the transition
      // pending until the navigation settles.
      navigate: (href: string, options?: NavigateOptions) => {
        focusRequest.current = options?.focus ?? null;
        startTransition(() => router.push(href));
      },
      refresh: () => {
        focusRequest.current = null;
        startTransition(() => router.refresh());
      },
      takeFocus,
    }),
    [isPending, router, takeFocus],
  );
}

/** Shares one transition between the form, the retry button, the selectors and ResultSlot. */
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
