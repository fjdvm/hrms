ALTER TABLE public.hrms_employees
  ADD COLUMN birthday date,
  ADD COLUMN sex text,
  ADD COLUMN civil_status text,
  ADD COLUMN mobile text,
  ADD COLUMN home_address text,
  ADD COLUMN probation_end_date date;

CREATE TABLE public.hrms_employee_government_ids (
  employee_id integer PRIMARY KEY REFERENCES public.hrms_employees(id) ON DELETE CASCADE,
  -- Versioned AES-256-GCM envelopes, never plaintext. Key lives in HRMS_EMPLOYEE_ENCRYPTION_KEY.
  sss text, philhealth text, pagibig_mid text, tin text
);
CREATE TABLE public.hrms_employee_emergency_contacts (
  employee_id integer PRIMARY KEY REFERENCES public.hrms_employees(id) ON DELETE CASCADE,
  name text, relationship text, mobile text
);
CREATE TABLE public.hrms_employee_audit (
  id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  employee_id integer NOT NULL REFERENCES public.hrms_employees(id),
  actor_id text NOT NULL,
  actor_name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('reveal', 'edit', 'download', 'system', 'status')),
  field text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.hrms_employee_documents ADD COLUMN uploaded_at timestamptz, ADD COLUMN valid_until date;

-- Carry over known hire-time contact details for records created before this migration.
UPDATE public.hrms_employees e SET
  mobile = CASE WHEN e.application_id > 0 THEN c.profile_snapshot->>'phone' ELSE m.mobile END,
  home_address = CASE WHEN e.application_id > 0 THEN c.profile_snapshot->>'location' ELSE m.address END,
  probation_end_date = CASE e.probation WHEN '3 months' THEN (e.start_date + interval '3 months')::date
    WHEN '6 months' THEN (e.start_date + interval '6 months')::date END
FROM public.hrms_offers o
LEFT JOIN public.applications c ON c.id = o.application_id AND o.application_id > 0
LEFT JOIN public.hrms_manual_applications m ON m.id = o.application_id AND o.application_id < 0
WHERE e.offer_id = o.id;

-- Shared storage foundation for seed scenarios and the subsequent Account request tickets (#329/#332).
-- No Portal calls or Account request actions are introduced by this migration.
CREATE SEQUENCE public.hrms_account_request_number_seq START 1;
CREATE TABLE public.hrms_account_requests (
  id integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  reference text NOT NULL UNIQUE DEFAULT ('RQ-' || lpad(nextval('public.hrms_account_request_number_seq')::text,4,'0')),
  employee_id integer NOT NULL REFERENCES public.hrms_employees(id),
  status text NOT NULL CHECK (status IN ('requested','seen','account_created','login_sent','cancelled','declined')),
  work_email text NOT NULL,
  portal_role text NOT NULL,
  requested_modules jsonb NOT NULL DEFAULT '[]',
  access_needed_from date NOT NULL,
  note text,
  personal_email text NOT NULL,
  requester_id text NOT NULL,
  requester_name text NOT NULL,
  decline_reason text,
  decline_message text,
  last_reminder_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX hrms_account_requests_active_employee ON public.hrms_account_requests(employee_id)
  WHERE status IN ('requested','seen','account_created');
CREATE UNIQUE INDEX hrms_account_requests_active_email ON public.hrms_account_requests(lower(work_email))
  WHERE status IN ('requested','seen','account_created');
