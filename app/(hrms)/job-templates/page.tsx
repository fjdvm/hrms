import Link from "next/link";
import { Suspense } from "react";
import { DeleteTemplateButton } from "@/components/job-postings/delete-template-button";
import { TableSkeleton } from "@/components/shared/table-skeleton";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { JobTemplateError } from "@/lib/job-postings";
import { requireModule } from "@/lib/portal/staff";
import { templatesForRequest } from "@/lib/portal/templates";
import { removeTemplate } from "./actions";

async function Listing() {
  let templates;
  try {
    templates = await (await templatesForRequest()).list();
  } catch (error) {
    if (!(error instanceof JobTemplateError)) throw error;
    return (
      <Card>
        <p role="alert" className="p-xl text-center text-destructive">
          Job Templates could not be loaded. Please try again in a moment.
        </p>
      </Card>
    );
  }

  if (templates.length === 0) {
    return (
      <Card className="p-md">
        <div className="flex flex-col items-center gap-sm p-xl text-center text-muted-foreground">
          <p>No Job Templates yet.</p>
          <Button asChild>
            <Link href="/job-templates/new">Create the first template</Link>
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card className="overflow-auto p-md">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Title</TableHead>
            <TableHead>Department</TableHead>
            <TableHead>Employment type</TableHead>
            <TableHead className="w-0" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {templates.map((template) => (
            <TableRow key={template.id}>
              <TableCell className="font-medium text-primary">
                <Link
                  href={`/job-templates/${template.id}`}
                  className="hover:underline"
                >
                  {template.title || "Untitled template"}
                </Link>
              </TableCell>
              <TableCell>{template.department || "—"}</TableCell>
              <TableCell>{template.employmentType || "—"}</TableCell>
              <TableCell className="flex items-center gap-xs">
                <DeleteTemplateButton
                  compact
                  title={template.title || "Untitled template"}
                  action={removeTemplate.bind(null, template.id)}
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

export default async function Page() {
  await requireModule("Job Postings");

  return (
    <div className="flex flex-col gap-lg p-md sm:p-lg">
      <div className="flex items-start justify-between gap-md">
        <div>
          <h1 className="text-headline-md">Job Templates</h1>
          <p className="text-body-sm text-muted-foreground">
            Saved roles you can start a Job Posting from. Templates are only
            created when you save them.
          </p>
        </div>
        <Button asChild>
          <Link href="/job-templates/new">New Job Template</Link>
        </Button>
      </div>
      <Suspense fallback={<TableSkeleton columns={3} />}>
        <Listing />
      </Suspense>
    </div>
  );
}
