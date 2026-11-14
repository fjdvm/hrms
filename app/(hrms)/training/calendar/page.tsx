import { PAGE, PageHeader } from "@/components/hiring/parts";
import { Card } from "@/components/ui/card";
import { TrainingCalendar } from "@/components/training/training-calendar";
import { TrainingNoAccess } from "@/components/training/no-access";
import { TrainingRetry } from "@/components/training/training-retry";
import { staffWithModule } from "@/lib/portal/staff";
import { trainingsForRequest } from "@/lib/portal/trainings";
import { trainingCalendarRange, trainingCalendarState, trainingCalendarSubtitle, trainingCalendarTitle } from "@/lib/training-calendar";
import { TrainingError, type CalendarTraining } from "@/lib/trainings";

export default async function Page({ searchParams }: PageProps<"/training/calendar">) {
  if (!(await staffWithModule("Training"))) return <TrainingNoAccess />;
  const state = trainingCalendarState(await searchParams);

  let trainings: CalendarTraining[];
  try {
    trainings = await (await trainingsForRequest()).calendar(trainingCalendarRange(state));
  } catch (error) {
    if (!(error instanceof TrainingError)) throw error;
    return (
      <div className={PAGE}>
        <PageHeader title="Calendar" subtitle="Trainings by date" />
        <Card className="flex flex-col items-center gap-sm rounded-xl p-xl shadow-none">
          <p role="alert" className="text-center text-destructive">The calendar could not be loaded. Please try again in a moment.</p>
          <TrainingRetry />
        </Card>
      </div>
    );
  }

  return (
    <div className={PAGE}>
      <PageHeader title="Calendar" subtitle={trainingCalendarSubtitle(state, trainings.length)} />
      <TrainingCalendar state={state} title={trainingCalendarTitle(state)} trainings={trainings} />
    </div>
  );
}
