import { after } from "next/server";
import { careersError, isCareersCaller, readBody, unauthorized } from "@/lib/careers-caller";
import { careersOffersFor } from "@/lib/careers-offers";
import { deliverOfferEmails } from "@/lib/offer-emails";
import { deliverStaffNotifications } from "@/lib/staff-notifications";
import { OfferError } from "@/lib/offers";

/** Careers tells HRMS the Applicant accepted or declined their Offer (ADR-0002). Body: `{ applicantId, answer: "Accepted" | "Declined" }`. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isCareersCaller(request)) return unauthorized();
  const body = await readBody(request);
  try {
    if (!body) throw new OfferError("validation");
    await careersOffersFor().reply(Number((await params).id), body.applicantId as string, body.answer as string);
  } catch (error) {
    return careersError(error);
  }
  after(async () => { await deliverOfferEmails(); await deliverStaffNotifications(); });
  return Response.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } });
}
