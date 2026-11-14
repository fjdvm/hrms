import { formatTrainingDate, formatTrainingTimes, formatShortDate, scheduleRangeLabel, schedulePage, schedulePageCount, type ScheduleSheet } from "@/lib/training-terms";

/** One A4 page of the schedule. The same markup is the preview in the dialog and what the browser prints. */
export function SchedulePage({ sheet, page }: { sheet: ScheduleSheet; page: number }) {
  const items = schedulePage(sheet.items, sheet.includeNames, page);
  return (
    <article className="schedule-page flex aspect-[210/297] w-full flex-col gap-[14px] bg-white p-[8%] text-[#1f1a2e] print:aspect-auto print:p-0">
      <header className="flex flex-col gap-[6px]">
        <p className="text-[9px] font-semibold tracking-wide text-[#5b2a86] print:text-[10pt]">BREN RAPHAEL’S · TRAINING SCHEDULE</p>
        <h2 className="text-[17px] font-semibold print:text-[20pt]">{scheduleRangeLabel(sheet.items.map((item) => item.date))}</h2>
        <p className="text-[8px] text-[#6e6680] print:text-[9pt]">
          Printed {formatShortDate(sheet.printedOn)} by {sheet.printedBy} · Bring this sheet to the session
        </p>
      </header>
      <ul className="flex flex-col">
        {items.map((item) => (
          <li key={item.id} className="flex flex-col gap-[2px] border-t border-[#e6e1ee] py-[9px] first:border-t-0 print:break-inside-avoid print:py-[8pt]">
            <p className="text-[10px] font-semibold print:text-[12pt]">{item.title}</p>
            <p className="text-[8px] print:text-[10pt]">{formatTrainingDate(item.date)} · {formatTrainingTimes(item.startTime, item.endTime)}</p>
            <p className="text-[8px] text-[#6e6680] print:text-[9pt]">{item.mode} · {item.location} · {item.trainer}</p>
            {item.assigned && (
              <p className="text-[7.5px] text-[#6e6680] print:text-[9pt]">
                {item.assigned.length === 0 ? "No one is assigned yet." : `Assigned (${item.assigned.length}): ${item.assigned.join(", ")}`}
              </p>
            )}
          </li>
        ))}
      </ul>
      {schedulePageCount(sheet) > 1 && <p className="mt-auto text-right text-[7px] text-[#a1a1aa] print:text-[8pt]">Page {page + 1} of {schedulePageCount(sheet)}</p>}
    </article>
  );
}

/** Every page, in order, for printing. */
export function ScheduleDocument({ sheet }: { sheet: ScheduleSheet }) {
  return <>{Array.from({ length: schedulePageCount(sheet) }, (_, page) => <SchedulePage key={page} sheet={sheet} page={page} />)}</>;
}
