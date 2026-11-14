import { notFound, redirect } from "next/navigation";
import { BackLink, PAGE } from "@/components/hiring/parts";
import { MarkResults } from "@/components/training/mark-results";
import { TrainingNoAccess } from "@/components/training/no-access";
import { staffWithModule } from "@/lib/portal/staff";
import { trainingsForRequest } from "@/lib/portal/trainings";
import { TrainingError, type TrainingDetail } from "@/lib/trainings";
import { formatTrainingDate, formatTrainingTimes, manilaToday } from "@/lib/training-terms";
import { Card } from "@/components/ui/card";

/** "Training · Mark results": results from the paper sign-in sheet, never "attendance". */
export default async function Page({ params }: PageProps<"/training/[id]/results">) {
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
  // A Cancelled training has nothing to mark; the Training page explains why.
  if (training.status === "Cancelled") redirect(`/training/${training.id}`);
  const today = manilaToday();
  const held = training.date <= today;

  return (
    <div className={PAGE}>
      <BackLink href={`/training/${training.id}`}>{training.title}</BackLink>
      <header className="flex flex-col gap-xs">
        <h1 className="text-2xl font-semibold text-foreground">Mark results</h1>
        <p className="text-sm text-muted-foreground">{training.title} · {formatTrainingDate(training.date)} · {formatTrainingTimes(training.startTime, training.endTime)} · from the paper sign-in sheet</p>
      </header>
      {held
        ? <MarkResults trainingId={training.id} trainingDate={training.date} today={today} people={training.assigned} />
        : <Card className="rounded-xl shadow-none"><p role="status" className="p-xl text-center text-muted-foreground">Results can be marked from the day of the training, {formatTrainingDate(training.date)}.</p></Card>}
    </div>
  );
}
