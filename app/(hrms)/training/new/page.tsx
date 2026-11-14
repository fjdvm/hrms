import { BackLink, PageHeader } from "@/components/hiring/parts";
import { TrainingForm } from "@/components/training/training-form";
import { TrainingNoAccess } from "@/components/training/no-access";
import { staffWithModule } from "@/lib/portal/staff";
import { manilaToday } from "@/lib/training-terms";

export default async function Page() {
  if (!(await staffWithModule("Training"))) return <TrainingNoAccess />;

  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-[16px] px-md pt-[20px] sm:px-xl">
        <BackLink href="/training">Trainings</BackLink>
        <PageHeader title="New training" subtitle="One dated session with one time and one venue or meeting link. Repeat sessions are separate trainings." />
      </div>
      <TrainingForm today={manilaToday()} />
    </div>
  );
}
