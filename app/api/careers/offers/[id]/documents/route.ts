import { after } from "next/server";
import { careersError, isCareersCaller, readBody, unauthorized } from "@/lib/careers-caller";
import { careersOffersFor } from "@/lib/careers-offers";
import { deliverStaffNotifications } from "@/lib/staff-notifications";
import { OfferError } from "@/lib/offers";
import type { DocumentType } from "@/lib/offer-documents";

/** Careers tells HRMS the Applicant uploaded a requested document (ADR-0002, ADR-0003). Body: `{ applicantId, type, fileId, fileName }`. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isCareersCaller(request)) return unauthorized();
  const body = await readBody(request);
  let result;
  try {
    if (!body) throw new OfferError("validation");
    result = await careersOffersFor().uploadDocument(Number((await params).id), body.applicantId as string,
      { type: body.type as DocumentType, fileId: body.fileId as string, fileName: body.fileName as string });
  } catch (error) {
    return careersError(error);
  }
  after(() => deliverStaffNotifications());
  return Response.json({ ok: true, ...result }, { headers: { "Cache-Control": "private, no-store" } });
}
