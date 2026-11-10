import { MapPin, Video } from "lucide-react";
import type { UpcomingInterviewsData } from "@/lib/dashboard";

export function UpcomingInterviewsList({ data }: { data: UpcomingInterviewsData }) {
  return (
    <>
      <p className="mb-md text-body-sm text-muted-foreground">{data.headline}</p>
      <ul className="flex min-h-0 flex-1 flex-col gap-md overflow-y-auto">
        {data.items.map((item) => {
          const Icon = item.type === "Online" ? Video : MapPin;
          return (
            <li key={item.id} className="flex items-start gap-md">
              <div className="min-w-0 flex-1">
                <p className="text-label-md truncate">{item.applicantName}</p>
                <p className="text-body-sm truncate text-muted-foreground">{item.jobPostingTitle}</p>
                <p className="text-body-sm text-muted-foreground">{item.when}</p>
              </div>
              <Icon className="size-4 shrink-0 text-muted-foreground" aria-label={item.type} />
            </li>
          );
        })}
      </ul>
    </>
  );
}
