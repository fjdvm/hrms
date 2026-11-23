"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import type { LinkCandidate } from "@/lib/performance-links";
import { candidateLine, candidateMatches, candidateTag } from "@/lib/performance-pos-links-terms";
import { cn } from "@/lib/utils";

const SHOWN = 8;

/**
 * The Link cashier employee picker: a search by name or employee number over every Employee. One who is not a cashier is listed but cannot be chosen, with
 * "Not a cashier position"; one who already holds an account carries "Has N POS accounts" (and the form then asks for the reason).
 */
export function EmployeePicker({ candidates, selected, onSelect, disabled }: { candidates: LinkCandidate[]; selected: LinkCandidate | null; onSelect: (candidate: LinkCandidate) => void; disabled?: boolean }) {
  const [query, setQuery] = useState("");
  const results = candidates.filter((candidate) => candidateMatches(candidate, query));
  return (
    <div className="flex flex-col gap-[6px]">
      <label htmlFor="link-employee" className="text-[13px] font-medium text-zinc-800">Employee <span className="text-red-600" aria-hidden>*</span></label>
      <div className="relative">
        <Search aria-hidden className="absolute left-[12px] top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
        <input id="link-employee" type="search" value={query} disabled={disabled} placeholder="Search by name or employee number" autoComplete="off" onChange={(event) => setQuery(event.target.value)}
          className="h-[40px] w-full rounded-lg border border-[#e4e4e7] bg-white pl-[36px] pr-[12px] text-sm outline-none focus:border-[#5b2a86]" />
      </div>
      <ul role="listbox" aria-label="Employees" className="flex max-h-[220px] flex-col overflow-y-auto rounded-lg border border-[#e6e1ee] bg-white">
        {results.length === 0 && <li className="px-[12px] py-[9px] text-sm text-[#6e6680]">No employees match your search.</li>}
        {results.slice(0, SHOWN).map((candidate) => {
          const tag = candidateTag(candidate);
          const on = selected?.employeeId === candidate.employeeId;
          return (
            <li key={candidate.employeeId} role="option" aria-selected={on} aria-disabled={!candidate.isCashier || undefined} className="border-b border-[#efebf4] last:border-b-0">
              <button type="button" disabled={!candidate.isCashier || disabled} onClick={() => onSelect(candidate)}
                className={cn("flex w-full items-center gap-[8px] px-[12px] py-[9px] text-left", on && "bg-[#efe6f8]", candidate.isCashier ? "hover:bg-[#f7f5fa]" : "cursor-not-allowed opacity-50")}>
                <span className="flex min-w-0 flex-1 flex-col gap-px"><span className="text-sm font-medium text-[#1f1a2e]">{candidate.name}</span><span className="text-xs text-[#6e6680]">{candidateLine(candidate)}</span></span>
                {tag && <span className={cn("shrink-0 rounded-full px-[8px] py-[3px] text-[11px] font-semibold", candidate.isCashier ? "bg-[#efe6f8] text-[#5b2a86]" : "bg-[#efebf4] text-[#6e6680]")}>{tag}</span>}
              </button>
            </li>
          );
        })}
      </ul>
      {results.length > SHOWN && <p className="text-xs text-[#6e6680]">Showing {SHOWN} of {results.length}. Type more to narrow the list.</p>}
    </div>
  );
}
