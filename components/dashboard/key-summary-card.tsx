import { Card } from "@/components/ui/card";
import { ArrowDown, ArrowUp } from "lucide-react";
import { cn } from "@/lib/utils";
import type { KeySummaryCard as KeySummaryCardData } from "@/lib/dashboard";

/** One fixed height (Figma Dashboard frame 273:4645) with or without data, so the Dashboard does not jump while it loads. */
export const KEY_SUMMARY_CARD_HEIGHT = "h-[108px]";

export function KeySummaryCard({ label, figure, caption, comparison }: KeySummaryCardData) {
  return (
    <Card className={cn(KEY_SUMMARY_CARD_HEIGHT, "flex flex-col gap-1.5 overflow-hidden px-5 py-4 shadow-none")}>
      <p className="text-[13px] font-medium leading-4 text-muted-foreground">{label}</p>
      {figure === null ? (
        <p className="text-label-sm text-muted-foreground">Nothing to show yet</p>
      ) : (
        <>
          <p className="text-headline-md font-bold">{figure}</p>
          {caption && <p className="text-label-sm text-muted-foreground">{caption}</p>}
          {comparison && (
            <p
              className={cn(
                "flex items-center gap-1 text-label-sm",
                comparison.tone === "good" ? "text-green-600" : comparison.tone === "bad" ? "text-red-600" : "text-muted-foreground",
              )}
            >
              {comparison.arrow === "up" && <ArrowUp className="size-3" aria-hidden />}
              {comparison.arrow === "down" && <ArrowDown className="size-3" aria-hidden />}
              {comparison.text}
            </p>
          )}
        </>
      )}
    </Card>
  );
}
