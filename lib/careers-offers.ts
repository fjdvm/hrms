import { encryptApplicantDetails, readApplicantDetails, validateApplicantDetails } from "./offer-applicant-details";
import { database, type Database } from "./database";
import { DOCUMENT_TYPES, documentLabel, type DocumentType } from "./offer-documents";
import { OFFER_ANSWERS, type OfferAnswer } from "./offer-reply";
import { OfferError, SELECT_OFFERS, applyReply, readChecklist, type OfferRow } from "./offers";

/** The document type and the file id; the name is only for showing the file. */
export type DocumentUpload = { type: DocumentType; fileId: string; fileName?: string };

const validId = (id: unknown) => Number.isInteger(id) && (id as number) > 0 && (id as number) <= 2_147_483_647;
const text = (value: unknown, max: number) => typeof value === "string" && value.trim().length > 0 && value.trim().length <= max;

/**
 * What the Careers site may do to an Offer (ADR-0002): the Applicant accepts or declines it and uploads a requested
 * Pre-employment Document. The caller is Careers, not Staff, so there is no Module check here; the route authenticates it.
 * `applicantId` is the Applicant Careers signed in, and the Offer must belong to their own Application. Anything else is not-found.
 */
export function careersOffersFor(db: Database = database) {
  async function ownOffer(id: number, applicantId: unknown): Promise<OfferRow> {
    if (!validId(id) || !text(applicantId, 200)) throw new OfferError("validation");
    const { rows } = await db.query<OfferRow>(
      `${SELECT_OFFERS} WHERE o.id = $1 AND EXISTS (SELECT 1 FROM public.applications c WHERE c.id = o.application_id AND c.applicant_id = $2)`,
      [id, applicantId]);
    if (!rows[0]) throw new OfferError("not-found");
    return rows[0];
  }
  return {
    /** Optional answers, editable until hire; revision guards serialize saves with hiring. */
    async saveDetails(id: number, applicantId: string, input: unknown): Promise<void> {
      const details = validateApplicantDetails(input);
      const offer = await ownOffer(id, applicantId);
      if (offer.status === "Withdrawn") throw new OfferError("conflict", "withdrawn");
      if (offer.status === "Draft") throw new OfferError("conflict", "draft");
      if (offer.status === "Declined") throw new OfferError("conflict", "declined");
      const snapshot = await readApplicantDetails(db, id);
      const encrypted = encryptApplicantDetails(details, id);
      const { rows } = await db.query(`UPDATE public.hrms_offers o
        SET applicant_details=$3::jsonb, details_revision=details_revision+1
        WHERE o.id=$1 AND o.details_revision=$4 AND o.status IN ('Sent','Accepted')
          AND EXISTS (SELECT 1 FROM public.applications a WHERE a.id=o.application_id AND a.applicant_id=$2 AND a.status='Offer')
          AND NOT EXISTS (SELECT 1 FROM public.hrms_employees e WHERE e.offer_id=o.id)
        RETURNING o.id`, [id, applicantId, JSON.stringify(encrypted), snapshot.revision]);
      if (!rows.length) throw new OfferError("conflict");
    },
    /** Same rules as Staff recording a reply, with the reply time now and the email queued to go out at once. Staff are told. */
    async reply(id: number, applicantId: string, answer: string): Promise<void> {
      if (!OFFER_ANSWERS.includes(answer as OfferAnswer)) throw new OfferError("validation");
      const offer = await ownOffer(id, applicantId);
      if (offer.status === "Withdrawn") throw new OfferError("conflict", "withdrawn");
      if (offer.status === "Draft") throw new OfferError("conflict", "draft");
      if (offer.status !== "Sent") throw new OfferError("conflict", "already-answered");
      try {
        await applyReply(db, offer, answer as OfferAnswer, new Date(), null, { actorName: offer.applicantName, notifyStaff: true });
      } catch (error) {
        // The Offer was answered or the Application withdrawn between the read and the write.
        if (error instanceof OfferError && error.reason === "conflict" && !error.detail) throw new OfferError("conflict", "already-answered");
        throw error;
      }
    },
    /**
     * Records the document type and file id as Submitted, replacing any earlier file. Allowed while the Offer is Sent or Accepted.
     * Staff are told; when this is the last of the seven on an Accepted Offer, they are told it is ready to hire.
     */
    async uploadDocument(id: number, applicantId: string, upload: DocumentUpload): Promise<{ submitted: number; total: number }> {
      if (!DOCUMENT_TYPES.includes(upload?.type) || !text(upload.fileId, 200) || (upload.fileName !== undefined && !text(upload.fileName, 255))) throw new OfferError("validation");
      const offer = await ownOffer(id, applicantId);
      if (offer.status === "Withdrawn") throw new OfferError("conflict", "withdrawn");
      if (offer.status === "Draft") throw new OfferError("conflict", "draft");
      if (offer.status === "Declined") throw new OfferError("conflict", "declined");
      const first = offer.applicantName.trim().split(/\s+/)[0] || offer.applicantName;
      // The 7th document on an Accepted Offer is the one that says "Ready to hire"; replacing a file does not.
      const before = await readChecklist(db, id);
      const ready = offer.status === "Accepted"
        && before.items.every((item) => item.type === upload.type ? item.status !== "Submitted" : item.status === "Submitted");
      const notice = ready
        ? { type: "offer.ready", title: `Ready to hire: ${offer.applicantName}`, body: `${offer.applicantName} accepted the offer and all documents are submitted.` }
        : { type: "offer.document", title: `Document submitted: ${offer.applicantName}`, body: `${first} submitted ${documentLabel(upload.type)} for the ${offer.role} offer.` };
      const { rows } = await db.query<{ saved: boolean }>(`
        WITH ok AS (
          SELECT o.id FROM public.hrms_offers o JOIN public.hrms_all_applications a ON a.id = o.application_id
          WHERE o.id = $1 AND o.status IN ('Sent', 'Accepted') AND a.stage <> 'Withdrawn'
        ), saved AS (
          INSERT INTO public.hrms_offer_documents (offer_id, document_type, status, file_id, file_name, submitted_at)
          SELECT id, $2, 'Submitted', $3, $4, clock_timestamp() FROM ok
          ON CONFLICT (offer_id, document_type) DO UPDATE SET status = 'Submitted', file_id = EXCLUDED.file_id,
            file_name = EXCLUDED.file_name, submitted_at = EXCLUDED.submitted_at
          RETURNING offer_id
        ), notice AS (
          INSERT INTO public.hrms_staff_notifications (id, payload)
          SELECT 'offer.document:' || offer_id || ':' || $2 || ':' || $3, jsonb_build_object('type', $5::text,
            'title', $6::text, 'body', $7::text, 'link', '/offers/' || offer_id)
          FROM saved ON CONFLICT (id) DO NOTHING
        )
        SELECT EXISTS (SELECT 1 FROM saved) AS saved`,
      [id, upload.type, upload.fileId.trim(), upload.fileName?.trim() ?? null, notice.type, notice.title, notice.body]);
      if (!rows[0].saved) throw new OfferError("conflict", "already-answered");
      const checklist = await readChecklist(db, id);
      return { submitted: checklist.submitted, total: checklist.total };
    },
  };
}
