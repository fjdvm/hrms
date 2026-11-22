"use client";

import { useState, useTransition } from "react";
import { Search } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CELL, HEAD, InfoNote } from "@/components/hiring/parts";
import { changeKpiStatus } from "@/app/(hrms)/performance/actions";
import { dayLabel, pesos } from "@/lib/performance-pos-import-terms";
import type { Kpi, KpiStatus, WeightSet } from "@/lib/performance-kpis";
import { cn } from "@/lib/utils";
import { NewWeightSetDialog } from "./new-weight-set-dialog";
import { SalesSettingsDialog } from "./sales-settings-dialog";

const TABS = ["All", "Active", "Inactive"] as const;
type Tab = (typeof TABS)[number];
const SUMMARY_TEXT = "The default set applies to everyone. A position can have its own set, which applies when the Employee's position matches exactly. Each set must total 100. Formulas, targets and weights need HR approval.";

/** The KPIs that belong to a tab. */
export const inTab = (kpi: Pick<Kpi, "status">, tab: Tab) => tab === "All" || kpi.status === tab;
/** The KPIs a search finds: by name, description or source, ignoring case. */
export const matchesSearch = (kpi: Pick<Kpi, "name" | "description" | "source">, search: string) => {
  const needle = search.trim().toLowerCase();
  return needle === "" || [kpi.name, kpi.description, kpi.source].some((text) => text.toLowerCase().includes(needle));
};

/** The KPI's target as the table shows it: the sales KPI's is a peso amount per present day, which is set in the Sales settings dialog. */
const targetOf = (kpi: Kpi) => (kpi.id === "sales" ? (kpi.targetAmount != null ? `${pesos(kpi.targetAmount)}/day` : "Not set") : kpi.target);

/**
 * KPI Setup: the KPIs with the weights of the selected set, tabs and a search, and a switch to set each KPI Active or Inactive. A KPI is never
 * deleted. The weights summary shows the selected set's total out of 100. With `sales`, the page also shows the company-wide sales target and
 * the POS go-live date, and a dialog to change them; the sales KPI is off in any set that gives it weight 0.
 */
export function KpiSetup({ kpis, sets, sales }: { kpis: Kpi[]; sets: WeightSet[]; sales?: { target: number | null; goLiveDate: string | null } }) {
  const [tab, setTab] = useState<Tab>("All");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState(() => sets.find((set) => set.isDefault)?.id ?? sets[0]?.id);
  const [statuses, setStatuses] = useState<Record<string, KpiStatus>>({});
  const [, start] = useTransition();
  const selected = sets.find((set) => set.id === selectedId) ?? sets[0];
  const statusOf = (kpi: Kpi): KpiStatus => statuses[kpi.id] ?? kpi.status;
  const counts: Record<Tab, number> = { All: kpis.length, Active: kpis.filter((kpi) => statusOf(kpi) === "Active").length, Inactive: kpis.filter((kpi) => statusOf(kpi) === "Inactive").length };
  const shown = kpis.filter((kpi) => inTab({ status: statusOf(kpi) }, tab) && matchesSearch(kpi, search));

  const change = (kpi: Kpi, active: boolean) => {
    const status: KpiStatus = active ? "Active" : "Inactive";
    const before = statusOf(kpi);
    setStatuses((current) => ({ ...current, [kpi.id]: status }));
    start(async () => {
      const result = await changeKpiStatus(kpi.id, status);
      if (result.ok) toast.success(`${kpi.name} is now ${status.toLowerCase()}`);
      else {
        setStatuses((current) => ({ ...current, [kpi.id]: before }));
        toast.error(result.error);
      }
    });
  };

  return (
    <>
      <Card className="flex flex-wrap items-center gap-lg rounded-xl p-[20px] shadow-none">
        <div className="flex w-[300px] max-w-full flex-col gap-[6px]">
          <p className="text-sm text-muted-foreground">Weights · {selected.name}</p>
          <p className="flex items-baseline gap-[8px]">
            <span className="text-[32px] font-semibold leading-none text-foreground" data-testid="weights-total">{selected.total}</span>
            <span className="text-sm text-muted-foreground">of 100 allocated</span>
          </p>
          <div role="progressbar" aria-label="Weights allocated" aria-valuemin={0} aria-valuemax={100} aria-valuenow={selected.total} className="h-[6px] w-full bg-zinc-200">
            <div className="h-full bg-[#5b2a86]" style={{ width: `${Math.min(selected.total, 100)}%` }} />
          </div>
        </div>
        <p className="min-w-[240px] flex-1 text-xs text-muted-foreground">{SUMMARY_TEXT}</p>
      </Card>

      {sales && (
        <Card className="flex flex-wrap items-center gap-lg rounded-xl p-[20px] shadow-none">
          <div className="flex min-w-[200px] flex-col gap-[4px]">
            <p className="text-sm text-muted-foreground">Sales target</p>
            <p className="text-[18px] font-semibold text-foreground" data-testid="sales-target">{sales.target === null ? "Not set" : `${pesos(sales.target)} per present day`}</p>
          </div>
          <div className="flex min-w-[160px] flex-col gap-[4px]">
            <p className="text-sm text-muted-foreground">POS go-live date</p>
            <p className="text-[18px] font-semibold text-foreground" data-testid="sales-go-live">{sales.goLiveDate ? dayLabel(sales.goLiveDate) : "Not set"}</p>
          </div>
          <p className="min-w-[240px] flex-1 text-xs text-muted-foreground">One company-wide target for the sales KPI. POS sales are imported only from the go-live date; imports stay blocked until it is set. A set with a sales weight of 0 leaves the sales KPI off.</p>
          <SalesSettingsDialog current={{ target: sales.target, goLive: sales.goLiveDate }} />
        </Card>
      )}

      {sets.length > 1 && (
        <div role="group" aria-label="Weight set" className="flex flex-wrap items-center gap-xs">
          <span className="text-sm text-muted-foreground">Set</span>
          {sets.map((set) => (
            <button key={set.id} type="button" aria-pressed={set.id === selected.id} onClick={() => setSelectedId(set.id)}
              className={cn("rounded-lg px-[14px] py-[8px] text-sm font-medium text-muted-foreground hover:text-foreground", set.id === selected.id && "bg-accent text-primary hover:text-primary")}>
              {set.name}
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-[12px]">
        <div role="group" aria-label="Status" className="flex flex-1 flex-wrap gap-xs">
          {TABS.map((name) => (
            <button key={name} type="button" aria-pressed={name === tab} onClick={() => setTab(name)}
              className={cn("rounded-lg px-[14px] py-[8px] text-sm font-medium text-muted-foreground hover:text-foreground", name === tab && "bg-accent text-primary hover:text-primary")}>
              {name} {counts[name]}
            </button>
          ))}
        </div>
        <label className="relative w-[240px] max-w-full">
          <span className="sr-only">Search KPIs</span>
          <Search aria-hidden className="absolute left-[12px] top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
          <Input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search KPIs" className="h-[38px] rounded-lg border-[#e6e1ee] pl-[36px] shadow-none" />
        </label>
        <NewWeightSetDialog sets={sets} kpis={kpis} />
      </div>

      <Card className="flex flex-col gap-[14px] overflow-auto rounded-xl p-[20px] shadow-none">
        {shown.length === 0 ? (
          <p className="p-xl text-center text-muted-foreground">{search.trim() ? "No KPIs match your search." : `No ${tab.toLowerCase()} KPIs.`}</p>
        ) : (
          <Table className="min-w-[860px] table-fixed">
            <TableHeader>
              <TableRow className="border-border-subtle hover:bg-transparent">
                <TableHead className={`${HEAD} w-[270px]`}>KPI</TableHead>
                <TableHead className={`${HEAD} w-[160px]`}>Source</TableHead>
                <TableHead className={`${HEAD} w-[150px]`}>Positions</TableHead>
                <TableHead className={`${HEAD} w-[90px]`}>Weight</TableHead>
                <TableHead className={`${HEAD} w-[110px]`}>Target</TableHead>
                <TableHead className={HEAD}>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((kpi) => {
                const status = statusOf(kpi);
                return (
                  <TableRow key={kpi.id} className="border-border-subtle">
                    <TableCell className={CELL}>
                      <div className="flex flex-col gap-[2px]">
                        <span className={cn("text-sm font-medium", status === "Active" ? "text-primary" : "text-muted-foreground")}>{kpi.name}</span>
                        <span className="text-xs text-muted-foreground">{kpi.description}</span>
                      </div>
                    </TableCell>
                    <TableCell className={CELL}>{kpi.source}</TableCell>
                    <TableCell className={CELL}>{selected.name}</TableCell>
                    <TableCell className={cn(CELL, status === "Inactive" && "text-zinc-400")}>{selected.weights[kpi.id] ?? 0}</TableCell>
                    <TableCell className={CELL}>{targetOf(kpi)}</TableCell>
                    <TableCell className={CELL}>
                      <div className="flex items-center gap-[10px]">
                        <Badge variant={status === "Active" ? "success" : "secondary"}>{status}</Badge>
                        <Switch checked={status === "Active"} onCheckedChange={(active) => change(kpi, active)} aria-label={`${kpi.name} active`} className="h-[20px] w-[36px] [&>span]:size-4 [&>span]:data-[state=checked]:translate-x-4" />
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
        <InfoNote>A KPI used by an evaluation can’t be deleted, only deactivated. Each weight set must total 100.</InfoNote>
      </Card>
    </>
  );
}
