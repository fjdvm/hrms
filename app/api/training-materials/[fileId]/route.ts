import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/portal/config";
import { TrainingError, trainingsFor } from "@/lib/trainings";

/** Sends Staff holding the Training Module to a short-lived signed address for one material. */
export async function GET(_request: Request, { params }: { params: Promise<{ fileId: string }> }) {
  const { fileId } = await params;
  try {
    const url = await trainingsFor((await cookies()).get(SESSION_COOKIE)?.value).materialUrl(fileId);
    return new Response(null, { status: 307, headers: { Location: url, "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (!(error instanceof TrainingError)) throw error;
    const status = { denied: 403, invalid: 401, unavailable: 503, validation: 400, "not-found": 404, conflict: 409 }[error.reason];
    return Response.json({ error: error.reason }, { status, headers: { "Cache-Control": "private, no-store" } });
  }
}
