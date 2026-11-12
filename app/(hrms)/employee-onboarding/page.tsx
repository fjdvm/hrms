import { ModulePlaceholder } from "@/components/shared/module-placeholder";
import { requireModule } from "@/lib/portal/staff";

export default async function Page() {
  await requireModule("Employee Onboarding");

  return <ModulePlaceholder name="Employee Onboarding" />;
}
