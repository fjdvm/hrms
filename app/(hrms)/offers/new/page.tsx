import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Card } from "@/components/ui/card";
import { BackLink, PAGE, PageHeader, PersonCell } from "@/components/hiring/parts";
import { OfferForm } from "@/components/hiring/offer-form";
import { OfferError, type OfferCandidate } from "@/lib/offers";
import { LOGIN_PATH, NO_ACCESS_PATH } from "@/lib/portal/config";
import { offersForRequest } from "@/lib/portal/offers";
import { requireModule } from "@/lib/portal/staff";

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });

type Loaded = { chosen: OfferCandidate; staff: string[] } | { candidates: OfferCandidate[] };

export default async function Page({ searchParams }: PageProps<"/offers/new">) {
  await requireModule("Offers");
  const { application } = await searchParams;
  const param = Array.isArray(application) ? application[0] : application;
  if (param !== undefined && !/^-?\d+$/.test(param)) notFound();
  const offers = await offersForRequest();

  let loaded: Loaded;
  try {
    if (param !== undefined) {
      const [chosen, staff] = await Promise.all([offers.candidate(Number(param)), offers.staff()]);
      loaded = { chosen, staff };
    } else {
      loaded = { candidates: await offers.candidates() };
    }
  } catch (error) {
    if (!(error instanceof OfferError)) throw error;
    if (error.reason === "denied") redirect(NO_ACCESS_PATH);
    if (error.reason === "invalid") redirect(LOGIN_PATH);
    // The Application may have been given an Offer meanwhile; start again from the picker.
    if (error.reason === "not-found" || error.reason === "validation") redirect("/offers/new");
    return (
      <div className={PAGE}>
        <PageHeader title="New offer" subtitle={" "} />
        <Card className="rounded-xl shadow-none">
          <p role="alert" className="p-xl text-center text-destructive">The offer form could not be loaded. Please try again in a moment.</p>
        </Card>
      </div>
    );
  }

  if ("chosen" in loaded) {
    const { chosen, staff } = loaded;
    return (
      <div className={PAGE}>
        <BackLink href="/offers/new">Choose another applicant</BackLink>
        <PageHeader title="New offer" subtitle="Saved as a Draft. Nothing is sent to the applicant yet." />
        <OfferForm
          target={{ applicationId: chosen.applicationId }}
          applicant={{ name: chosen.applicantName, email: chosen.applicantEmail, role: chosen.role, branch: chosen.branch }}
          staff={staff}
          today={today()}
        />
      </div>
    );
  }

  return (
    <div className={PAGE}>
      <BackLink href="/offers">Offers</BackLink>
      <PageHeader title="New offer" subtitle="Choose an applicant at the Offer stage who has no offer yet." />
      <Card className="flex max-w-[720px] flex-col gap-0 rounded-xl p-[8px] shadow-none">
        {loaded.candidates.length === 0 ? (
          <p className="p-xl text-center text-muted-foreground">No applicants are waiting for an offer.</p>
        ) : (
          loaded.candidates.map((item) => (
            <div key={item.applicationId} className="relative flex items-center gap-sm rounded-lg px-[12px] py-[10px] hover:bg-muted">
              <div className="min-w-0 flex-1">
                <PersonCell name={item.applicantName} subtitle={item.applicantEmail} href={`/offers/new?application=${item.applicationId}`} />
              </div>
              <p className="text-sm text-muted-foreground">{item.role} · {item.branch}</p>
            </div>
          ))
        )}
      </Card>
      <Link href="/applicants?stage=Offer" className="self-start text-[13px] font-medium text-primary hover:underline">View applicants at the Offer stage</Link>
    </div>
  );
}
