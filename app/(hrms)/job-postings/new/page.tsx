import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { JobPostingForm } from "@/components/job-postings/job-posting-form";
import { JobTemplateError } from "@/lib/job-postings";
import { requireModule } from "@/lib/portal/staff";
import { templatesForRequest } from "@/lib/portal/templates";
import { createDraft } from "../actions";

export default async function Page() {
  await requireModule("Job Postings");
  // A failed lookup just leaves the picker empty; the form still works freehand.
  const templates = await (await templatesForRequest()).list().catch((error) => {
    if (!(error instanceof JobTemplateError)) throw error;
    return [];
  });

  return (
    <div className="flex flex-col gap-md px-md pt-[20px] sm:px-xl">
      <div className="flex flex-col gap-xs">
        <Link
          href="/job-postings"
          className="flex w-fit items-center gap-xs text-[13px] font-medium text-[#71717a] hover:text-foreground"
        >
          <ChevronLeft className="size-4" /> Job postings
        </Link>
        <h1 className="text-2xl font-semibold text-[#18181b]">New job posting</h1>
        <p className="text-sm text-[#71717a]">
          Published jobs appear on your careers page. Drafts stay private until
          you publish them.
        </p>
      </div>
      <JobPostingForm
        action={createDraft}
        isNew
        canSaveTemplate
        templates={templates}
      />
    </div>
  );
}
