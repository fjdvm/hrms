import { FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { CardTitle } from "@/components/hiring/parts";
import { isDocumentOverdue, type DocumentStatus } from "@/lib/offer-documents";
import { formatShortDate } from "@/lib/offer-view";
import type { OfferChecklist } from "@/lib/offers";
import { cn } from "@/lib/utils";

const BADGE = { Submitted: "success", Requested: "info", "Not requested": "secondary" } as const satisfies Record<DocumentStatus, string>;

/** The seven Pre-employment Documents: what is Submitted, what was Requested (and whether it is overdue) and what was not asked yet. */
export function OfferDocuments({ checklist, today }: { checklist: OfferChecklist; today: string }) {
  const { items, submitted, total } = checklist;
  const complete = submitted === total;
  return (
    <Card className="flex flex-col gap-[14px] rounded-xl px-[20px] py-[18px] shadow-none">
      <CardTitle aside={<span className={cn("text-sm font-medium", complete ? "text-badge-success-foreground" : "text-zinc-500")}>{submitted} of {total} submitted</span>}>Pre-employment documents</CardTitle>
      <div role="progressbar" aria-label="Documents submitted" aria-valuemin={0} aria-valuemax={total} aria-valuenow={submitted} className="h-[6px] overflow-hidden rounded-full bg-zinc-100">
        <div className={cn("h-full rounded-full", complete ? "bg-badge-success-foreground" : "bg-primary")} style={{ width: `${(submitted / total) * 100}%` }} />
      </div>
      <ul aria-label="Pre-employment documents" className="flex flex-col">
        {items.map((item) => {
          const overdue = isDocumentOverdue(item.status, item.dueDate, today);
          const detail = item.status === "Submitted" ? (item.source === "application" ? "From application" : "Uploaded")
            : item.status === "Requested" ? (item.dueDate ? `Due ${formatShortDate(item.dueDate)}` : "Requested") : item.hint;
          return (
            <li key={item.type} className="flex items-center gap-[12px] border-b border-border-subtle py-[10px] last:border-b-0">
              <FileText aria-hidden className="size-[18px] shrink-0 text-zinc-500" />
              <div className="flex min-w-0 flex-1 flex-col gap-px">
                {item.file?.downloadUrl
                  ? <a href={item.file.downloadUrl} target="_blank" rel="noreferrer" className="w-fit text-sm font-medium text-primary hover:underline">{item.label}</a>
                  : <span className="text-sm font-medium text-zinc-900">{item.label}</span>}
                <span className="text-xs text-zinc-500">{detail}{overdue && <span className="font-medium text-destructive"> · overdue</span>}</span>
              </div>
              <Badge variant={BADGE[item.status]}>{item.status}</Badge>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
