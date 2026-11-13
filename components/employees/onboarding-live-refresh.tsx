"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { LIVE_NOTIFICATION_EVENT } from "@/lib/live-events";

/** Re-reads the page when the live connection pushes a notification (a request moved on). No timer, no focus refetch. */
export function OnboardingLiveRefresh() {
  const router = useRouter();
  useEffect(() => {
    const refresh = () => router.refresh();
    window.addEventListener(LIVE_NOTIFICATION_EVENT, refresh);
    return () => window.removeEventListener(LIVE_NOTIFICATION_EVENT, refresh);
  }, [router]);
  return null;
}
