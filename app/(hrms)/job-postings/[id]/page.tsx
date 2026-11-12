import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { STATUS_BADGE, STATUS_LABEL } from "@/lib/job-posting-view";
import { editFooter, statusActions } from "@/lib/job-posting-form";
import { PostingStatusButton } from "@/components/job-postings/posting-status-button";
import { JobPostingForm } from "@/components/job-postings/job-posting-form";
import { postingsForRequest } from "@/lib/portal/postings";
import { requireModule } from "@/lib/portal/staff";
import {
  closePosting,
  fillPosting,
  removeDraft,
  updateDraft,
  updateOpen,
} from "../actions";

const INTRO = {
  draft: "This Job Posting is a Draft, so it is still hidden from Careers.",
  open: "This Job Posting is Published and visible on Careers.",
  closed:
    "This Job Posting is Closed. It can no longer be changed or reopened.",
  filled:
    "This Job Posting is Filled. It can no longer be changed or reopened.",
} as const;

export default async function Page({
  params,
}: PageProps<"/job-postings/[id]">) {
  await requireModule("Job Postings");
  const { id } = await params;
  const posting = await (await postingsForRequest()).read(id);

  if (!posting) notFound();
  const footer = editFooter(posting.status);
  const actions = statusActions(posting.status);

  return (
    <div className="flex flex-col gap-md px-md pt-[20px] sm:px-xl">
      <div className="flex flex-wrap items-start justify-between gap-sm">
        <div>
          <Link
            href="/job-postings"
            className="flex w-fit items-center gap-xs text-[13px] font-medium text-[#71717a] hover:text-foreground"
          >
            <ChevronLeft className="size-4" /> Job postings
          </Link>
          <div className="flex items-center gap-sm">
            <h1 className="text-2xl font-semibold text-[#18181b]">
              {posting.status === "draft" ? "Edit Job Posting" : posting.title}
            </h1>
            <Badge variant={STATUS_BADGE[posting.status]}>
              {STATUS_LABEL[posting.status]}
            </Badge>
          </div>
          <p className="text-sm text-[#71717a]">
            {INTRO[posting.status]}
          </p>
        </div>
        {(actions.close || actions.fill) && (
          <div className="flex items-center gap-sm">
            {actions.fill && (
              <PostingStatusButton
                label="Mark as filled"
                title="Mark this Job Posting as filled?"
                description="Applicants will no longer see it on Careers. This cannot be undone."
                action={fillPosting.bind(null, id)}
              />
            )}
            {actions.close && (
              <PostingStatusButton
                label="Close"
                title="Close this Job Posting?"
                description="Applicants will no longer see it on Careers. This cannot be undone."
                action={closePosting.bind(null, id)}
              />
            )}
          </div>
        )}
      </div>
      <JobPostingForm
        posting={posting}
        action={
          footer.saveAsDraft
            ? updateDraft.bind(null, id)
            : footer.saveChanges
              ? updateOpen.bind(null, id)
              : undefined
        }
        deleteAction={footer.delete ? removeDraft.bind(null, id) : undefined}
        published={footer.saveChanges}
        canPublish={footer.publish}
        readOnly={!footer.saveAsDraft && !footer.saveChanges}
        canSaveTemplate={footer.saveAsDraft}
      />
    </div>
  );
}
