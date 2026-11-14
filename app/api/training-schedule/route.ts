import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/portal/config";
import { TrainingError, trainingsFor } from "@/lib/trainings";
import { scheduleCsv, scheduleFileName } from "@/lib/training-terms";

/**
 * Exports the chosen Trainings' schedule as CSV (opens in Excel). With the names included it also marks the no-email
 * Employees on them as printed. A POST because it changes something; the body is `{ trainingIds, includeNames }`.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { trainingIds?: unknown; includeNames?: unknown } | null;
  const ids = Array.isArray(body?.trainingIds) ? body.trainingIds : [];
  try {
    const { sheet } = await trainingsFor((await cookies()).get(SESSION_COOKIE)?.value).printSchedule(ids as number[], { includeNames: body?.includeNames === true });
    return new Response(scheduleCsv(sheet), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${scheduleFileName(sheet, "csv")}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    if (!(error instanceof TrainingError)) throw error;
    const status = { denied: 403, invalid: 401, unavailable: 503, validation: 400, "not-found": 404, conflict: 409, early: 409, locked: 409 }[error.reason];
    return Response.json({ error: error.reason }, { status, headers: { "Cache-Control": "private, no-store" } });
  }
}
