import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CELL, HEAD, InfoNote, PAGE, PageHeader, PersonCell } from "@/components/hiring/parts";
import { OFFER_TABS, OfferError, type OfferPage } from "@/lib/offers";
import { OFFER_BADGE, formatOfferDate, formatPeso, formatWaiting, offerTabFromParam, offersHref } from "@/lib/offer-view";
import { offersForRequest } from "@/lib/portal/offers";
import { requireModule } from "@/lib/portal/staff";
import { cn } from "@/lib/utils";

const dash = (value: string | null) => value ?? "—";

export default async function Page({ searchParams }: PageProps<"/offers">) {
  await requireModule("Recruitment and Hiring");
  const { tab: param } = await searchParams;
  const tab = offerTabFromParam(Array.isArray(param) ? param[0] : param);

  let result: OfferPage;
  try {
    result = await (await offersForRequest()).list(tab);
  } catch (error) {
    if (!(error instanceof OfferError)) throw error;
    return (
      <div className={PAGE}>
        <PageHeader title="Offers" subtitle={" "} />
        <Card className="rounded-xl shadow-none">
          <p role="alert" className="p-xl text-center text-destructive">Offers could not be loaded. Please try again in a moment.</p>
        </Card>
      </div>
    );
  }
  const { rows, counts, waiting } = result;

  return (
    <div className={PAGE}>
      <PageHeader title="Offers" subtitle={formatWaiting(waiting)}>
        <Button asChild className="h-auto rounded-lg px-[14px] py-[9px] font-medium shadow-none">
          <Link href="/offers/new">New offer</Link>
        </Button>
      </PageHeader>
      <nav aria-label="Status" className="flex flex-wrap gap-xs">
        {OFFER_TABS.map((name) => (
          <Link
            key={name}
            href={offersHref(name)}
            aria-current={name === tab ? "page" : undefined}
            className={cn(
              "rounded-lg px-[14px] py-[8px] text-sm font-medium text-muted-foreground hover:text-foreground",
              name === tab && "bg-accent text-primary hover:text-primary",
            )}
          >
            {name} {counts[name]}
          </Link>
        ))}
      </nav>
      <Card className="flex flex-col gap-[14px] overflow-auto rounded-xl p-[20px] shadow-none">
        {rows.length === 0 ? (
          <p className="p-xl text-center text-muted-foreground">{tab === "All" ? "No offers yet." : `No ${tab.toLowerCase()} offers.`}</p>
        ) : (
          <Table className="table-fixed min-w-[1000px]">
            <TableHeader>
              <TableRow className="border-border-subtle hover:bg-transparent">
                <TableHead className={`${HEAD} w-[250px]`}>Applicant</TableHead>
                <TableHead className={`${HEAD} w-[200px]`}>Role</TableHead>
                <TableHead className={`${HEAD} w-[130px]`}>Monthly salary</TableHead>
                <TableHead className={`${HEAD} w-[120px]`}>Start date</TableHead>
                <TableHead className={`${HEAD} w-[110px]`}>Sent</TableHead>
                <TableHead className={`${HEAD} w-[110px]`}>Reply by</TableHead>
                <TableHead className={HEAD}>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((offer) => (
                <TableRow key={offer.id} className="relative border-border-subtle">
                  <TableCell className={CELL}>
                    {/* Only Drafts have a page so far: the form. Sent Offers get theirs in a later ticket. */}
                    <PersonCell name={offer.applicantName} subtitle={offer.applicantEmail} href={offer.status === "Draft" ? `/offers/${offer.id}/edit` : undefined} />
                  </TableCell>
                  <TableCell className={CELL}>{offer.role}</TableCell>
                  <TableCell className={CELL}>{formatPeso(offer.monthlySalary)}</TableCell>
                  <TableCell className={CELL}>{formatOfferDate(offer.startDate)}</TableCell>
                  <TableCell className={`${CELL} ${offer.sentAt ? "" : "text-muted-foreground"}`}>
                    {dash(offer.sentAt ? formatOfferDate(offer.sentAt) : null)}
                  </TableCell>
                  <TableCell className={`${CELL} ${offer.replyBy ? "" : "text-muted-foreground"}`}>
                    {dash(offer.replyBy ? formatOfferDate(offer.replyBy) : null)}
                  </TableCell>
                  <TableCell className={CELL}>
                    <Badge variant={OFFER_BADGE[offer.status]}>{offer.status}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <InfoNote>
          When an offer is accepted, the applicant moves to Hired and their
          details carry over to the employee record.
        </InfoNote>
      </Card>
    </div>
  );
}
