"use client";

import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LIVE_EVENT } from "@/lib/live-events";

/**
 * Re-reads the Onboarding list when the live connection pushes something (an account created, a person made Active), so the
 * list stays current without a reload. It makes no request of its own: no timer, no focus refetch (ADR-0005).
 */
export function OnboardingLive() {
  const router = useRouter();
  const [, start] = useTransition();
  useEffect(() => {
    const refresh = () => start(() => router.refresh());
    window.addEventListener(LIVE_EVENT, refresh);
    return () => window.removeEventListener(LIVE_EVENT, refresh);
  }, [router]);
  return null;
}
