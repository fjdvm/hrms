-- Where an HR-added Application came from. Existing manual rows keep a NULL source and read as "Unspecified";
-- Careers rows are always "Careers page". Referred by is free text, set only for a Referral.
ALTER TABLE public.hrms_manual_applications
  ADD COLUMN IF NOT EXISTS source text CHECK (source IN ('Facebook', 'JobStreet', 'Walk-in', 'Referral')),
  ADD COLUMN IF NOT EXISTS referred_by text;
ALTER TABLE public.hrms_manual_applications DROP CONSTRAINT IF EXISTS hrms_manual_applications_referred_by_check;
ALTER TABLE public.hrms_manual_applications ADD CONSTRAINT hrms_manual_applications_referred_by_check
  CHECK (CASE WHEN source = 'Referral' THEN referred_by IS NOT NULL AND length(btrim(referred_by)) > 0 ELSE referred_by IS NULL END);

-- New columns go at the end so CREATE OR REPLACE VIEW accepts the change.
CREATE OR REPLACE VIEW public.hrms_all_applications AS
SELECT id, applicant_name, applicant_email, job_posting_id, job_posting_title, location, applied_at, stage,
       'Careers page'::text AS source, NULL::text AS referred_by
FROM public.hrms_careers_applications
UNION ALL
SELECT m.id, m.full_name, m.email, m.job_posting_id, j.title, j.location, m.applied_at, m.status,
       COALESCE(m.source, 'Unspecified'), m.referred_by
FROM public.hrms_manual_applications m
JOIN public.job_postings j ON j.id = m.job_posting_id;
