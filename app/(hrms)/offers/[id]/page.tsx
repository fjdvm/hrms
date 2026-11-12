import { notFound, redirect } from "next/navigation";
import { Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { BackLink, CardTitle, PAGE, PageHeader } from "@/components/hiring/parts";
import { OfferReplyBy } from "@/components/hiring/offer-reply-by";
import { OfferResponse } from "@/components/hiring/offer-response";
import { HireCard } from "@/components/hiring/hire-card";
import { OfferDocuments } from "@/components/hiring/offer-documents";
import { RequestDocuments } from "@/components/hiring/request-documents";
import { OfferError, type OfferChecklist, type OfferDetail } from "@/lib/offers";
import { trackerSteps } from "@/lib/application-view";
import { OFFER_ACTIVITY_TITLE, OFFER_BADGE, formatOfferDate, formatPeso, formatShortDate, isOverdue } from "@/lib/offer-view";
import { LOGIN_PATH, NO_ACCESS_PATH } from "@/lib/portal/config";
import { offersForRequest } from "@/lib/portal/offers";
import { requireModule } from "@/lib/portal/staff";
import { cn } from "@/lib/utils";

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
const dayTime = (date: Date) => `${date.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Asia/Manila" })} · ${date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" })}`;

function Tracker({ offer }: { offer: OfferDetail }) {
  const steps = trackerSteps(offer.stage, offer.stageDates).map((step) =>
    step.label === "Offer" && offer.sentAt && step.state !== "upcoming" ? { ...step, date: `Sent ${formatShortDate(offer.sentAt)}` } : step);
  return (
    <ol aria-label="Stage tracker" className="flex items-center gap-[12px] overflow-x-auto rounded-xl border border-border bg-card px-[24px] py-[18px]">
      {steps.map((step, index) => (
        <li key={step.label} className={cn("flex items-center gap-[12px]", index > 0 && "flex-1")}>
          {index > 0 && <span aria-hidden className={cn("h-[2px] min-w-6 flex-1 rounded-[1px]", step.state === "upcoming" ? "bg-zinc-200" : "bg-primary")} />}
          <div className="flex items-center gap-[10px] whitespace-nowrap" aria-current={step.state === "current" ? "step" : undefined}>
            <span aria-hidden className={cn("flex size-[24px] shrink-0 items-center justify-center rounded-full border-[1.5px]",
              step.state === "done" && "border-primary bg-primary text-primary-foreground",
              step.state === "current" && "border-primary bg-white", step.state === "upcoming" && "border-zinc-200 bg-white")}>
              {step.state === "done" && <Check className="size-3" strokeWidth={3} />}
              {step.state === "current" && <span className="size-[8px] rounded-full bg-primary" />}
              {step.state === "upcoming" && <span className="size-[8px] rounded-full bg-zinc-200" />}
            </span>
            <div className="flex flex-col gap-px">
              <span className={cn("text-sm", step.state === "upcoming" ? "font-medium text-zinc-500" : "font-semibold text-zinc-900")}>{step.label}</span>
              <span className="text-xs text-zinc-500">{step.date}</span>
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
      <dt className="text-xs font-medium text-zinc-500">{label}</dt>
      <dd className="break-words text-sm text-foreground">{value}</dd>
    </div>
  );
}

export default async function Page({ params }: PageProps<"/offers/[id]">) {
  await requireModule("Offers");
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();

  let offer: OfferDetail;
  let checklist: OfferChecklist;
  try {
    const offers = await offersForRequest();
    [offer, checklist] = await Promise.all([offers.detail(Number(id)), offers.documents(Number(id))]);
  } catch (error) {
    if (!(error instanceof OfferError)) throw error;
    if (error.reason === "denied") redirect(NO_ACCESS_PATH);
    if (error.reason === "invalid") redirect(LOGIN_PATH);
    if (error.reason === "not-found" || error.reason === "validation") notFound();
    return (
      <div className={PAGE}>
        <PageHeader title="Offer" subtitle={" "} />
        <Card className="rounded-xl shadow-none">
          <p role="alert" className="p-xl text-center text-destructive">The offer could not be loaded. Please try again in a moment.</p>
        </Card>
      </div>
    );
  }
  // A Draft has no page of its own: it is the form.
  if (offer.status === "Draft") redirect(`/offers/${offer.id}/edit`);

  const now = today();
  const overdue = isOverdue(offer.status, offer.replyBy, now);
  const subtitle = [
    `Offer for ${offer.role}`, offer.branch,
    offer.sentAt && `sent ${formatOfferDate(offer.sentAt)}`,
    offer.replyBy && `reply by ${formatShortDate(offer.replyBy)}`,
  ].filter(Boolean).join(" · ");
  const activity = offer.activity.filter((entry) => entry.kind !== "email-scheduled" || !offer.activity.some((other) => other.kind === "email-sent"));

  return (
    <div className={PAGE}>
      <BackLink href="/offers">Offers</BackLink>
      <PageHeader
        title={offer.applicantName}
        subtitle={subtitle}
        badge={<><Badge variant={OFFER_BADGE[offer.status]}>{offer.status}</Badge>{overdue && <Badge variant="destructive">Overdue</Badge>}</>}
      >
        {checklist.canRequest && (
          <RequestDocuments offerId={offer.id} applicantName={offer.applicantName} role={offer.role} startDate={offer.startDate} today={now}
            items={checklist.items.map(({ type, label, hint, status }) => ({ type, label, hint, status }))} />
        )}
        {offer.status === "Sent" && (
          <>
            <OfferReplyBy mode="extend" offerId={offer.id} applicantName={offer.applicantName} min={now} current={offer.replyBy ?? undefined} />
            <OfferResponse
              offerId={offer.id} applicantName={offer.applicantName} role={offer.role} salary={formatPeso(offer.monthlySalary)}
              startShort={formatShortDate(offer.startDate)} startDate={offer.startDate}
            />
          </>
        )}
      </PageHeader>
      <Tracker offer={offer} />
      <div className="flex flex-col gap-[16px] lg:flex-row lg:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-[16px]">
        <Card className="flex flex-col gap-[14px] rounded-xl px-[20px] py-[18px] shadow-none">
          <CardTitle>Offer details</CardTitle>
          <dl className="flex flex-col gap-[14px]">
            <div className="flex gap-[16px]">
              <Field label="Monthly salary" value={formatPeso(offer.monthlySalary)} />
              <Field label="Start date" value={formatOfferDate(offer.startDate)} />
              <Field label="Employment type" value={offer.employmentType} />
            </div>
            <div className="flex gap-[16px]">
              <Field label="Schedule" value={offer.schedule} />
              <Field label="Probation" value={offer.probation} />
              <Field label="Reports to" value={offer.reportsTo} />
            </div>
            {offer.replyBy && (
              <div className="flex gap-[16px]">
                <Field label="Reply by" value={`${formatOfferDate(offer.replyBy)}${overdue ? " · overdue" : ""}`} />
                {offer.repliedAt && <Field label="Reply received" value={dayTime(offer.repliedAt)} />}
              </div>
            )}
          </dl>
        </Card>
        <OfferDocuments checklist={checklist} today={now} />
        </div>
        <div className="flex flex-col gap-[16px] lg:w-[380px] lg:shrink-0">
        {offer.status !== "Declined" && (
          <HireCard offerId={offer.id} firstName={offer.applicantName.trim().split(/\s+/)[0] || offer.applicantName}
            accepted={offer.status === "Accepted"} submitted={checklist.submitted} total={checklist.total}
            withdrawn={offer.status === "Withdrawn"} hired={offer.stage === "Hired"} />
        )}
        <Card className="flex flex-col gap-[14px] rounded-xl px-[20px] py-[18px] shadow-none">
          <CardTitle>Activity</CardTitle>
          <ol aria-label="Activity" className="flex flex-col gap-[14px]">
            {activity.map((entry, index) => (
              <li key={index} className="flex items-start gap-[10px]">
                <span aria-hidden className={cn("mt-[9px] size-[8px] shrink-0 rounded-full", entry.kind === "email-sent" || entry.kind === "sent" ? "bg-badge-success-foreground" : "bg-badge-info-foreground")} />
                <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
                  <span className="text-sm font-medium text-zinc-900">{OFFER_ACTIVITY_TITLE[entry.kind]}</span>
                  <span className="text-xs text-zinc-500">{[dayTime(entry.occurredAt), entry.actorName && `by ${entry.actorName}`, entry.detail].filter(Boolean).join(" · ")}</span>
                </div>
              </li>
            ))}
          </ol>
        </Card>
        </div>
      </div>
    </div>
  );
}
