"use client";

// One shared transition for the result page (S2.1d10, AC-8). The entry form,
// the retry button and the selectors (S2.3) navigate inside it, and
// ResultSlot swaps the previous panel for the skeleton while it is pending,
// so a stale result never sits beside a pending compute.
//
// A selector switch remounts the keyed Suspense, so the control just used
// unmounts. The switch records which control changed and the href it pushed
// (S2.3d7, AC-12). The next panel to mount takes the request: the selectors
// focus the control only when they show the selection that href names, and
// the error panel's Retry focuses itself (S2.3 ADV-2), so a switch never
// leaves focus on <body> and a stale request never moves focus on a later
// Back or Forward. Any other navigation or a refresh clears it.
import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";

/** The control a selector switch returns focus to. */
export type FocusTarget = "printing" | "finish";

/** A selector switch's pending focus request. */
export interface FocusRequest {
  /** The control that changed. */
  readonly target: FocusTarget;
  /** The href the switch pushed: the selectors focus only on that page. */
  readonly href: string;
}

export interface NavigateOptions {
  /** Return focus to this control when the selectors next mount. */
  readonly focus?: FocusTarget;
}

export interface ResultNavigation {
  /** A navigation or refresh started here has not finished. */
  readonly isPending: boolean;
  /**
   * How many selector switches (navigations with a focus target) started
   * here. The entry form resets its unsubmitted edits when it changes, since
   * a switch evaluates the URL's card and price (S2.3 ADV-6).
   */
  readonly switches: number;
  /**
   * router.push(href) inside the transition; records or clears the focus
   * request. With a focus target (a selector switch) the scroll position is
   * kept.
   */
  navigate(href: string, options?: NavigateOptions): void;
  /** router.refresh() inside the transition; clears the focus request. */
  refresh(): void;
  /** The pending focus request, cleared as it is returned; null when none. */
  takeFocus(): FocusRequest | null;
}

const ResultNavigationContext = createContext<ResultNavigation | null>(null);

function useOwnNavigation(): ResultNavigation {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [switches, setSwitches] = useState(0);
  const focusRequest = useRef<FocusRequest | null>(null);
  const takeFocus = useCallback(() => {
    const request = focusRequest.current;
    focusRequest.current = null;
    return request;
  }, []);
  return useMemo(
    () => ({
      isPending,
      switches,
      // The router's promise (when it returns one) keeps the transition
      // pending until the navigation settles.
      navigate: (href: string, options?: NavigateOptions) => {
        focusRequest.current =
          options?.focus === undefined ? null : { target: options.focus, href };
        if (options?.focus !== undefined) setSwitches((n) => n + 1);
        // A selector switch re-evaluates the card in place, so it keeps the
        // scroll position instead of jumping to the top (S2.3 Deviation 3).
        startTransition(() =>
          options?.focus === undefined
            ? router.push(href)
            : router.push(href, { scroll: false }),
        );
      },
      refresh: () => {
        focusRequest.current = null;
        startTransition(() => router.refresh());
      },
      takeFocus,
    }),
    [isPending, switches, router, takeFocus],
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
