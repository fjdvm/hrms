import { Suspense } from "react";
import { notFound } from "next/navigation";
import { PAGE } from "@/components/hiring/parts";
import { EmployeeProfile } from "@/components/employees/employee-profile";
import { EmployeeError, employeesFor, type EmployeeDetail } from "@/lib/employees";
import { employeesForRequest } from "@/lib/portal/employees";
import { requireModule, staffWithModule } from "@/lib/portal/staff";
import { ProfileTrainingHistory } from "@/components/training/training-history";
import { trainingsForRequest } from "@/lib/portal/trainings";
import { TrainingError } from "@/lib/trainings";
import { EmployeeSkeleton } from "./employee-skeleton";

async function Employee({ id }: { id: number }) {
  let employee: EmployeeDetail, history: Awaited<ReturnType<ReturnType<typeof employeesFor>["history"]>>, activity: Awaited<ReturnType<ReturnType<typeof employeesFor>["activity"]>>;
  try {
    const employees = await employeesForRequest();
    [employee, history, activity] = await Promise.all([employees.read(id), employees.history(id), employees.activity(id)]);
  } catch (error) {
    if (error instanceof EmployeeError && (error.reason === "not-found" || error.reason === "validation")) notFound();
    throw error;
  }
  // Training history is Training Module data: only Staff who hold that Module get the tab, and a failure there never hides the profile.
  let trainingHistory: Awaited<ReturnType<Awaited<ReturnType<typeof trainingsForRequest>>["history"]>> | null = null;
  if (await staffWithModule("Training")) {
    try {
      trainingHistory = await (await trainingsForRequest()).history(id);
    } catch (error) {
      if (!(error instanceof TrainingError)) throw error;
    }
  }
  const training = trainingHistory ? <ProfileTrainingHistory history={trainingHistory} /> : undefined;
  return <EmployeeProfile employee={employee} history={history} activity={activity} training={training} />;
}

export default async function Page({ params }: PageProps<"/employee-information/[id]">) {
  await requireModule("Employee Information");
  const { id } = await params;
  const employeeId = /^-?\d+$/.test(id) ? Number(id) : NaN;
  if (Number.isNaN(employeeId)) notFound();
  return (
    <div className={PAGE}>
      <Suspense fallback={<EmployeeSkeleton />}>
        <Employee id={employeeId} />
      </Suspense>
    </div>
  );
}
