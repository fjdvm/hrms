import Link from "next/link";
import { Calendar, LayoutGrid } from "lucide-react";
import type { InterviewsView } from "@/lib/calendar-view";
import { cn } from "@/lib/utils";

/** The By job | Calendar switch shared by both Interviews screens. */
export function InterviewsViewSwitch({ current }: { current: InterviewsView }) {
  const item = (view: InterviewsView, href: string, label: string, Icon: typeof Calendar) => (
    <Link
      href={href}
      aria-current={current === view ? "page" : undefined}
      className={cn("flex items-center gap-[6px] rounded-md px-[12px] py-[6px] text-sm font-medium text-zinc-500", current === view && "bg-white text-foreground shadow-sm")}
    >
      <Icon className="size-[14px]" /> {label}
    </Link>
  );
  return (
    <nav aria-label="Interviews view" className="flex gap-[2px] rounded-lg bg-zinc-100 p-[3px]">
      {item("by-job", "/interviews", "By job", LayoutGrid)}
      {item("calendar", "/interviews?view=calendar", "Calendar", Calendar)}
    </nav>
  );
}
