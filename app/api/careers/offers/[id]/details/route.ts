import { careersError, isCareersCaller, readBody, unauthorized } from "@/lib/careers-caller";
import { careersOffersFor } from "@/lib/careers-offers";
import { OfferError } from "@/lib/offers";

/** Optional full replacement of Your details. Careers supplies its signed-in applicantId. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isCareersCaller(request)) return unauthorized();
  try {
    const body = await readBody(request);
    if (!body) throw new OfferError("validation");
    await careersOffersFor().saveDetails(Number((await params).id), body.applicantId as string, body);
    return Response.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return careersError(error);
  }
}
