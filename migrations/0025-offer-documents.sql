-- Pre-employment Documents on an Offer. HRMS owns this table.
-- A row exists only once Staff request a document (or, later, once the Applicant uploads one). A document with no row is
-- Submitted when the Application already carries a matching file, and Not requested otherwise, so no row is backfilled.
-- Re-requesting a Submitted document resets its row to Requested; the next upload replaces the file.
CREATE TABLE IF NOT EXISTS public.hrms_offer_documents (
  offer_id integer NOT NULL REFERENCES public.hrms_offers(id) ON DELETE CASCADE,
  document_type text NOT NULL CHECK (document_type IN ('resume', 'valid-id', 'nbi', 'health', 'sss', 'philhealth', 'pagibig')),
  status text NOT NULL CHECK (status IN ('Requested', 'Submitted')),
  due_date date,
  message text,
  requested_at timestamptz,
  requested_by_name text,
  file_id text,
  file_name text,
  submitted_at timestamptz,
  PRIMARY KEY (offer_id, document_type)
);

-- The Offer's history also records when documents were requested.
ALTER TABLE public.hrms_offer_activity DROP CONSTRAINT IF EXISTS hrms_offer_activity_kind_check;
ALTER TABLE public.hrms_offer_activity ADD CONSTRAINT hrms_offer_activity_kind_check
  CHECK (kind IN ('sent', 'reply-by-extended', 'email-scheduled', 'email-sent', 'documents-requested'));
