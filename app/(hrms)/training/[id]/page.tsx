import { notFound } from "next/navigation";
import { Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { BackLink, PAGE } from "@/components/hiring/parts";
import { AssignDialog } from "@/components/training/assign-dialog";
import { AssignedEmployees } from "@/components/training/assigned-employees";
import { LaterCards } from "@/components/training/later-cards";
import { MaterialsCard } from "@/components/training/materials";
import { TrainingNoAccess } from "@/components/training/no-access";
import { staffWithModule } from "@/lib/portal/staff";
import { trainingsForRequest } from "@/lib/portal/trainings";
import { TrainingError, type TrainingDetail } from "@/lib/trainings";
import { formatShortDate, formatTrainingDate, formatTrainingTimes, type TrainingStatus } from "@/lib/training-terms";

const BADGE: Record<TrainingStatus, "success" | "secondary"> = { Upcoming: "success", Completed: "success", Cancelled: "secondary" };
const LABEL = "text-xs text-muted-foreground";

export default async function Page({ params }: PageProps<"/training/[id]">) {
  if (!(await staffWithModule("Training"))) return <TrainingNoAccess />;
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();

  let training: TrainingDetail;
  try {
    training = await (await trainingsForRequest()).read(Number(id));
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
        <AssignDialog trainingId={training.id} title={training.title} subtitle={`${formatTrainingDate(training.date)} · ${formatTrainingTimes(training.startTime, training.endTime)}`} disabled={training.status === "Cancelled"} />
      </header>
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
        </div>
      </div>
      <LaterCards />
    </div>
  );
}
