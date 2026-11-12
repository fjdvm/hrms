import { Suspense } from "react";
import { notFound } from "next/navigation";
import { PAGE } from "@/components/hiring/parts";
import { EmployeeProfile } from "@/components/employees/employee-profile";
import { EmployeeError, employeesFor, type EmployeeDetail } from "@/lib/employees";
import { employeesForRequest } from "@/lib/portal/employees";
import { requireModule } from "@/lib/portal/staff";
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
  return <EmployeeProfile employee={employee} history={history} activity={activity} />;
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
