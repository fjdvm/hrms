import { CalendarPlus, ClipboardCheck, FileSearch, FileWarning, Hourglass, type LucideIcon } from "lucide-react";
import Link from "next/link";
import type { NeedsAttentionData, NeedsAttentionRow } from "@/lib/dashboard";

const ICON: Record<NeedsAttentionRow["id"], LucideIcon> = {
  review: FileSearch,
  schedule: CalendarPlus,
  results: ClipboardCheck,
  offers: Hourglass,
  documents: FileWarning,
};

export function NeedsAttentionList({ data }: { data: NeedsAttentionData }) {
  return (
    <>
      <p className="mb-md text-body-sm text-muted-foreground">{data.headline}</p>
      <ul className="flex min-h-0 flex-1 flex-col gap-md overflow-y-auto">
        {data.rows.map((row) => {
          const Icon = ICON[row.id];
          return (
            <li key={row.id}>
              <Link
                href={row.href}
                className={`flex items-center gap-md rounded-lg ${row.muted ? "text-muted-foreground" : ""}`}
              >
                <Icon className="size-4 shrink-0" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-label-md truncate">{row.title}</p>
                  {row.detail && <p className="text-body-sm truncate text-muted-foreground">{row.detail}</p>}
                </div>
                <p className="text-label-md shrink-0">{row.count}</p>
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}
