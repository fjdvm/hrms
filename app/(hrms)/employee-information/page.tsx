import Link from "next/link";
import { Suspense } from "react";
import { FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CELL, HEAD, InfoNote, PAGE, PageHeader, PersonCell } from "@/components/hiring/parts";
import { EmployeeBranchFilter } from "@/components/employees/employee-branch-filter";
import { EmployeeExport } from "@/components/employees/employee-export";
import { EmployeeSearch } from "@/components/employees/employee-search";
import { EMPLOYEE_TABS, branchFromParam, employeesHref, filtersOf, formatEmployeeSubtitle, searchFromParam, tabFromParam, type EmployeeTab } from "@/lib/employee-list-view";
import { EmployeeError, type EmployeeListRow } from "@/lib/employees";
import { formatOfferDate } from "@/lib/offer-view";
import { employeesForRequest } from "@/lib/portal/employees";
import { requireModule } from "@/lib/portal/staff";
import { cn } from "@/lib/utils";
import { EmployeeListSkeleton } from "./employee-list-skeleton";

const TITLE = "Employee information";

function EmployeeTable({ rows }: { rows: EmployeeListRow[] }) {
  return (
    <Table className="table-fixed min-w-[960px]">
      <TableHeader>
        <TableRow className="border-border-subtle hover:bg-transparent">
          <TableHead className={`${HEAD} w-[250px]`}>Employee</TableHead>
          <TableHead className={`${HEAD} w-[120px]`}>Employee ID</TableHead>
          <TableHead className={`${HEAD} w-[200px]`}>Position</TableHead>
          <TableHead className={`${HEAD} w-[140px]`}>Branch</TableHead>
          <TableHead className={`${HEAD} w-[110px]`}>Start date</TableHead>
          <TableHead className={`${HEAD} w-[150px]`}>Documents</TableHead>
          <TableHead className={HEAD}>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((employee) => (
          <TableRow key={employee.id} className="relative border-border-subtle">
            <TableCell className={CELL}><PersonCell name={employee.name} subtitle={employee.email} href={`/employee-information/${employee.id}`} /></TableCell>
            <TableCell className={`${CELL} font-medium`}>{employee.employeeNumber}</TableCell>
            <TableCell className={CELL}>
              <div className="flex flex-col gap-[2px]">
                <span>{employee.position}</span>
                {employee.department && <span className="text-xs text-muted-foreground">{employee.department}</span>}
              </div>
            </TableCell>
            <TableCell className={CELL}>{employee.branch}</TableCell>
            <TableCell className={CELL}>{formatOfferDate(employee.startDate)}</TableCell>
            <TableCell className={CELL}>
              <span className={cn("flex items-center gap-[6px] text-[13px] font-medium", employee.documentsMissing === 0 ? "text-[#15803d]" : "text-[#8a5a00]")}>
                <FileText className="size-[14px] shrink-0" aria-hidden />
                {employee.documentsLabel}
              </span>
            </TableCell>
            <TableCell className={CELL}><Badge variant={employee.status === "Onboarding" ? "info" : "success"}>{employee.status}</Badge></TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

async function Listing({ tab, branch, search }: { tab: EmployeeTab; branch?: string; search?: string }) {
  let result: Awaited<ReturnType<Awaited<ReturnType<typeof employeesForRequest>>["list"]>>;
  try {
    result = await (await employeesForRequest()).list(filtersOf({ tab, branch, search }));
  } catch (error) {
    if (!(error instanceof EmployeeError)) throw error;
    return (
      <>
        <PageHeader title={TITLE} subtitle={" "} />
        <Card className="rounded-xl shadow-none">
          <p role="alert" className="p-xl text-center text-destructive">The employee list could not be loaded. Please try again in a moment.</p>
        </Card>
      </>
    );
  }
  const { rows, counts, summary, branches } = result;
  const filtered = tab !== "All" || branch !== undefined || search !== undefined;
  const count = { All: counts.all, Active: counts.active, Onboarding: counts.onboarding };
  return (
    <>
      <PageHeader title={TITLE} subtitle={formatEmployeeSubtitle(summary)}>
        <EmployeeExport tab={tab} branch={branch} search={search} />
      </PageHeader>
      <div className="flex flex-wrap items-center gap-[12px]">
        <nav aria-label="Status" className="flex flex-1 flex-wrap gap-xs">
          {EMPLOYEE_TABS.map((name) => (
            <Link key={name} href={employeesHref({ tab: name, branch, search })} aria-current={name === tab ? "page" : undefined}
              className={cn("rounded-lg px-[14px] py-[8px] text-sm font-medium text-muted-foreground hover:text-foreground", name === tab && "bg-accent text-primary hover:text-primary")}>
              {name} {count[name]}
            </Link>
          ))}
        </nav>
        <EmployeeBranchFilter tab={tab} branch={branch} search={search} options={branches} />
        <EmployeeSearch tab={tab} branch={branch} search={search ?? ""} />
      </div>
      <Card className="flex flex-col gap-[14px] overflow-auto rounded-xl p-[20px] shadow-none">
        {rows.length === 0 ? (
          <div className="flex flex-col items-center gap-sm p-xl text-center text-muted-foreground">
            <p>{filtered ? "No employees match these filters." : "No one has been hired yet. Mark an accepted offer as hired and their employee record appears here."}</p>
            {filtered && <Button asChild variant="outline"><Link href="/employee-information">Clear filters</Link></Button>}
          </div>
        ) : (
          <EmployeeTable rows={rows} />
        )}
        <InfoNote>
          People move here automatically when they’re marked as hired in Offers. Onboarding switches to Active once their account exists
          (or no account is needed) and their start date has arrived.
        </InfoNote>
      </Card>
    </>
  );
}

export default async function Page({ searchParams }: PageProps<"/employee-information">) {
  await requireModule("Employee Information");
  const { status, branch, q } = await searchParams;
  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  return (
    <div className={PAGE}>
      <Suspense fallback={<EmployeeListSkeleton />}>
        <Listing tab={tabFromParam(first(status))} branch={branchFromParam(first(branch))} search={searchFromParam(first(q))} />
      </Suspense>
    </div>
  );
}
