import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { DeleteTemplateButton } from "@/components/job-postings/delete-template-button";
import { JobPostingForm } from "@/components/job-postings/job-posting-form";
import { requireModule } from "@/lib/portal/staff";
import { templatesForRequest } from "@/lib/portal/templates";
import { removeTemplate, updateTemplate } from "../actions";

export default async function Page({
  params,
}: PageProps<"/job-templates/[id]">) {
  await requireModule("Job Postings");
  const { id } = await params;
  const template = (await (await templatesForRequest()).list()).find(
    (t) => t.id === id,
  );

  if (!template) notFound();

  return (
    <div className="flex flex-col gap-md p-md sm:p-lg">
      <div>
        <Link
          href="/job-templates"
          className="flex items-center gap-xs text-body-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" /> Job Templates
        </Link>
        <h1 className="text-headline-md">Edit Job Template</h1>
        <p className="text-body-sm text-muted-foreground">
          Changes apply to future postings only.
        </p>
      </div>
      <JobPostingForm
        template
        posting={template}
        action={updateTemplate.bind(null, id)}
        templateActions={
          <DeleteTemplateButton
            action={removeTemplate.bind(null, id)}
            title={template.title}
          />
        }
      />
    </div>
  );
}
