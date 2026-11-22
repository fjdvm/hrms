"use client";

import { useRef, useState, useTransition } from "react";
import { Check, CircleAlert, Info, Loader2, Sparkles, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { dismissSuggestedNeed, generateSuggestions } from "@/app/(hrms)/performance/actions";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { aiMessage } from "@/lib/ai/messages";
import type { EvaluationDetail } from "@/lib/performance-evaluations";
import { dayMonth } from "@/lib/performance-evaluation-view";
import type { DevelopmentNeed } from "@/lib/performance-needs";
import type { Suggestion, SuggestionStatus, SuggestionView } from "@/lib/performance-suggestions";
import type { TrainingTitle } from "@/lib/performance-training";
import { FlagNeedDialog } from "./flag-need-dialog";

/**
 * The Development needs section of the Evaluation card: the flagged needs, the Suggest with AI button beside the label, and the AI
 * suggestions block under the list. Everything the AI says is a suggestion for a person to review: it never changes the score.
 *
 * Suggest with AI is offered on an Evaluated evaluation while the feature is switched on, and is a button press only (nothing here asks
 * on a timer). A set from an earlier version, or any set while the evaluation is back In review, shows read-only with its version.
 */

type Outcome =
  | { kind: "nothing" }
  | { kind: "ai"; banner: "yellow" | "red" | "grey" | "none"; message: string; referenceId: string | null }
  | { kind: "error"; message: string };

const BUTTON = "h-auto gap-[6px] rounded-lg border-[#e6e1ee] px-[12px] py-[6px] text-[13px] font-medium shadow-none";
const CARD = "flex flex-col gap-[6px] rounded-lg border border-[#e6e1ee] bg-white px-[14px] py-[12px]";

/** The recommendation as the screen words it: the scheduled Training's title, or a topic when none matches. */
function recommendation(suggestion: Suggestion) {
  if (suggestion.trainingTitle) return `Recommended Training: ${suggestion.trainingTitle}`;
  return `No matching Training, consider a session on ${suggestion.recommendation.replace(/[.\s]+$/, "")}`;
}

function SuggestionCard({ suggestion, kpiName, actionable, busy, onFlag, onDismiss }: { suggestion: Suggestion; kpiName: string; actionable: boolean; busy: boolean; onFlag: () => void; onDismiss: () => void }) {
  return (
    <li className={CARD} data-testid="suggestion">
      <div className="flex items-center gap-[8px]">
        <p className="min-w-0 flex-1 text-sm font-medium text-foreground">{suggestion.gap}</p>
        <span className="shrink-0 rounded-full bg-[#f4f4f5] px-[8px] py-[3px] text-[11px] font-medium text-[#71717a]">{kpiName} {suggestion.result.toFixed(1)} · target {suggestion.target.replace(/%$/, "")}</span>
      </div>
      <p className="text-[13px] text-[#1f1a2e]">{recommendation(suggestion)}</p>
      <p className="text-xs text-[#71717a]">{suggestion.reason}</p>
      {suggestion.status === "Flagged" && (
        <p className="flex items-center justify-end gap-[6px] text-[13px] font-medium text-[#1e6b3a]"><Check aria-hidden className="size-[14px]" />Flagged as a development need</p>
      )}
      {suggestion.status === "Pending" && actionable && (
        <div className="flex items-center justify-end gap-[8px]">
          <button type="button" disabled={busy} onClick={onDismiss} className="text-[13px] font-medium text-[#71717a] hover:text-foreground disabled:opacity-50">Dismiss</button>
          <Button type="button" variant="outline" disabled={busy} onClick={onFlag} className="h-auto rounded-lg border-[#e6e1ee] px-[12px] py-[6px] text-[13px] font-medium text-[#5b2a86] shadow-none">Flag as need</Button>
        </div>
      )}
    </li>
  );
}

function GeneratingCards() {
  return (
    <div role="status" aria-label="Generating suggestions" className="flex flex-col gap-[12px]">
      {[0, 1].map((i) => (
        <div key={i} className={CARD}><Skeleton className="h-3 w-48" /><Skeleton className="h-3 w-4/5" /><Skeleton className="h-3 w-2/3" /></div>
      ))}
    </div>
  );
}

function Notice({ tone, children }: { tone: "yellow" | "red" | "grey"; children: React.ReactNode }) {
  const style = { yellow: "bg-[#fdf1d8] text-[#8a5a00]", red: "bg-[#fdeceb] text-[#b42318]", grey: "bg-[#f4f4f5] text-[#52525b]" }[tone];
  const Icon = tone === "yellow" ? TriangleAlert : tone === "red" ? CircleAlert : Info;
  return (
    <div role={tone === "red" ? "alert" : "status"} className={`flex items-start gap-[10px] rounded-lg px-[12px] py-[10px] ${style}`}>
      <Icon aria-hidden className="mt-[2px] size-[16px] shrink-0" />
      <p className="flex-1 text-[13px]">{children}</p>
    </div>
  );
}

type Props = {
  detail: EvaluationDetail;
  needs: readonly DevelopmentNeed[];
  trainings: readonly TrainingTitle[];
  /** The saved suggestions, or null when they could not be read. */
  suggestions: SuggestionView | null;
  /** Whether the feature is on and how many runs are left today, or null when that could not be read (the button is then hidden). */
  aiStatus: SuggestionStatus | null;
};

export function DevelopmentNeedsSection({ detail, needs, trainings, suggestions, aiStatus }: Props) {
  const [generating, startGenerate] = useTransition();
  const [reviewing, startReview] = useTransition();
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [left, setLeft] = useState(aiStatus?.left ?? null);
  const [dismissed, setDismissed] = useState<ReadonlySet<number>>(new Set());
  const [flag, setFlag] = useState<{ suggestion: Suggestion; open: boolean } | null>(null);
  // A press that is still out when another starts ignores the older answer.
  const run = useRef(0);

  const evaluated = detail.status === "Evaluated";
  const set = suggestions?.set ?? null;
  const showButton = evaluated && aiStatus !== null && aiStatus.enabled;
  const limitReached = aiStatus !== null && left !== null && left <= 0;
  const hasCurrentSet = set !== null && suggestions?.actionable === true;
  const visible = set ? set.suggestions.filter((item) => item.status !== "Dismissed" && !dismissed.has(item.id)) : [];
  const showBlock = generating || outcome !== null || set !== null || (showButton && limitReached);
  const version = detail.submitted?.version ?? set?.version ?? null;

  function generate() {
    const mine = ++run.current;
    setOutcome(null);
    startGenerate(async () => {
      const result = await generateSuggestions(detail.employeeId, detail.period.id);
      if (mine !== run.current) return;
      if (result.ok) { setLeft(result.left); setDismissed(new Set()); return; }
      if (result.kind === "error") { setOutcome({ kind: "error", message: result.error }); return; }
      setLeft(result.left);
      if (result.kind === "nothing") { setOutcome({ kind: "nothing" }); return; }
      setOutcome({ kind: "ai", banner: result.banner, message: result.message ?? "AI suggestions aren't available right now.", referenceId: result.referenceId });
    });
  }

  function dismiss(suggestion: Suggestion) {
    startReview(async () => {
      const result = await dismissSuggestedNeed(detail.employeeId, suggestion.id);
      if (!result.ok) { toast.error(result.error); return; }
      setDismissed((was) => new Set(was).add(suggestion.id));
    });
  }

  const caption = set ? (
    <p className="text-xs text-[#71717a]">
      AI-generated from this evaluation’s KPI results · version {set.version} · generated by {set.generatedByName}, {dayMonth(set.generatedAt)}.
      {suggestions?.actionable ? "" : " Kept for reference, so it can’t be flagged or dismissed."} It never changes the score.
    </p>
  ) : outcome?.kind === "nothing" && version !== null ? (
    <p className="text-xs text-[#71717a]">Checked from this evaluation’s KPI results · version {version}. It never changes the score.</p>
  ) : null;

  return (
    <>
      {(needs.length > 0 || showButton || showBlock) && (
        <div className="flex flex-col gap-[8px]" data-testid="development-needs">
          <div className="flex items-center gap-[12px]">
            <h3 className="flex-1 text-xs text-muted-foreground">Development needs</h3>
            {showButton && (
              <Button type="button" variant="outline" disabled={generating || limitReached} onClick={generate} className={BUTTON}>
                {generating ? <Loader2 aria-hidden className="size-[14px] animate-spin" /> : <Sparkles aria-hidden className="size-[14px]" />}
                {hasCurrentSet ? "Regenerate" : "Suggest with AI"}
              </Button>
            )}
          </div>
          {needs.length > 0 && (
            <ul className="flex flex-col gap-[8px]">
              {needs.map((need) => (
                <li key={need.id} className="flex flex-col text-sm text-foreground">
                  <span>
                    {need.gap} · recommended {need.action}
                    {need.source === "ai" && <span className="ml-[8px] rounded-full bg-[#f1ebf8] px-[8px] py-[2px] align-middle text-[11px] font-medium text-[#5b2a86]">AI-suggested</span>}
                  </span>
                  <span className="text-xs text-muted-foreground">Flagged by {need.flaggedByName} on {dayMonth(need.flaggedAt)}</span>
                </li>
              ))}
            </ul>
          )}
          {showBlock && (
            <section aria-label="AI suggestions" className="flex flex-col gap-[12px] rounded-[10px] border border-[#e6e1ee] bg-[#f9f7fb] px-[16px] pb-[16px] pt-[14px]">
              <h4 className="flex items-center gap-[8px] text-sm font-semibold text-[#5b2a86]"><Sparkles aria-hidden className="size-[16px]" />AI suggestions</h4>
              {caption}
              {generating && <GeneratingCards />}
              {!generating && outcome?.kind === "nothing" && <Notice tone="grey">All KPIs are at or above target, so there is nothing to suggest for this evaluation.</Notice>}
              {!generating && outcome?.kind === "error" && <Notice tone="red">{outcome.message}</Notice>}
              {!generating && outcome?.kind === "ai" && outcome.banner !== "none" && (
                <>
                  <Notice tone={outcome.banner}>{outcome.message}</Notice>
                  {outcome.banner === "red" && (
                    <>
                      {outcome.referenceId && <p className="text-xs text-[#71717a]">Reference {outcome.referenceId} · give this to support if the problem continues</p>}
                      <Button type="button" variant="outline" onClick={generate} className="h-auto w-full rounded-lg border-[#e6e1ee] py-[6px] text-[13px] shadow-none">Try again</Button>
                    </>
                  )}
                </>
              )}
              {!generating && outcome === null && limitReached && (
                <Notice tone="yellow">{aiMessage("limit-reached", "suggestions", aiStatus?.limit ?? 60)}</Notice>
              )}
              {!generating && set && (
                visible.length > 0 ? (
                  <ul className="flex flex-col gap-[12px]">
                    {visible.map((item) => (
                      <SuggestionCard key={item.id} suggestion={item} kpiName={detail.kpis.find((kpi) => kpi.id === item.kpiId)?.name ?? item.kpiId} actionable={suggestions?.actionable === true && evaluated} busy={reviewing}
                        onFlag={() => setFlag({ suggestion: item, open: true })} onDismiss={() => dismiss(item)} />
                    ))}
                  </ul>
                ) : <p className="text-[13px] text-[#71717a]">Every suggestion has been reviewed.</p>
              )}
            </section>
          )}
        </div>
      )}
      {flag && <FlagNeedDialog detail={detail} trainings={trainings} suggestion={flag.suggestion} open={flag.open} onOpenChange={(open) => setFlag((was) => (was ? { ...was, open } : was))} />}
    </>
  );
}
