"use client";

// Where the result renders (AC-8; S2.1d10). While a navigation or retry from
// the shared transition is pending, the slot shows the skeleton instead of its
// children, so the previous panel unmounts the moment the user submits.
//
// The stale banner (S2.1, C1.31) reports global sync freshness, so the panel
// a switch lands on shows it whenever the panel before did. The slot sits
// outside the keyed Suspense and remembers whether the last settled panel
// showed it; both skeletons (this slot's pending one and the Suspense
// fallback, SlotSkeleton) reserve it, so the selector row and the result
// grid do not move when the panel lands (S2.3 ADV-1, AC-12).
import { useResultNavigation } from "@/components/result-navigation";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { PanelSkeleton } from "./panel-skeleton";

interface SlotBanner {
  /** The last settled panel showed the stale banner. */
  readonly shown: boolean;
  readonly report: (shown: boolean) => void;
}

const SlotBannerContext = createContext<SlotBanner>({
  shown: false,
  report: () => {},
});

export function ResultSlot({ children }: { children: ReactNode }) {
  const { isPending } = useResultNavigation();
  const [bannerShown, setBannerShown] = useState(false);
  const banner = useMemo<SlotBanner>(
    () => ({ shown: bannerShown, report: setBannerShown }),
    [bannerShown],
  );
  return (
    <SlotBannerContext.Provider value={banner}>
      <div className="mm-result-slot">
        {isPending ? <PanelSkeleton staleBanner={bannerShown} /> : children}
      </div>
    </SlotBannerContext.Provider>
  );
}

/** The keyed Suspense's fallback: the skeleton, with the banner the last panel showed. */
export function SlotSkeleton() {
  const { shown } = useContext(SlotBannerContext);
  return <PanelSkeleton staleBanner={shown} />;
}

/** Rendered by every ok panel: tells the slot whether it shows the stale banner. Renders nothing. */
export function StaleBannerReport({ shown }: { shown: boolean }) {
  const { report } = useContext(SlotBannerContext);
  useEffect(() => {
    report(shown);
  }, [report, shown]);
  return null;
}
