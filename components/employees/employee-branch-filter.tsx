"use client";

import { useRouter } from "next/navigation";
import { Check, ChevronDown } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { employeesHref, type EmployeeTab } from "@/lib/employee-list-view";

/** Branch lives in the URL beside the tab and search; choosing one keeps both. */
export function EmployeeBranchFilter({ tab, branch, search, options }: { tab: EmployeeTab; branch?: string; search?: string; options: string[] }) {
  const router = useRouter();
  const choose = (next?: string) => router.push(employeesHref({ tab, branch: next, search }));
  const choices: [label: string, value?: string][] = [["All branches"], ...options.map((option): [string, string] => [option, option])];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label="Filter by branch" className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-[9px] text-sm data-[state=open]:border-[#8b5cf6]">
        <span className="text-zinc-500">Branch:</span>
        <span className="max-w-[10rem] truncate font-medium text-zinc-900">{branch ?? "All branches"}</span>
        <ChevronDown className="size-4 shrink-0 text-zinc-500" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[220px] gap-[2px] rounded-[10px] border-[#e4e4e7] p-[6px]">
        {choices.map(([label, value]) => (
          <DropdownMenuItem key={label} onSelect={() => choose(value)} aria-current={value === branch ? "true" : undefined}
            className={cn("gap-[10px] rounded-[6px] px-[10px] py-[9px] text-sm", value === branch && "bg-[#f4f4f5] font-medium")}>
            <span className="truncate">{label}</span>
            <Check className={value === branch ? "ml-auto size-4 text-primary" : "ml-auto size-4 opacity-0"} />
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
