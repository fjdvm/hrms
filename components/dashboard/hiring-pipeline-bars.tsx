import type { HiringPipelineData } from "@/lib/dashboard";

export function HiringPipelineBars({ data }: { data: HiringPipelineData }) {
  return (
    <>
      <p className="mb-md text-body-sm text-muted-foreground">{data.headline}</p>
      <ul className="flex min-h-0 flex-1 flex-col gap-md overflow-y-auto">
        {data.bars.map((bar) => (
          <li key={bar.stage} className="flex flex-col gap-xs">
            <div className="flex items-baseline justify-between gap-md">
              <p className="text-label-md min-w-0 truncate">{bar.stage}</p>
              <p className="text-body-sm shrink-0 text-muted-foreground">
                {bar.count} · {bar.percent}%
              </p>
            </div>
            <div className="h-2 rounded-full bg-muted" role="presentation">
              <div className="h-full rounded-full bg-primary" style={{ width: `${bar.percent}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
