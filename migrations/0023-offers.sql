-- Offers: one written job offer per Application. HRMS owns this table; Careers only reads it.
-- application_id is not a foreign key because it points at either a Careers or an HR-added Application.
-- Withdrawn is derived from the Application and is never stored here.
CREATE TABLE IF NOT EXISTS public.hrms_offers (
  id integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  application_id integer NOT NULL,
  status text NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft', 'Sent', 'Accepted', 'Declined')),
  monthly_salary integer NOT NULL CHECK (monthly_salary > 0),
  start_date date NOT NULL,
  employment_type text NOT NULL CHECK (employment_type IN ('Full-time', 'Part-time', 'Contractual')),
  schedule text NOT NULL CHECK (length(btrim(schedule)) > 0),
  probation text NOT NULL CHECK (probation IN ('None', '3 months', '6 months')),
  reports_to text NOT NULL CHECK (length(btrim(reports_to)) > 0),
  branch text NOT NULL,
  sent_at timestamptz,
  reply_by date,
  created_by_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
-- An Application has at most one Offer; this settles concurrent creates.
CREATE UNIQUE INDEX IF NOT EXISTS hrms_offers_application ON public.hrms_offers (application_id);
