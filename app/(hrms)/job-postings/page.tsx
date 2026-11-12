import Link from "next/link";
import { Suspense } from "react";
import { Bookmark } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TableSkeleton } from "@/components/shared/table-skeleton";
import { Card } from "@/components/ui/card";
import { JobPostingFilters } from "@/components/job-postings/job-posting-filters";
import {
  STATUS_BADGE,
  STATUS_LABEL,
  formatApplicants,
  formatPosted,
  formatSubtitle,
  statusCounts,
  statusFromParam,
} from "@/lib/job-posting-view";
import {
  JobPostingError,
  type JobPosting,
  type JobPostingListItem,
  type JobPostingStatus,
} from "@/lib/job-postings";
import { postingsForRequest } from "@/lib/portal/postings";
import { requireModule } from "@/lib/portal/staff";

const formatDeadline = (deadline: Date | null) =>
  deadline
    ? deadline.toLocaleDateString("en-PH", {
        dateStyle: "medium",
        timeZone: "UTC",
      })
    : "—";

const titleOf = (posting: JobPosting) => posting.title || "Untitled Draft";

function Notice({
  children,
  action,
}: {
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-sm p-xl text-center text-muted-foreground">
      {children}
      {action}
    </div>
  );
}

const HEAD = "h-auto px-0 py-[6px] text-xs font-medium text-muted-foreground";
const CELL = "px-0 py-[11px] text-sm text-foreground";

function PostingsTable({ postings }: { postings: JobPostingListItem[] }) {
  return (
    <Table className="table-fixed min-w-[900px]">
      <TableHeader>
        <TableRow className="border-border-subtle hover:bg-transparent">
          <TableHead className={`${HEAD} w-[26%]`}>Job</TableHead>
          <TableHead className={`${HEAD} w-[20%]`}>Location</TableHead>
          <TableHead className={`${HEAD} w-[10%]`}>Type</TableHead>
          <TableHead className={`${HEAD} w-[10%]`}>Applicants</TableHead>
          <TableHead className={`${HEAD} w-[11%]`}>Posted</TableHead>
          <TableHead className={`${HEAD} w-[11%]`}>Deadline</TableHead>
          <TableHead className={HEAD}>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {postings.map((posting) => (
          <TableRow key={posting.id} className="relative border-border-subtle">
            <TableCell className={CELL}>
              {/* One link per row: its ::after covers the whole row. */}
              <Link
                href={`/job-postings/${posting.id}`}
                className="font-medium text-primary after:absolute after:inset-0 hover:underline"
              >
                {titleOf(posting)}
              </Link>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {formatSubtitle(posting)}
              </p>
            </TableCell>
            <TableCell className={CELL}>{posting.location || "—"}</TableCell>
            <TableCell className={CELL}>{posting.employmentType || "—"}</TableCell>
            <TableCell className={`${CELL} ${posting.status === "draft" ? "text-muted-foreground" : ""}`}>
              {formatApplicants(posting)}
            </TableCell>
            <TableCell className={`${CELL} ${posting.firstPublishedAt ? "" : "text-muted-foreground"}`}>
              {formatPosted(posting.firstPublishedAt)}
            </TableCell>
            <TableCell className={`${CELL} ${posting.deadline ? "" : "text-muted-foreground"}`}>
              {formatDeadline(posting.deadline)}
            </TableCell>
            <TableCell className={CELL}>
              <Badge variant={STATUS_BADGE[posting.status]}>
                {STATUS_LABEL[posting.status]}
              </Badge>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function Header({ counts }: { counts?: Record<string, number> }) {
  return (
    <div className="flex items-center gap-sm">
      <div className="flex-1">
        <h1 className="text-2xl font-semibold text-foreground">Job postings</h1>
        <p className="text-sm text-muted-foreground">
          {counts
            ? `${counts[""]} ${counts[""] === 1 ? "role" : "roles"} · ${counts.open} open`
            : "\u00a0"}
        </p>
      </div>
      <Button variant="outline" className="rounded-lg px-[14px] py-[9px]" asChild>
        <Link href="/job-templates">
          <Bookmark /> Templates
        </Link>
      </Button>
      <Button className="rounded-lg px-[14px] py-[9px] font-medium shadow-none" asChild>
        <Link href="/job-postings/new">New job</Link>
      </Button>
    </div>
  );
}

async function Listing({
  status,
  search,
}: {
  status?: JobPostingStatus;
  search?: string;
}) {
  let matching: JobPostingListItem[];
  try {
    matching = await (await postingsForRequest()).list({ search });
  } catch (error) {
    if (!(error instanceof JobPostingError)) throw error;
    return (
      <>
        <Header />
        <Card className="rounded-xl shadow-none">
          <p role="alert" className="p-xl text-center text-destructive">
            Job Postings could not be loaded. Please try again in a moment.
          </p>
        </Card>
      </>
    );
  }

  // Tab counts reflect the search, so they always add up to what the table would show.
  const counts = statusCounts(matching);
  const postings = status
    ? matching.filter((posting) => posting.status === status)
    : matching;

  return (
    <>
      <Header counts={counts} />
      <JobPostingFilters counts={counts}>
        <Card className="flex flex-col gap-[14px] overflow-auto rounded-xl p-[20px] shadow-none">
          {postings.length === 0 ? (
            status || search ? (
              <Notice>
                <p>No Job Postings match your filters.</p>
              </Notice>
            ) : (
              <Notice
                action={
                  <Button asChild>
                    <Link href="/job-postings/new">Create the first Draft</Link>
                  </Button>
                }
              >
                <p>No Job Postings yet.</p>
              </Notice>
            )
          ) : (
            <PostingsTable postings={postings} />
          )}
          <p className="rounded-lg bg-muted px-[12px] py-[10px] text-xs text-muted-foreground">
            Saved templates keep the role, department, description and
            requirements. Pick one from the Job title field when you create a
            new job.
          </p>
        </Card>
      </JobPostingFilters>
    </>
  );
}

export default async function Page({
  searchParams,
}: PageProps<"/job-postings">) {
  await requireModule("Job Postings");
  const { status, q } = await searchParams;
  const one = (value: string | string[] | undefined) =>
    Array.isArray(value) ? value[0] : value;

  return (
    <div className="flex flex-col gap-[20px] px-md py-[28px] sm:px-xl">
      <Suspense
        fallback={
          <>
            <Header />
            <TableSkeleton columns={7} />
          </>
        }
      >
        <Listing
          status={statusFromParam(one(status))}
          search={one(q)?.trim() || undefined}
        />
      </Suspense>
    </div>
  );
}
