import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Card } from "@/components/ui/card";
import type { TrainingCompletion } from "@/lib/training-terms";

/**
 * Training completion for Trainings held this month (Manila time): Assigned employees marked Completed as a whole percent of
 * the results due, Cancelled employees not counted. With nothing held it says "Nothing to show yet", never 0%.
 */
export function TrainingCompletionCard({ month, completion, needResults }: { month: string; completion: TrainingCompletion | null; needResults: { id: number; title: string }[] }) {
  return (
    <Card className="flex flex-wrap items-center gap-[24px] rounded-xl px-[20px] py-[18px] shadow-none">
      <div className="flex w-[300px] max-w-full flex-col gap-[6px]">
        <p className="text-[13px] font-medium text-zinc-500">Training completion · {month}</p>
        {completion ? (
          <>
            <div className="flex items-end gap-[10px]">
              <span className="text-[28px] font-bold leading-[normal] text-zinc-900">{completion.percent}%</span>
              <span className="text-[13px] font-medium text-[#6e6680]">{completion.completed} of {completion.due} completed</span>
            </div>
            <div className="h-[6px] rounded-[4px] bg-[#f1edf6]" role="progressbar" aria-label="Training completion" aria-valuemin={0} aria-valuemax={100} aria-valuenow={completion.percent}>
              <div className="h-[6px] rounded-[4px] bg-[#5b2a86]" style={{ width: `${completion.percent}%` }} />
            </div>
          </>
        ) : (
          <p className="text-lg font-semibold text-zinc-400">Nothing to show yet</p>
        )}
      </div>
      <div aria-hidden className="hidden h-[56px] w-px bg-[#efebf4] sm:block" />
      <div className="flex min-w-[240px] flex-1 flex-col gap-[4px]">
        <p className="text-xs text-[#6e6680]">Assigned employees marked Completed, as a share of results due for Trainings held this month (Manila time). Cancelled employees are not counted.</p>
        {needResults.length > 0 && (
          <p className="flex flex-wrap items-center gap-[6px] text-xs font-medium text-[#8a5a00]">
            <AlertTriangle className="size-[14px] shrink-0" aria-hidden />
            {needResults.length === 1 ? `1 training still needs results: ${needResults[0].title}` : `${needResults.length} trainings still need results`}
            <Link href={`/training/${needResults[0].id}/results`} className="font-semibold text-primary hover:underline">Mark results</Link>
          </p>
        )}
      </div>
    </Card>
  );
}
