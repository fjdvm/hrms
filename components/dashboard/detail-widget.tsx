import { ApplicantsByJobList } from "@/components/dashboard/applicants-by-job-list";
import { DepartmentDonut } from "@/components/dashboard/department-donut";
import { HiringPipelineBars } from "@/components/dashboard/hiring-pipeline-bars";
import { HeadcountTrendChart } from "@/components/dashboard/headcount-trend-chart";
import { NeedsAttentionList } from "@/components/dashboard/needs-attention-list";
import { RecentActivityList } from "@/components/dashboard/recent-activity-list";
import { UpcomingInterviewsList } from "@/components/dashboard/upcoming-interviews-list";
import { UpcomingEventsList } from "@/components/dashboard/upcoming-events-list";
import { DetailWidgetCard } from "@/components/dashboard/detail-widget-card";
import type { DetailWidget as DetailWidgetData } from "@/lib/dashboard";

export function DetailWidget({ stretch, ...widget }: DetailWidgetData & { stretch?: boolean }) {
  return (
    <DetailWidgetCard title={widget.label} empty={widget.data === null} stretch={stretch}>
      {widget.id === "headcount-trend" && widget.data && (
        <HeadcountTrendChart points={widget.data} />
      )}
      {widget.id === "department-distribution" && widget.data && (
        <DepartmentDonut slices={widget.data} />
      )}
      {widget.id === "recent-activity" && widget.data && (
        <RecentActivityList items={widget.data} />
      )}
      {widget.id === "upcoming-events" && widget.data && (
        <UpcomingEventsList items={widget.data} />
      )}
      {widget.id === "hiring-pipeline" && widget.data && (
        <HiringPipelineBars data={widget.data} />
      )}
      {widget.id === "needs-attention" && widget.data && (
        <NeedsAttentionList data={widget.data} />
      )}
      {widget.id === "applicants-by-job" && widget.data && (
        <ApplicantsByJobList data={widget.data} />
      )}
      {widget.id === "upcoming-interviews" && widget.data && (
        <UpcomingInterviewsList data={widget.data} />
      )}
    </DetailWidgetCard>
  );
}
