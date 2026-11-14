import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, Check, ClipboardCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { BackLink, PAGE } from "@/components/hiring/parts";
import { EditTrainingDialog } from "@/components/training/edit-training-dialog";
import { SendReminderDialog } from "@/components/training/reminder-dialog";
import { ReminderCard } from "@/components/training/reminder-card";
import { AssignDialog } from "@/components/training/assign-dialog";
import { CancelTrainingDialog } from "@/components/training/cancel-dialog";
import { AssignedEmployees } from "@/components/training/assigned-employees";
import { LaterCards } from "@/components/training/later-cards";
import { NotificationLogPreview } from "@/components/training/notification-log-preview";
import { MaterialsCard } from "@/components/training/materials";
import { TrainingNoAccess } from "@/components/training/no-access";
import { staffWithModule } from "@/lib/portal/staff";
import { trainingsForRequest } from "@/lib/portal/trainings";
import { TrainingError, type TrainingDetail } from "@/lib/trainings";
import { type LogEvent, formatShortDate, formatTrainingDate, formatTrainingTimes, manilaToday, type TrainingStatus } from "@/lib/training-terms";

const BADGE: Record<TrainingStatus, "success" | "secondary"> = { Upcoming: "success", Completed: "success", Cancelled: "secondary" };
const LABEL = "text-xs text-muted-foreground";

export default async function Page({ params }: PageProps<"/training/[id]">) {
  if (!(await staffWithModule("Training"))) return <TrainingNoAccess />;
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();

  let training: TrainingDetail;
  let preview: LogEvent[];
  try {
    const trainings = await trainingsForRequest();
    [training, preview] = await Promise.all([trainings.read(Number(id)), trainings.logPreview(Number(id))]);
  } catch (error) {
    if (!(error instanceof TrainingError)) throw error;
    if (error.reason === "not-found") notFound();
    return (
      <div className={PAGE}>
        <BackLink href="/training">Trainings</BackLink>
        <Card className="rounded-xl shadow-none"><p role="alert" className="p-xl text-center text-destructive">This training could not be loaded. Please try again in a moment.</p></Card>
      </div>
    );
  }
  const online = training.mode === "Online";
  const reprint = training.assigned.filter((person) => person.reprintNeeded).length;
  // Results are marked from the day of the session, for Employees who are not Cancelled.
  const resultsDue = training.assigned.filter((person) => person.status !== "Cancelled").length;
  const canMark = training.status !== "Cancelled" && training.date <= manilaToday() && resultsDue > 0;
  const notRecorded = training.status === "Completed" && training.recordedResults === 0 && resultsDue > 0;
  const MARK = "h-auto gap-[6px] rounded-lg px-[12px] py-[6px] text-[13px] font-medium shadow-none";

  return (
    <div className={PAGE}>
      <BackLink href="/training">Trainings</BackLink>
      <header className="flex flex-wrap items-start gap-sm">
        <div className="flex min-w-0 flex-1 flex-col gap-xs">
          <div className="flex flex-wrap items-center gap-[10px]">
            <h1 className="text-2xl font-semibold text-foreground">{training.title}</h1>
            <Badge variant={BADGE[training.status]}>{training.status}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">{training.trainer} · {formatTrainingDate(training.date)}, {formatTrainingTimes(training.startTime, training.endTime)} · {training.mode}</p>
        </div>
        {training.status !== "Cancelled" && (
          <>
            <EditTrainingDialog trainingId={training.id}
              training={{ title: training.title, trainer: training.trainer, description: training.description, objectives: training.objectives, date: training.date, startTime: training.startTime, endTime: training.endTime, mode: training.mode, location: training.location, rescheduledFrom: training.rescheduledFrom }}
              assigned={training.assigned.map((person) => ({ name: person.name, email: person.email }))} lockedResults={training.recordedResults} />
            {training.status === "Upcoming" && (
              <SendReminderDialog trainingId={training.id} subtitle={`${formatTrainingDate(training.date)} · ${formatTrainingTimes(training.startTime, training.endTime)}`}
                training={{ title: training.title, trainer: training.trainer, date: training.date, startTime: training.startTime, endTime: training.endTime, mode: training.mode, location: training.location }}
                people={training.assigned.filter((person) => person.status === "Assigned").map((person) => ({ name: person.name, email: person.email }))} />
            )}
            <CancelTrainingDialog trainingId={training.id} title={training.title} date={training.date} subtitle={`${formatTrainingDate(training.date)} · ${formatTrainingTimes(training.startTime, training.endTime)}`}
              people={training.assigned.filter((person) => person.status === "Assigned")} />
          </>
        )}
        <AssignDialog trainingId={training.id} title={training.title} subtitle={`${formatTrainingDate(training.date)} · ${formatTrainingTimes(training.startTime, training.endTime)}`} disabled={training.status === "Cancelled"} />
      </header>
      {training.status === "Cancelled" && (
        <p role="status" className="rounded-lg bg-[#f7f5fa] px-[14px] py-[12px] text-sm text-[#6e6680]">
          <span className="font-medium text-foreground">This training was cancelled.</span>{training.cancelReason ? ` Reason: ${training.cancelReason}` : ""}
        </p>
      )}
      {notRecorded && (
        <p role="status" className="flex items-center gap-[10px] rounded-lg bg-[#fdf1d8] px-[14px] py-[12px] text-sm font-medium text-[#8a5a00]">
          <AlertTriangle className="size-4 shrink-0" aria-hidden />
          <span className="flex-1">Results not recorded. This training was on {formatShortDate(training.date).replace(/ \d{4}$/, "")}. Mark results from the paper sign-in sheet.</span>
          <Button asChild variant="outline" className={`${MARK} border-[#e6e1ee] bg-white text-[#1f1a2e]`}><Link href={`/training/${training.id}/results`}><ClipboardCheck className="size-[14px]" aria-hidden />Mark results</Link></Button>
        </p>
      )}
      {reprint > 0 && training.rescheduledFrom && (
        <p role="status" className="flex items-center gap-[10px] rounded-lg bg-amber-50 px-[16px] py-[12px] text-sm text-amber-900">
          <AlertTriangle className="size-4 shrink-0" aria-hidden />
          Reprint schedule: {reprint} {reprint === 1 ? "employee" : "employees"} without an email {reprint === 1 ? "has" : "have"} a printed schedule with the old date ({formatShortDate(training.rescheduledFrom).replace(/ \d{4}$/, "")}).
        </p>
      )}
      <div className="flex flex-col items-start gap-[16px] lg:flex-row">
        <div className="flex w-full min-w-0 flex-1 flex-col gap-[16px]">
          <Card className="flex flex-col gap-[14px] rounded-xl px-[20px] py-[18px] shadow-none">
            <h2 className="text-[15px] font-semibold text-zinc-900">Schedule</h2>
            <dl className="grid gap-[16px] sm:grid-cols-4">
              <div className="flex flex-col gap-[2px]">
                <dt className={LABEL}>Date</dt><dd className="text-sm text-foreground">{formatTrainingDate(training.date)}</dd>
                {training.rescheduledFrom && <dd className="text-xs text-zinc-400">Rescheduled from {formatShortDate(training.rescheduledFrom)}</dd>}
              </div>
              <div className="flex flex-col gap-[2px]"><dt className={LABEL}>Time</dt><dd className="text-sm text-foreground">{formatTrainingTimes(training.startTime, training.endTime)}</dd></div>
              <div className="flex flex-col gap-[2px]"><dt className={LABEL}>Mode</dt><dd className="text-sm text-foreground">{training.mode}</dd></div>
              <div className="flex min-w-0 flex-col gap-[2px]">
                <dt className={LABEL}>{online ? "Meeting link" : "Venue"}</dt>
                <dd className="break-words text-sm text-foreground">
                  {online ? <a href={training.location} target="_blank" rel="noreferrer" className="text-primary hover:underline">{training.location.replace(/^https?:\/\//, "")}</a> : training.location}
                </dd>
              </div>
            </dl>
          </Card>
          <Card className="flex flex-col gap-[14px] rounded-xl px-[20px] py-[18px] shadow-none">
            <div className="flex items-center gap-sm">
              <h2 className="flex-1 text-[15px] font-semibold text-zinc-900">Assigned employees · {training.assigned.length}</h2>
              {training.status !== "Cancelled" && (canMark
                ? <Button asChild variant="outline" className={`${MARK} border-[#e6e1ee] bg-white text-[#1f1a2e]`}><Link href={`/training/${training.id}/results`}><ClipboardCheck className="size-[14px]" aria-hidden />Mark results</Link></Button>
                : <Button disabled title="Results can be marked from the day of the training" className={`${MARK} bg-[#f4f4f5] text-[#a1a1aa]`}><ClipboardCheck className="size-[14px]" aria-hidden />Mark results</Button>)}
            </div>
            <AssignedEmployees trainingId={training.id} title={training.title} date={formatTrainingDate(training.date)} people={training.assigned} />
          </Card>
          <Card className="flex flex-col gap-[12px] rounded-xl px-[20px] py-[18px] shadow-none">
            <h2 className="text-[15px] font-semibold text-zinc-900">About this training</h2>
            {training.description ? <p className="whitespace-pre-line text-sm text-foreground">{training.description}</p> : <p className="text-sm text-muted-foreground">No description.</p>}
            {training.objectiveList.length > 0 && (
              <>
                <p className={LABEL}>Objectives</p>
                <ul className="flex flex-col gap-[10px]">
                  {training.objectiveList.map((objective, index) => (
                    <li key={index} className="flex items-start gap-[10px] text-sm text-foreground"><Check className="mt-[3px] size-4 shrink-0 text-primary" aria-hidden />{objective}</li>
                  ))}
                </ul>
              </>
            )}
          </Card>
        </div>
        <div className="flex w-full shrink-0 flex-col gap-[16px] lg:w-[340px]">
          <MaterialsCard trainingId={training.id} initial={training.materials} />
          <NotificationLogPreview trainingId={training.id} events={preview} />
          {training.status === "Upcoming" && (
            <ReminderCard trainingDate={training.date} emailed={training.assigned.filter((person) => person.status === "Assigned" && person.email).length}
              withoutEmail={training.assigned.filter((person) => person.status === "Assigned" && !person.email).length} />
          )}
        </div>
      </div>
      <LaterCards />
    </div>
  );
}
