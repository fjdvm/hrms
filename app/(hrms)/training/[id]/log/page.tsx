import { notFound } from "next/navigation";
import { BackLink, PAGE, PageHeader } from "@/components/hiring/parts";
import { Card } from "@/components/ui/card";
import { NotificationLogView } from "@/components/training/notification-log";
import { TrainingNoAccess } from "@/components/training/no-access";
import { staffWithModule } from "@/lib/portal/staff";
import { trainingsForRequest } from "@/lib/portal/trainings";
import { TrainingError } from "@/lib/trainings";
import { formatTrainingDate, logTabFromParam, type NotificationLog } from "@/lib/training-terms";

export default async function Page({ params, searchParams }: PageProps<"/training/[id]/log">) {
  if (!(await staffWithModule("Training"))) return <TrainingNoAccess />;
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();
  const { tab: param } = await searchParams;
  const tab = logTabFromParam(Array.isArray(param) ? param[0] : param);

  let training, log: NotificationLog;
  try {
    const trainings = await trainingsForRequest();
    [training, log] = await Promise.all([trainings.read(Number(id)), trainings.log(Number(id))]);
  } catch (error) {
    if (!(error instanceof TrainingError)) throw error;
    if (error.reason === "not-found") notFound();
    return (
      <div className={PAGE}>
        <BackLink href={`/training/${id}`}>Back to the training</BackLink>
        <Card className="rounded-xl shadow-none"><p role="alert" className="p-xl text-center text-destructive">The notification log could not be loaded. Please try again in a moment.</p></Card>
      </div>
    );
  }

  return (
    <div className={PAGE}>
      <BackLink href={`/training/${training.id}`}>{training.title}</BackLink>
      <PageHeader title="Notification log" subtitle={`${training.title} · ${formatTrainingDate(training.date)} · Training notices sent by email`} />
      <NotificationLogView trainingId={training.id} log={log} tab={tab} />
    </div>
  );
}
