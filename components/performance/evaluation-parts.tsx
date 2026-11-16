import { Check, Clock, RotateCcw, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { HEAD } from "@/components/hiring/parts";
import type { EvaluationDetail } from "@/lib/performance-evaluations";
import { bannerText, checklist, lineFigures, overallFigures, periodFigures, scoreHeadline, scoredWeight } from "@/lib/performance-evaluation-view";
import { cn } from "@/lib/utils";

const TITLE = "text-[15px] font-semibold text-foreground";
const CAPTION = "text-xs text-muted-foreground";

/** The banner: whether Submit is unlocked, or why it is locked, with an Enter rating button when the rating is what is missing. */
export function Banner({ detail, onEnterRating, onReopen }: { detail: EvaluationDetail; onEnterRating: () => void; /** Wired by the Reopen evaluation dialog; without it the button is shown but cannot act. */ onReopen?: () => void }) {
  const locked = !detail.submit.unlocked && !detail.submitted;
  return (
    <div role="status" data-testid="submit-banner" className="flex flex-wrap items-center gap-sm rounded-xl bg-[#fdf1d8] px-[20px] py-[14px] text-[13px] text-[#8a5a00]">
      <TriangleAlert aria-hidden className="size-4 shrink-0" />
      <p className="min-w-[240px] flex-1">{bannerText(detail)}</p>
      {detail.submitted && (
        <Button type="button" variant="outline" disabled={!onReopen} onClick={onReopen} className="h-auto gap-[6px] rounded-lg border-[#e6e1ee] bg-white px-[14px] py-[8px] text-[#1f1a2e] shadow-none disabled:opacity-40"><RotateCcw aria-hidden className="size-4" />Reopen evaluation</Button>
      )}
      {locked && detail.submit.action === "enter-rating" && (
        <Button type="button" variant="outline" onClick={onEnterRating} className="h-auto rounded-lg border-[#e6e1ee] bg-white px-[14px] py-[8px] text-[#1f1a2e] shadow-none">Enter rating</Button>
      )}
    </div>
  );
}

export function PeriodCard({ detail }: { detail: EvaluationDetail }) {
  const figures = periodFigures(detail);
  const cell = (label: string, value: string, sub?: string) => (
    <div className="flex flex-col gap-[2px]"><dt className={CAPTION}>{label}</dt><dd className="text-sm font-medium text-foreground">{value}</dd>{sub && <dd className={CAPTION}>{sub}</dd>}</div>
  );
  return (
    <Card className="flex flex-col gap-[14px] rounded-xl p-[20px] shadow-none">
      <h2 className={TITLE}>Evaluation period</h2>
      <dl className="grid grid-cols-2 gap-[16px] sm:grid-cols-4">
        {cell("Period", figures.period.name, figures.period.range)}
        {cell("Shift", figures.shift)}
        {cell("Scheduled days", figures.scheduled)}
        {cell("Grace period", figures.grace)}
      </dl>
    </Card>
  );
}

/** The KPI results: the score out of 100 and the weight set in the title, then source, result, weight and points per KPI and the overall row. */
export function KpiResults({ detail, action }: { detail: EvaluationDetail; action: React.ReactNode }) {
  const headline = scoreHeadline(detail);
  const overall = overallFigures(detail);
  const rescaled = detail.score.outcome === "scored" && detail.rating !== null && scoredWeight(detail.kpis) < 100;
  const setName = detail.weightSet ? `${detail.weightSet.name}${rescaled ? ", rescaled" : ""}` : "No weight set";
  return (
    <Card className="flex flex-col gap-[14px] overflow-auto rounded-xl p-[20px] shadow-none">
      <div className="flex flex-wrap items-center gap-sm">
        <h2 className={cn(TITLE, "flex-1")}>KPI results · {headline} · {setName}</h2>
        {action}
      </div>
      {detail.shift === null ? (
        <p className="p-lg text-center text-muted-foreground">Not scored: shift missing. Set the Employee’s shift on their record to score them.</p>
      ) : (
        <Table className="min-w-[620px] table-fixed">
          <TableHeader>
            <TableRow className="border-border-subtle hover:bg-transparent">
              <TableHead className={`${HEAD} w-[240px]`}>KPI</TableHead>
              <TableHead className={`${HEAD} w-[150px]`}>Source</TableHead>
              <TableHead className={`${HEAD} w-[120px]`}>Result</TableHead>
              <TableHead className={`${HEAD} w-[80px]`}>Weight</TableHead>
              <TableHead className={`${HEAD} text-right`}>Points</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {detail.kpis.map((line) => {
              const figures = lineFigures(detail, line);
              return (
                <TableRow key={line.id} className="border-border-subtle">
                  <TableCell className="px-0 py-[10px]"><div className="flex flex-col gap-[2px]"><span className="text-sm font-medium">{line.name}</span><span className={CAPTION}>{figures.note}</span></div></TableCell>
                  <TableCell className="px-0 py-[10px] text-sm">{line.source}</TableCell>
                  <TableCell className="px-0 py-[10px] text-sm font-semibold">{figures.result}</TableCell>
                  <TableCell className="px-0 py-[10px] text-sm">{figures.weight}</TableCell>
                  <TableCell className="px-0 py-[10px] text-right text-sm">{figures.points}</TableCell>
                </TableRow>
              );
            })}
            <TableRow className="border-border-subtle hover:bg-transparent">
              <TableCell className="px-0 py-[10px]"><div className="flex flex-col gap-[2px]"><span className="text-sm font-medium">Overall weighted score</span><span className={CAPTION}>{overall.note}</span></div></TableCell>
              <TableCell className="px-0 py-[10px] text-sm">—</TableCell>
              <TableCell className="px-0 py-[10px] text-sm font-bold" data-testid="overall-score">{overall.score}</TableCell>
              <TableCell className="px-0 py-[10px] text-sm">100%</TableCell>
              <TableCell className="px-0 py-[10px] text-right text-sm">{detail.score.outcome === "scored" && detail.rating !== null ? detail.score.value.toFixed(1) : "—"}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      )}
    </Card>
  );
}

/** The four-item Submit checklist with each check's state and detail. */
export function Checklist({ detail }: { detail: EvaluationDetail }) {
  return (
    <Card className="flex flex-col gap-[12px] rounded-xl p-[20px] shadow-none">
      <h2 className={TITLE}>Submit checklist</h2>
      <ul className="flex flex-col gap-[10px]">
        {checklist(detail).map((check) => (
          <li key={check.id} data-passed={check.passed} className="flex items-center gap-[12px] rounded-lg border border-[#ebe6f0] px-[12px] py-[10px]">
            <span className="flex size-[28px] shrink-0 items-center justify-center rounded-lg bg-[#f4f1f7]">
              {check.passed ? <Check aria-hidden className="size-4" /> : <Clock aria-hidden className="size-4 text-[#8a5a00]" />}
              <span className="sr-only">{check.passed ? "Done" : "Not done"}</span>
            </span>
            <div className="flex flex-col gap-[2px]"><span className="text-sm font-medium">{check.label}</span><span className={CAPTION}>{check.detail}</span></div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export const StatusBadge = ({ status }: { status: EvaluationDetail["status"] }) => (
  <Badge variant={status === "Evaluated" ? "success" : status === "In review" ? "warning" : "secondary"}>{status}</Badge>
);
