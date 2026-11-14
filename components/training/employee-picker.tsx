"use client";

import { useRouter } from "next/navigation";
import { ChevronDown, Search } from "lucide-react";

/** Chooses whose history to show. A navigation, so the page stays a server page and nothing polls. */
export function EmployeePicker({ employees, selected }: { employees: { id: number; name: string; employeeNumber: string }[]; selected: number | null }) {
  const router = useRouter();
  return (
    <label className="flex items-center gap-[8px] rounded-lg border border-[#e6e1ee] bg-white px-[12px] py-[8px] text-sm focus-within:border-[#8b5cf6]">
      <Search className="size-4 text-zinc-500" aria-hidden />
      <span className="text-muted-foreground">Employee:</span>
      <select
        aria-label="Employee"
        value={selected ?? ""}
        onChange={(event) => router.push(event.target.value ? `/training/history?employee=${event.target.value}` : "/training/history")}
        className="min-w-[140px] appearance-none bg-transparent font-medium text-foreground outline-none"
      >
        <option value="">Choose an employee</option>
        {employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name} · {employee.employeeNumber}</option>)}
      </select>
      <ChevronDown className="size-4 text-zinc-500" aria-hidden />
    </label>
  );
}
