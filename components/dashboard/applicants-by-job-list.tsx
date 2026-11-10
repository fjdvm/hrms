import type { ApplicantsByJobData } from "@/lib/dashboard";

export function ApplicantsByJobList({ data }: { data: ApplicantsByJobData }) {
  return (
    <>
      <p className="mb-md text-body-sm text-muted-foreground">{data.headline}</p>
      <ul className="flex min-h-0 flex-1 flex-col gap-md overflow-y-auto">
        {data.rows.map((row) => (
          <li key={row.id} className="flex flex-col gap-xs">
            <div className="flex items-baseline justify-between gap-md">
              <p className="text-label-md min-w-0 truncate">{row.title}</p>
              <p className="text-body-sm shrink-0 text-muted-foreground">
                {row.count} · {row.percent}%
              </p>
            </div>
            <div className="h-2 rounded-full bg-muted" role="presentation">
              <div className="h-full rounded-full bg-primary" style={{ width: `${row.bar}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
