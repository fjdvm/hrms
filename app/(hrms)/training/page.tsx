import Link from "next/link";
import { Paperclip, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CELL, HEAD, InfoNote, PAGE, PageHeader } from "@/components/hiring/parts";
import { TrainingCompletionCard } from "@/components/training/completion-card";
import { TrainingNoAccess } from "@/components/training/no-access";
import { TrainingRetry } from "@/components/training/training-retry";
import { staffWithModule } from "@/lib/portal/staff";
import { trainingsForRequest } from "@/lib/portal/trainings";
import { TrainingError, type TrainingPage } from "@/lib/trainings";
import {
  TRAINING_TABS, formatShortDate, formatTrainingDate, formatTrainingTimes, trainingTabFromParam, trainingsHref,
  type TrainingStatus,
} from "@/lib/training-terms";
import { cn } from "@/lib/utils";

const BADGE: Record<TrainingStatus, "success" | "secondary"> = { Upcoming: "success", Completed: "success", Cancelled: "secondary" };
const EMPTY: Record<string, string> = { All: "No trainings yet.", Upcoming: "No upcoming trainings.", Past: "No past trainings.", Cancelled: "No cancelled trainings." };

export default async function Page({ searchParams }: PageProps<"/training">) {
  if (!(await staffWithModule("Training"))) return <TrainingNoAccess />;
  const { tab: param } = await searchParams;
  const tab = trainingTabFromParam(Array.isArray(param) ? param[0] : param);

  let result: TrainingPage;
  try {
    result = await (await trainingsForRequest()).list(tab);
  } catch (error) {
    if (!(error instanceof TrainingError)) throw error;
    return (
      <div className={PAGE}>
        <PageHeader title="Trainings" subtitle="Dated sessions for employees" />
        <Card className="flex flex-col items-center gap-sm rounded-xl p-xl shadow-none">
          <p role="alert" className="text-center text-destructive">Trainings could not be loaded. Please try again in a moment.</p>
          <TrainingRetry />
        </Card>
      </div>
    );
  }
  const { rows, counts, thisMonth, month, completion, needResults } = result;

  return (
    <div className={PAGE}>
      <PageHeader title="Trainings" subtitle={`Dated sessions for employees · ${thisMonth} ${thisMonth === 1 ? "training" : "trainings"} this month`}>
        <Button asChild className="h-auto gap-[6px] rounded-lg px-[14px] py-[9px] font-medium shadow-none">
          <Link href="/training/new"><Plus className="size-4" aria-hidden />New training</Link>
        </Button>
      </PageHeader>
      <TrainingCompletionCard month={month} completion={completion} needResults={needResults} />
      <nav aria-label="Status" className="flex flex-wrap gap-xs">
        {TRAINING_TABS.map((name) => (
          <Link
            key={name}
            href={trainingsHref(name)}
            aria-current={name === tab ? "page" : undefined}
            className={cn(
              "rounded-lg px-[14px] py-[8px] text-sm font-medium text-muted-foreground hover:text-foreground",
              name === tab && "bg-accent text-primary hover:text-primary",
            )}
          >
            {name} {counts[name]}
          </Link>
        ))}
      </nav>
      <Card className="flex flex-col gap-[14px] overflow-auto rounded-xl p-[20px] shadow-none">
        {rows.length === 0 ? (
          <div className="flex flex-col items-center gap-sm p-xl text-center">
            <p className="text-muted-foreground">{EMPTY[tab]}</p>
            {tab === "All" && (
              <Button asChild className="h-auto gap-[6px] rounded-lg px-[14px] py-[9px] font-medium shadow-none">
                <Link href="/training/new"><Plus className="size-4" aria-hidden />New training</Link>
              </Button>
            )}
          </div>
        ) : (
          <Table className="min-w-[960px] table-fixed">
            <TableHeader>
              <TableRow className="border-border-subtle hover:bg-transparent">
                <TableHead className={`${HEAD} w-[270px]`}>Training</TableHead>
                <TableHead className={`${HEAD} w-[230px]`}>Date and time</TableHead>
                <TableHead className={`${HEAD} w-[100px]`}>Mode</TableHead>
                <TableHead className={`${HEAD} w-[90px]`}>Assigned</TableHead>
                <TableHead className={`${HEAD} w-[160px]`}>Completed</TableHead>
                <TableHead className={HEAD}>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((training) => (
                <TableRow key={training.id} className="relative border-border-subtle">
                  <TableCell className={CELL}>
                    <div className="flex flex-col gap-[2px]">
                      <Link href={`/training/${training.id}`} className={cn("text-sm font-medium after:absolute after:inset-0 hover:underline", training.status === "Cancelled" ? "text-muted-foreground" : "text-primary")}>{training.title}</Link>
                      <span className="flex items-center gap-[6px] text-xs text-muted-foreground">
                        {training.trainer}
                        {training.hasMaterials && <><span aria-hidden className="text-zinc-400">·</span><Paperclip className="size-3" aria-hidden />Materials attached</>}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className={CELL}>
                    <div className="flex flex-col gap-[2px]">
                      <span>{formatTrainingDate(training.date)}</span>
                      <span className="text-xs text-muted-foreground">{formatTrainingTimes(training.startTime, training.endTime)}</span>
                      {training.rescheduledFrom && <span className="text-xs text-zinc-400">Rescheduled from {formatShortDate(training.rescheduledFrom)}</span>}
                    </div>
                  </TableCell>
                  <TableCell className={CELL}>{training.mode}</TableCell>
                  <TableCell className={CELL}>{training.assigned}</TableCell>
                  <TableCell className={cn(CELL, training.status === "Cancelled" && "text-zinc-400")}>
                    {training.status === "Cancelled" ? "—" : training.resultsNotRecorded ? (
                      <div className="flex flex-col gap-[2px]">
                        <span>— of {training.assigned}</span>
                        <span className="text-xs font-medium text-amber-700">Results not recorded</span>
                      </div>
                    ) : `${training.completed} of ${training.assigned}`}
                  </TableCell>
                  <TableCell className={CELL}><Badge variant={BADGE[training.status]}>{training.status}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <InfoNote>
          Assigned employees are notified by email. For employees without an email, print the schedule from the training page.
        </InfoNote>
      </Card>
    </div>
  );
}

