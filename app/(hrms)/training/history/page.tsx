import { TrainingNoAccess } from "@/components/training/no-access";
import { ModulePlaceholder } from "@/components/shared/module-placeholder";
import { staffWithModule } from "@/lib/portal/staff";

export default async function Page() {
  if (!(await staffWithModule("Training"))) return <TrainingNoAccess />;

  return <ModulePlaceholder name="Training history" />;
}
