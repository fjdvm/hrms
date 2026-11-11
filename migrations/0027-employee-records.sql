-- Employee records, created together with the move to Hired (Mark as hired). HRMS owns these tables.
-- An Employee record carries the Applicant's details, the Offer's terms and links to the Pre-employment Documents
-- (their Digital 201 folder). Documents are linked by file id; no file is ever copied.
CREATE SEQUENCE IF NOT EXISTS public.hrms_employee_number_seq START 1;

CREATE TABLE IF NOT EXISTS public.hrms_employees (
  id integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  employee_number text NOT NULL UNIQUE,
  -- One Employee record per Offer and per Application; these settle a double click or a concurrent hire.
  offer_id integer NOT NULL UNIQUE REFERENCES public.hrms_offers(id),
  application_id integer NOT NULL UNIQUE,
  full_name text NOT NULL,
  email text NOT NULL,
  position text NOT NULL,
  department text,
  branch text NOT NULL,
  start_date date NOT NULL,
  monthly_salary integer NOT NULL,
  employment_type text NOT NULL,
  schedule text NOT NULL,
  probation text NOT NULL,
  reports_to text NOT NULL,
  status text NOT NULL DEFAULT 'Onboarding' CHECK (status IN ('Onboarding', 'Active')),
  hired_by_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS public.hrms_employee_documents (
  employee_id integer NOT NULL REFERENCES public.hrms_employees(id) ON DELETE CASCADE,
  document_type text NOT NULL CHECK (document_type IN ('resume', 'valid-id', 'nbi', 'health', 'sss', 'philhealth', 'pagibig')),
  -- "application": a file sent with the Application; "upload": a file the Applicant sent for the Offer.
  source text NOT NULL CHECK (source IN ('application', 'upload')),
  file_id text,
  file_name text,
  PRIMARY KEY (employee_id, document_type)
);

ALTER TABLE public.hrms_offer_activity DROP CONSTRAINT IF EXISTS hrms_offer_activity_kind_check;
ALTER TABLE public.hrms_offer_activity ADD CONSTRAINT hrms_offer_activity_kind_check
  CHECK (kind IN ('sent', 'reply-by-extended', 'email-scheduled', 'email-sent', 'documents-requested', 'accepted', 'declined', 'hired'));
