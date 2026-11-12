import { cookies } from "next/headers";
import { EmployeeError, employeesFor } from "@/lib/employees";
import { SESSION_COOKIE } from "@/lib/portal/config";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return await employeesFor((await cookies()).get(SESSION_COOKIE)?.value)
      .downloadDocuments(Number(id), request.signal);
  } catch (error) {
    if (!(error instanceof EmployeeError)) throw error;
    const status = { denied: 403, invalid: 401, unavailable: 503, validation: 400, "not-found": 404 }[error.reason];
    return Response.json({ error: error.reason }, { status, headers: { "Cache-Control": "private, no-store" } });
  }
}
