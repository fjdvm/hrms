import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { JobPostingForm } from "@/components/job-postings/job-posting-form";
import { requireModule } from "@/lib/portal/staff";
import { createTemplate } from "../actions";

export default async function Page() {
  await requireModule("Job Postings");

  return (
    <div className="flex flex-col gap-md px-md pt-[20px] sm:px-xl">
      <div className="flex flex-col gap-xs">
        <Link
          href="/job-templates"
          className="flex w-fit items-center gap-xs text-[13px] font-medium text-[#71717a] hover:text-foreground"
        >
          <ChevronLeft className="size-4" /> Job Templates
        </Link>
        <h1 className="text-2xl font-semibold text-[#18181b]">New Job Template</h1>
        <p className="text-sm text-[#71717a]">
          Save a role you post often. Nothing is required.
        </p>
      </div>
      <JobPostingForm template action={createTemplate} />
    </div>
  );
}
