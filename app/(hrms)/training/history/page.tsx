import { PAGE, PageHeader } from "@/components/hiring/parts";
import { Card } from "@/components/ui/card";
import { EmployeePicker } from "@/components/training/employee-picker";
import { TrainingHistoryView } from "@/components/training/training-history";
import { TrainingNoAccess } from "@/components/training/no-access";
import { staffWithModule } from "@/lib/portal/staff";
import { trainingsForRequest } from "@/lib/portal/trainings";
import { TrainingError } from "@/lib/trainings";
import { historyTabFromParam, type TrainingHistory } from "@/lib/training-terms";

export default async function Page({ searchParams }: PageProps<"/training/history">) {
  if (!(await staffWithModule("Training"))) return <TrainingNoAccess />;
  const { employee: employeeParam, tab: tabParam } = await searchParams;
  const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  const requested = /^\d+$/.test(one(employeeParam) ?? "") ? Number(one(employeeParam)) : null;
  const tab = historyTabFromParam(one(tabParam));

  let employees: { id: number; name: string; employeeNumber: string }[];
  let history: TrainingHistory | null = null;
  let missing = false;
  try {
    const trainings = await trainingsForRequest();
    employees = await trainings.historyEmployees();
    if (requested !== null) {
      try { history = await trainings.history(requested); } catch (error) {
        if (!(error instanceof TrainingError && error.reason === "not-found")) throw error;
        missing = true;
      }
    }
  } catch (error) {
    if (!(error instanceof TrainingError)) throw error;
    return (
      <div className={PAGE}>
        <PageHeader title="Training history" subtitle="Trainings assigned to one employee, with results and completion dates" />
        <Card className="rounded-xl shadow-none"><p role="alert" className="p-xl text-center text-destructive">Training history could not be loaded. Please try again in a moment.</p></Card>
      </div>
    );
  }

  return (
    <div className={PAGE}>
      <PageHeader title="Training history" subtitle="Trainings assigned to one employee, with results and completion dates">
        <EmployeePicker employees={employees} selected={history?.employee.id ?? null} />
      </PageHeader>
      {history ? <TrainingHistoryView history={history} tab={tab} /> : (
        <Card className="rounded-xl shadow-none">
          <p className="p-xl text-center text-muted-foreground">{missing ? "That employee could not be found. Choose someone from the list." : employees.length === 0 ? "No employee records yet." : "Choose an employee to see the trainings they were assigned to."}</p>
        </Card>
      )}
    </div>
  );
}
