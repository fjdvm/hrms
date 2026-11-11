import { notFound, redirect } from "next/navigation";
import { Card } from "@/components/ui/card";
import { BackLink, PAGE, PageHeader } from "@/components/hiring/parts";
import { OfferReplyBy } from "@/components/hiring/offer-reply-by";
import { OfferForm } from "@/components/hiring/offer-form";
import { OfferError, type OfferDraft } from "@/lib/offers";
import { LOGIN_PATH, NO_ACCESS_PATH } from "@/lib/portal/config";
import { offersForRequest } from "@/lib/portal/offers";
import { requireModule } from "@/lib/portal/staff";

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });

export default async function Page({ params }: PageProps<"/offers/[id]/edit">) {
  await requireModule("Recruitment and Hiring");
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();
  const offers = await offersForRequest();

  let offer: OfferDraft;
  let staff: string[];
  try {
    [offer, staff] = await Promise.all([offers.read(Number(id)), offers.staff()]);
  } catch (error) {
    if (!(error instanceof OfferError)) throw error;
    if (error.reason === "denied") redirect(NO_ACCESS_PATH);
    if (error.reason === "invalid") redirect(LOGIN_PATH);
    if (error.reason === "not-found" || error.reason === "validation") notFound();
    return (
      <div className={PAGE}>
        <PageHeader title="Edit draft offer" subtitle={" "} />
        <Card className="rounded-xl shadow-none">
          <p role="alert" className="p-xl text-center text-destructive">The offer could not be loaded. Please try again in a moment.</p>
        </Card>
      </div>
    );
  }
  // Only a Draft can be edited; anything else has no form.
  if (offer.status !== "Draft") redirect(`/offers/${offer.id}`);

  return (
    <div className={PAGE}>
      <BackLink href="/offers">Offers</BackLink>
      <PageHeader title="Edit draft offer" subtitle="Saved as a Draft. Nothing is sent to the applicant yet.">
        <OfferReplyBy mode="send" offerId={offer.id} applicantName={offer.applicantName} min={today()} />
      </PageHeader>
      <OfferForm
        target={{ offerId: offer.id }}
        applicant={{ name: offer.applicantName, email: offer.applicantEmail, role: offer.role, branch: offer.branch }}
        staff={staff}
        initial={{ monthlySalary: offer.monthlySalary, startDate: offer.startDate, employmentType: offer.employmentType, schedule: offer.schedule, probation: offer.probation, reportsTo: offer.reportsTo }}
        today={today()}
      />
    </div>
  );
}
