"use client";

import { useState } from "react";
import Link from "next/link";
import { BarChart3, Search, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CELL, HEAD, InfoNote } from "@/components/hiring/parts";
import { EVALUATION_TABS, type EvaluationTab } from "@/lib/performance-evaluations-terms";
import type { Roster } from "@/lib/performance-evaluations";
import { evaluationHref, importText, inTab, matchesSearch, notScoredText, profileHref, scoreText, shiftText, statusBadge } from "@/lib/performance-list";
import { cn } from "@/lib/utils";
import { SetUpPeriodDialog, type SetUpPeriodData } from "./set-up-period-dialog";

const NOTE = "Any Staff member who holds Performance can rate, submit or reopen an evaluation. An employee with no shift is not scored until HR sets one. Attendance records are used only to compute scores, not shown as an attendance record.";
const EMPTY_NOTE = "Attendance records are used only to compute scores, not shown as an attendance record.";
const SUMMARY = "Employees whose evaluation is submitted and locked, out of everyone listed this period. Scores use the attendance import, Training completion and the evaluator’s rating.";

function Progress({ roster }: { roster: Roster }) {
  const { progress, notScored, period } = roster;
  const empty = progress.total === 0;
  return (
    <Card className="flex flex-wrap items-center gap-lg rounded-xl p-[20px] shadow-none">
      <div className="flex w-[300px] max-w-full flex-col gap-[6px]">
        <p className="text-[13px] font-medium text-muted-foreground">Evaluation progress · {period.name}</p>
        {empty ? <p className="text-lg font-semibold text-muted-foreground">Nothing to show yet</p> : (
          <>
            <p className="flex items-end gap-[10px]">
              <span className="text-[28px] font-bold leading-none text-foreground" data-testid="progress-percent">{progress.percent}%</span>
              <span className="text-[13px] font-medium text-muted-foreground">{progress.evaluated} of {progress.total} evaluated</span>
            </p>
            <div role="progressbar" aria-label="Evaluated" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent} className="h-[6px] w-full rounded bg-[#f1edf6]">
              <div className="h-full rounded bg-[#5b2a86]" style={{ width: `${progress.percent}%` }} />
            </div>
          </>
        )}
      </div>
      <div className="flex min-w-[240px] flex-1 flex-col gap-[4px] border-l border-[#efebf4] pl-lg">
        <p className="text-xs text-muted-foreground">{SUMMARY}</p>
        {empty && <p className="text-xs text-zinc-400">It fills in once an evaluation is submitted this month.</p>}
        {notScored.length > 0 && (
          <p className="flex flex-wrap items-center gap-[6px] text-xs font-medium text-[#8a5a00]" data-testid="not-scored">
            <TriangleAlert aria-hidden className="size-[14px]" />
            {notScoredText(notScored)}
            {notScored.slice(0, 3).map((person) => (
              <Link key={person.employeeId} href={profileHref(person.employeeId)} aria-label={`Set shift for ${person.name}`} className="font-semibold text-primary hover:underline">Set shift</Link>
            ))}
          </p>
        )}
      </div>
    </Card>
  );
}

function Empty({ roster, setup }: { roster: Roster; setup: SetUpPeriodData }) {
  return (
    <div className="flex flex-col items-center gap-sm p-xl text-center">
      <div className="flex size-[40px] items-center justify-center rounded-full bg-[#efe6f8]"><BarChart3 aria-hidden className="size-[18px] text-[#5b2a86]" /></div>
      <p className="text-base font-semibold text-foreground">No evaluations in {roster.period.name} yet</p>
      <p className="max-w-[460px] text-[13px] text-muted-foreground">Set up the period, import attendance and set each employee’s shift. Employees then appear here to be scored.</p>
      <SetUpPeriodDialog {...setup} trigger="plus" />
    </div>
  );
}

/**
 * The Performance list for one period: the progress card with the warning for anyone not scored, the tabs All, Draft, In review and
 * Evaluated with their counts, a search by name or employee number, and one row per Employee. Everything the roster returns is
 * here already, so tabs and search narrow it on the screen without another request.
 */
export function PerformanceList({ roster, setup }: { roster: Roster; setup: SetUpPeriodData }) {
  const [tab, setTab] = useState<EvaluationTab>("All");
  const [search, setSearch] = useState("");
  const shown = roster.rows.filter((row) => inTab(row, tab) && matchesSearch(row, search));
  const empty = roster.counts.All === 0;

  return (
    <>
      <Progress roster={roster} />
      <div className="flex flex-wrap items-center gap-[12px]">
        <div role="group" aria-label="Status" className="flex flex-1 flex-wrap gap-xs">
          {EVALUATION_TABS.map((name) => (
            <button key={name} type="button" aria-pressed={name === tab} onClick={() => setTab(name)}
              className={cn("rounded-lg px-[14px] py-[8px] text-sm font-medium text-muted-foreground hover:text-foreground", name === tab && "bg-accent text-primary hover:text-primary")}>
              {name} {roster.counts[name]}
            </button>
          ))}
        </div>
        <label className="relative w-[240px] max-w-full">
          <span className="sr-only">Search employees</span>
          <Search aria-hidden className="absolute left-[12px] top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
          <Input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search employees" className="h-[38px] rounded-lg border-[#e6e1ee] pl-[36px] shadow-none" />
        </label>
      </div>

      <Card className="flex flex-col gap-[14px] overflow-auto rounded-xl p-[20px] shadow-none">
        {empty ? <Empty roster={roster} setup={setup} /> : shown.length === 0 ? (
          <p className="p-xl text-center text-muted-foreground">{search.trim() ? "No employees match your search." : `No ${tab.toLowerCase()} evaluations.`}</p>
        ) : (
          <Table className="min-w-[900px] table-fixed">
            <TableHeader>
              <TableRow className="border-border-subtle hover:bg-transparent">
                <TableHead className={`${HEAD} w-[250px]`}>Employee</TableHead>
                <TableHead className={`${HEAD} w-[210px]`}>Position</TableHead>
                <TableHead className={`${HEAD} w-[110px]`}>Shift</TableHead>
                <TableHead className={`${HEAD} w-[110px]`}>Score</TableHead>
                <TableHead className={`${HEAD} w-[170px]`}>Attendance import</TableHead>
                <TableHead className={HEAD}>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((row) => {
                const badge = statusBadge(row);
                const attendance = importText(row.attendance);
                return (
                  <TableRow key={row.employeeId} className="border-border-subtle">
                    <TableCell className={CELL}>
                      <Link href={evaluationHref(row.employeeId, roster.period.id)} className="flex flex-col gap-[2px] hover:underline">
                        <span className="text-sm font-medium text-primary">{row.name}</span>
                        <span className="text-xs text-muted-foreground">{row.employeeNumber}{row.shift ? "" : " · no shift yet"}</span>
                      </Link>
                    </TableCell>
                    <TableCell className={CELL}>
                      <div className="flex flex-col gap-[2px]"><span className="text-sm font-medium">{row.position}</span><span className="text-xs text-muted-foreground">{row.branch}</span></div>
                    </TableCell>
                    <TableCell className={CELL}>{shiftText(row.shift)}</TableCell>
                    <TableCell className={cn(CELL, "font-medium")}>{scoreText(row)}</TableCell>
                    <TableCell className={CELL}>
                      <div className="flex flex-col gap-[2px]">
                        <span>{attendance.label}</span>
                        {attendance.issues && <span className="text-xs font-medium text-[#8a5a00]">{attendance.issues}</span>}
                      </div>
                    </TableCell>
                    <TableCell className={CELL}><Badge variant={badge.tone}>{badge.label}</Badge></TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
        <InfoNote>{empty ? EMPTY_NOTE : NOTE}</InfoNote>
      </Card>
    </>
  );
}
