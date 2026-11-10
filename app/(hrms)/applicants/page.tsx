import Link from "next/link";
import { Suspense } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { AddApplicant } from "@/components/hiring/add-applicant";
import { ApplicantExport } from "@/components/hiring/applicant-export";
import { ApplicantJobFilter } from "@/components/hiring/applicant-job-filter";
import { ApplicantSearch } from "@/components/hiring/applicant-search";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableSkeleton } from "@/components/shared/table-skeleton";
import { CELL, HEAD, PAGE, PageHeader, PersonCell } from "@/components/hiring/parts";
import { ApplicationError, type ApplicationListItem, type ApplicationPage, type ApplicationTab } from "@/lib/applications";
import { STAGE_BADGE, STAGE_TABS, applicantsHref, formatApplied, formatRange, formatShowing, formatSubtitle, jobFromParam, pageCount, pageFromParam, searchFromParam, stageFromParam } from "@/lib/application-view";
import { applicationsForRequest } from "@/lib/portal/applications";
import { requireModule } from "@/lib/portal/staff";

const TITLE = "Applicants";

function Notice({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-sm p-xl text-center text-muted-foreground">
      {children}
      {action}
    </div>
  );
}

function ApplicantsTable({ rows }: { rows: ApplicationListItem[] }) {
  return (
    <Table className="table-fixed min-w-[900px]">
      <TableHeader>
        <TableRow className="border-border-subtle hover:bg-transparent">
          <TableHead className={`${HEAD} w-[27%]`}>Applicant</TableHead>
          <TableHead className={`${HEAD} w-[22%]`}>Applied for</TableHead>
          <TableHead className={`${HEAD} w-[11%]`}>Source</TableHead>
          <TableHead className={`${HEAD} w-[12%]`}>Applied</TableHead>
          <TableHead className={`${HEAD} w-[13%]`}>Stage</TableHead>
          <TableHead className={HEAD}>Next step</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id} className="relative border-border-subtle">
            <TableCell className={CELL}>
              <PersonCell name={row.applicantName} subtitle={row.applicantEmail} href={`/applicants/${row.id}`} />
            </TableCell>
            <TableCell className={CELL}>
              <p>{row.jobPostingTitle}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{row.location}</p>
            </TableCell>
            <TableCell className={CELL}>{row.source}</TableCell>
            <TableCell className={CELL}>{formatApplied(row.appliedAt)}</TableCell>
            <TableCell className={CELL}>
              <Badge variant={STAGE_BADGE[row.stage]}>{row.stage}</Badge>
            </TableCell>
            <TableCell className={`${CELL} ${row.stage === "New" || row.stage === "Rejected" ? "text-muted-foreground" : ""}`}>
              {row.nextStep}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function Pager({ result, stage, search, job }: { result: ApplicationPage; stage: ApplicationTab; search?: string; job?: string }) {
  const { page, pageSize, total, rows } = result;
  const last = pageCount(total, pageSize);
  const href = (target: number) => applicantsHref({ stage, search, job, page: target });
  return (
    <nav aria-label="Pagination" className="flex items-center justify-between pt-2">
      <p className="text-sm text-muted-foreground">{formatRange(page, pageSize, total, rows.length)}</p>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" aria-label="Previous page" disabled={page <= 1} asChild={page > 1}>
          {page > 1 ? <Link href={href(page - 1)}><ChevronLeft className="size-4" /></Link> : <ChevronLeft className="size-4" />}
        </Button>
        <span className="text-sm font-medium">{page} / {last}</span>
        <Button variant="outline" size="sm" aria-label="Next page" disabled={page >= last} asChild={page < last}>
          {page < last ? <Link href={href(page + 1)}><ChevronRight className="size-4" /></Link> : <ChevronRight className="size-4" />}
        </Button>
      </div>
    </nav>
  );
}

async function Listing({ page, stage, search, job }: { page: number; stage: ApplicationTab; search?: string; job?: string }) {
  let result: ApplicationPage;
  try {
    result = await (await applicationsForRequest()).list({ page, stage, search, jobPostingId: job });
  } catch (error) {
    if (!(error instanceof ApplicationError)) throw error;
    return (
      <>
        <PageHeader title={TITLE} subtitle={" "} />
        <Card className="rounded-xl shadow-none">
          <p role="alert" className="p-xl text-center text-destructive">
            Applicants could not be loaded. Please try again in a moment.
          </p>
        </Card>
      </>
    );
  }

  const { rows, total, newThisWeek, stageCounts, jobPostingOptions } = result;
  const filtered = stage !== "All" || search !== undefined || job !== undefined;
  return (
    <>
      <PageHeader title={TITLE} subtitle={formatSubtitle(stageCounts.All, newThisWeek)}>
        <ApplicantExport stage={stage} search={search} job={job} />
        <AddApplicant jobs={jobPostingOptions} />
      </PageHeader>
      <nav aria-label="Stage" className="flex flex-wrap gap-xs">
        {STAGE_TABS.map((tab) => (
          <Link
            key={tab}
            href={applicantsHref({ stage: tab, search, job })}
            aria-current={tab === stage ? "page" : undefined}
            className={cn(
              "rounded-lg px-[14px] py-[8px] text-sm font-medium text-muted-foreground hover:text-foreground",
              tab === stage && "bg-accent text-primary hover:text-primary",
            )}
          >
            {tab} {stageCounts[tab]}
          </Link>
        ))}
      </nav>
      <div className="flex flex-wrap items-center gap-sm">
        <ApplicantJobFilter stage={stage} search={search} job={job} options={jobPostingOptions} allCount={job === undefined ? stageCounts.All : undefined} />
        <ApplicantSearch stage={stage} search={search ?? ""} job={job} />
        <p className="ml-auto text-xs text-muted-foreground">{formatShowing(total)}</p>
      </div>
      <Card className="flex flex-col gap-[14px] overflow-auto rounded-xl p-[20px] shadow-none">
        {total === 0 ? (
          <Notice>
            <p>{filtered ? "No applicants match these filters." : "No applicants yet."}</p>
          </Notice>
        ) : rows.length === 0 ? (
          <Notice action={<Button asChild><Link href={applicantsHref({ stage, search, job })}>Back to the first page</Link></Button>}>
            <p>There are no applicants on this page.</p>
          </Notice>
        ) : (
          <ApplicantsTable rows={rows} />
        )}
        {total > 0 && <Pager result={result} stage={stage} search={search} job={job} />}
      </Card>
    </>
  );
}

export default async function Page({ searchParams }: PageProps<"/applicants">) {
  await requireModule("Recruitment and Hiring");
  const { page, stage, q, job } = await searchParams;
  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

  return (
    <div className={PAGE}>
      <Suspense
        fallback={
          <>
            <PageHeader title={TITLE} subtitle={" "} />
            <TableSkeleton columns={6} showToolbar={false} />
          </>
        }
      >
        <Listing page={pageFromParam(first(page))} stage={stageFromParam(first(stage))} search={searchFromParam(first(q))} job={jobFromParam(first(job))} />
      </Suspense>
    </div>
  );
}
