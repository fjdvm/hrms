import { cookies } from "next/headers";
import { EmployeeError, employeesFor, type EmployeeStatus } from "@/lib/employees";
import { SESSION_COOKIE } from "@/lib/portal/config";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const status = params.get("status");
  try {
    const csv = await employeesFor((await cookies()).get(SESSION_COOKIE)?.value).exportCsv({
      status: (status || undefined) as EmployeeStatus | undefined,
      branch: params.get("branch") || undefined,
      search: params.get("q") || undefined,
    });
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="employees-${new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" })}.csv"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    if (!(error instanceof EmployeeError)) throw error;
    const code = { denied: 403, invalid: 401, unavailable: 503, validation: 400, "not-found": 404 }[error.reason];
    return Response.json({ error: error.reason }, { status: code, headers: { "Cache-Control": "private, no-store" } });
  }
}
