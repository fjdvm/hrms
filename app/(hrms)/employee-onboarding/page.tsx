import Link from "next/link";
import { Suspense } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CELL, HEAD, InfoNote, PAGE, PageHeader, PersonCell } from "@/components/hiring/parts";
import { RequestAccountDialog } from "@/components/employees/request-account-dialog";
import { NoAccountNeededButton, UndoNoAccountNeededButton } from "@/components/employees/no-account-needed-buttons";
import { OnboardingLive } from "@/components/employees/onboarding-live";
import { OnboardingSearch } from "@/components/employees/onboarding-search";
import { EmployeeError, type OnboardingRow } from "@/lib/employees";
import { formatOfferDate } from "@/lib/offer-view";
import { ONBOARDING_TABS, accountNote, formatOnboardingSubtitle, onboardingFiltersOf, onboardingHref, onboardingSearchFromParam, onboardingTabFromParam, type OnboardingTab } from "@/lib/onboarding-view";
import { employeesForRequest } from "@/lib/portal/employees";
import { requireModule } from "@/lib/portal/staff";
import { cn } from "@/lib/utils";
import { OnboardingSkeleton } from "./onboarding-skeleton";

const TITLE = "Onboarding";
const BADGE = { "Not requested": "secondary", Requested: "warning", "Account created": "success", "No account needed": "secondary" } as const;
const BUTTON = "h-auto rounded-lg px-[12px] py-[6px] text-[13px]";

/** Buttons are rendered where the read model offers the action. "View request" waits for the request detail panel. */
function Actions({ row }: { row: OnboardingRow }) {
  const has = (action: OnboardingRow["actions"][number]) => row.actions.includes(action);
  return (
    <div className="flex flex-wrap justify-end gap-[8px]">
      {has("no-account-needed") && <NoAccountNeededButton employee={row} />}
      {has("request") && <RequestAccountDialog employee={row} />}
      {(has("remind") || has("cancel")) && <Button type="button" variant="outline" size="sm" className={BUTTON}>View request</Button>}
      {has("undo-no-account-needed") && <UndoNoAccountNeededButton employee={row} />}
    </div>
  );
}

function NewHireTable({ rows, canAct }: { rows: OnboardingRow[]; canAct: boolean }) {
  return (
    <Table className="table-fixed min-w-[1040px]">
      <TableHeader>
        <TableRow className="border-border-subtle hover:bg-transparent">
          <TableHead className={`${HEAD} w-[240px]`}>New hire</TableHead>
          <TableHead className={`${HEAD} w-[190px]`}>Position</TableHead>
          <TableHead className={`${HEAD} w-[130px]`}>Start date</TableHead>
          <TableHead className={`${HEAD} w-[230px]`}>Work email</TableHead>
          <TableHead className={`${HEAD} w-[220px]`}>User account</TableHead>
          <TableHead className={cn(HEAD, "text-right")}>{canAct ? "Action" : ""}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id} className="border-border-subtle">
            <TableCell className={CELL}><PersonCell name={row.name} subtitle={row.employeeNumber} /></TableCell>
            <TableCell className={CELL}>
              <div className="flex flex-col gap-[2px]">
                <span>{row.position}</span>
                <span className="text-xs text-muted-foreground">{row.branch}</span>
              </div>
            </TableCell>
            <TableCell className={CELL}>
              <div className="flex flex-col gap-[2px]">
                <span>{formatOfferDate(row.startDate)}</span>
                {row.overdue && <span className="text-[11px] font-medium text-[#8a5a00]">Start date has passed</span>}
              </div>
            </TableCell>
            <TableCell className={cn(CELL, "break-all text-[13px]")}>{row.workEmail}</TableCell>
            <TableCell className={CELL}>
              <div className="flex flex-col items-start gap-[4px]">
                <Badge variant={BADGE[row.accountState]}>{row.accountState}</Badge>
                <span className="text-[11px] text-muted-foreground">{accountNote(row)}</span>
              </div>
            </TableCell>
            <TableCell className={CELL}><Actions row={row} /></TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function SummaryCard({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="flex flex-col gap-[4px] rounded-xl border border-border bg-white px-[20px] py-[16px]">
      <p className="text-[13px] font-medium text-muted-foreground">{label}</p>
      <p className={cn("text-[26px] font-bold", tone)}>{value}</p>
    </div>
  );
}

async function Listing({ tab, search }: { tab: OnboardingTab; search?: string }) {
  let result: Awaited<ReturnType<Awaited<ReturnType<typeof employeesForRequest>>["onboarding"]>>;
  try {
    result = await (await employeesForRequest()).onboarding(onboardingFiltersOf({ tab, search }));
  } catch (error) {
    if (!(error instanceof EmployeeError)) throw error;
    return (
      <>
        <PageHeader title={TITLE} subtitle={" "} />
        <Card className="rounded-xl shadow-none">
          <p role="alert" className="p-xl text-center text-destructive">The new hires could not be loaded. Please try again in a moment.</p>
        </Card>
      </>
    );
  }
  const { rows, counts, summary, canAct } = result;
  const count: Record<OnboardingTab, number> = { All: counts.all, "Needs account": counts.needsAccount, Requested: counts.requested, "Account created": counts.accountCreated, "No account needed": counts.noAccountNeeded };
  const filtered = tab !== "All" || search !== undefined;
  return (
    <>
      <PageHeader title={TITLE} subtitle={formatOnboardingSubtitle({ hires: counts.all, needsAccount: summary.needsAccount })} />
      <div className="grid gap-[16px] sm:grid-cols-3">
        <SummaryCard label="Needs account" value={summary.needsAccount} tone="text-[#8a5a00]" />
        <SummaryCard label="Requested, waiting for admin" value={summary.requested} tone="text-[#1d4f91]" />
        <SummaryCard label="Account created" value={summary.accountCreated} tone="text-[#15803d]" />
      </div>
      <div className="flex flex-wrap items-center gap-[12px]">
        <nav aria-label="Account state" className="flex flex-1 flex-wrap gap-xs">
          {ONBOARDING_TABS.map((name) => (
            <Link key={name} href={onboardingHref({ tab: name, search })} aria-current={name === tab ? "page" : undefined}
              className={cn("rounded-lg px-[14px] py-[8px] text-sm font-medium text-muted-foreground hover:text-foreground", name === tab && "bg-accent text-primary hover:text-primary")}>
              {name} {count[name]}
            </Link>
          ))}
        </nav>
        <OnboardingSearch tab={tab} search={search ?? ""} />
      </div>
      <Card className="flex flex-col gap-[14px] overflow-auto rounded-xl p-[20px] shadow-none">
        {rows.length === 0 ? (
          <div className="flex flex-col items-center gap-sm p-xl text-center text-muted-foreground">
            <p>{filtered ? "No new hires match these filters." : "No one is onboarding right now. People marked as hired in Offers appear here until they are Active."}</p>
            {filtered && <Button asChild variant="outline"><Link href="/employee-onboarding">Clear filters</Link></Button>}
          </div>
        ) : (
          <NewHireTable rows={rows} canAct={canAct} />
        )}
        <InfoNote>
          “Request user account” sends the new hire’s details to the admin portal. The admin creates the account and the login details are emailed to the employee.
          Once their account exists (or no account is needed) and their start date has arrived, they become Active on their own.
        </InfoNote>
      </Card>
    </>
  );
}

export default async function Page({ searchParams }: PageProps<"/employee-onboarding">) {
  await requireModule("Employee Onboarding");
  const { status, q } = await searchParams;
  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  return (
    <div className={PAGE}>
      <OnboardingLive />
      <Suspense fallback={<OnboardingSkeleton />}>
        <Listing tab={onboardingTabFromParam(first(status))} search={onboardingSearchFromParam(first(q))} />
      </Suspense>
    </div>
  );
}
