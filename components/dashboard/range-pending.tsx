"use client";

import { createContext, useContext, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import { KEY_SUMMARY_CARD_HEIGHT } from "@/components/dashboard/key-summary-card";

const RangeContext = createContext<{ pending: boolean; go: (href: string) => void }>({ pending: false, go: () => {} });

/** Holds the Dashboard Range change as a transition, so only the range-dependent cards need to show a skeleton while it reloads. */
export function RangeProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return <RangeContext value={{ pending, go: (href) => startTransition(() => router.push(href)) }}>{children}</RangeContext>;
}

export const useRangeNavigation = () => useContext(RangeContext);

/** A card or widget the range changes: a skeleton at its own height (a card's by default) while the new range loads. */
export function RangeDependent({ children, height = KEY_SUMMARY_CARD_HEIGHT }: { children: ReactNode; height?: string }) {
  const { pending } = useRangeNavigation();
  return pending ? <Skeleton className={`${height} rounded-xl`} /> : children;
}
