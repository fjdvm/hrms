"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";

/** The error strip's "Try again": refetches on a user action, never on a timer. */
export function TrainingRetry() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button variant="outline" disabled={pending} onClick={() => start(() => router.refresh())} className="h-auto rounded-lg px-[14px] py-[9px] shadow-none">
      {pending ? "Trying…" : "Try again"}
    </Button>
  );
}
