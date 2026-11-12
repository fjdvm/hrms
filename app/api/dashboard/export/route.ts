import { cookies } from "next/headers";
import { dashboardRange, exportFileName, hiringCardsCsv, hiringCardsFor } from "@/lib/dashboard";
import { dashboardSummaryFor } from "@/lib/dashboard-data";
import { accessFor } from "@/lib/portal/access";
import { SESSION_COOKIE } from "@/lib/portal/config";

const NO_STORE = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  const access = await accessFor((await cookies()).get(SESSION_COOKIE)?.value).overview();
  const pages = access.decision === "allowed" ? access.pages : [];
  // The Export holds the hiring cards, so it is open to whoever may see at least one of them, and holds only those.
  const probe = hiringCardsFor(pages, {}, dashboardRange(undefined, new Date()));
  if (access.decision !== "allowed" || probe.length === 0) {
    const decision = access.decision === "allowed" ? "denied" : access.decision;
    const status = { denied: 403, invalid: 401, unavailable: 503 }[decision];
    return Response.json({ error: decision }, { status, headers: NO_STORE });
  }

  const params = new URL(request.url).searchParams;
  const now = new Date();
  const range = dashboardRange(params.get("range"), now, { from: params.get("from"), to: params.get("to") });
  const hiringCards = hiringCardsFor(pages, await dashboardSummaryFor(pages, range, now), range);
  return new Response(hiringCardsCsv(hiringCards), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${exportFileName(range)}"`,
      ...NO_STORE,
    },
  });
}
