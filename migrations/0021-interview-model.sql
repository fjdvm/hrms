LOCK TABLE public.hrms_application_interviews, public.hrms_application_activity IN ACCESS EXCLUSIVE MODE;
-- Preserve legacy extra rounds and their activity references before enforcing one booking.
CREATE TABLE public.hrms_legacy_application_interviews AS
SELECT * FROM public.hrms_application_interviews
WHERE id NOT IN (SELECT max(id) FROM public.hrms_application_interviews GROUP BY application_id);
ALTER TABLE public.hrms_legacy_application_interviews ADD PRIMARY KEY (id);
ALTER TABLE public.hrms_application_activity ADD COLUMN legacy_interview_id bigint
  REFERENCES public.hrms_legacy_application_interviews(id);
UPDATE public.hrms_application_activity SET legacy_interview_id = interview_id, interview_id = NULL
WHERE interview_id IN (SELECT id FROM public.hrms_legacy_application_interviews);
DELETE FROM public.hrms_application_interviews
WHERE id IN (SELECT id FROM public.hrms_legacy_application_interviews);
ALTER TABLE public.hrms_application_interviews
  ADD CONSTRAINT hrms_one_interview_per_application UNIQUE (application_id),
  ADD COLUMN interviewer_id text,
  ADD COLUMN meeting_link text,
  ADD COLUMN map_link text,
  ADD COLUMN province text,
  ADD COLUMN city text,
  ADD COLUMN address text,
  ADD COLUMN private_notes text,
  ADD COLUMN result_email_at timestamptz;
-- Legacy free text cannot identify a Portal Staff member. Keep the name snapshot and
-- original location verbatim; do not invent Staff ids or parse ambiguous addresses.
UPDATE public.hrms_application_interviews SET
  meeting_link = CASE WHEN type = 'Online' THEN location END,
  address = CASE WHEN type = 'In person' THEN location END;
-- location is retained for the existing profile caller during the UI migration.
ALTER TABLE public.hrms_application_interviews ALTER COLUMN location SET DEFAULT '';
ALTER TABLE public.hrms_application_interviews DROP CONSTRAINT hrms_application_interviews_location_check;
