"use client";

import { useState, useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { retryTrainingNotice } from "@/app/(hrms)/training/actions";

/** Retry on one Not reached Employee. A user action, never a timer. */
export function RetryNoticeButton({ trainingId, noticeId, name }: { trainingId: number; noticeId: number; name: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  return (
    <div className="flex flex-col items-end gap-[4px]">
      <Button type="button" variant="outline" disabled={pending} aria-label={`Retry ${name}`}
        onClick={() => start(async () => setError((await retryTrainingNotice(trainingId, noticeId)).error))}
        className="h-auto gap-[6px] rounded-lg px-[12px] py-[7px] text-[13px] shadow-none">
        <RefreshCw className="size-4" aria-hidden />{pending ? "Retrying…" : "Retry"}
      </Button>
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
