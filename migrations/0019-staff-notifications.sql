-- HRMS Staff Notifications: a durable queue of "something happened" events, filled by triggers in
-- the same transaction as the change (Careers inserts applications directly, so a trigger is the
-- only place that sees every one). The audience is resolved at delivery, never stored here.
CREATE TABLE IF NOT EXISTS public.hrms_staff_notifications (
  id text PRIMARY KEY,
  payload jsonb NOT NULL,
  delivered_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hrms_staff_notifications_due_idx
  ON public.hrms_staff_notifications(next_attempt_at, id) WHERE delivered_at IS NULL;

CREATE OR REPLACE FUNCTION public.hrms_queue_application_received() RETURNS trigger AS $$
BEGIN
  INSERT INTO public.hrms_staff_notifications (id, payload)
  SELECT 'application.received:' || a.id, jsonb_build_object(
    'type', 'application.received',
    'title', 'New application: ' || a.applicant_name,
    'body', a.applicant_name || ' applied for ' || a.job_posting_title || '.',
    'link', '/applicants/' || a.id)
  FROM public.hrms_all_applications a WHERE a.id = NEW.id
  ON CONFLICT (id) DO NOTHING;
  RETURN NULL;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS hrms_careers_application_received ON public.applications;
CREATE TRIGGER hrms_careers_application_received AFTER INSERT ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.hrms_queue_application_received();
DROP TRIGGER IF EXISTS hrms_manual_application_received ON public.hrms_manual_applications;
CREATE TRIGGER hrms_manual_application_received AFTER INSERT ON public.hrms_manual_applications
  FOR EACH ROW EXECUTE FUNCTION public.hrms_queue_application_received();

CREATE OR REPLACE FUNCTION public.hrms_queue_posting_status() RETURNS trigger AS $$
DECLARE kind text := CASE WHEN NEW.status = 'open' THEN 'published' ELSE 'closed' END;
BEGIN
  INSERT INTO public.hrms_staff_notifications (id, payload)
  VALUES ('job-posting.' || kind || ':' || NEW.id, jsonb_build_object(
    'type', 'job-posting.' || kind,
    'title', 'Job posting ' || kind || ': ' || NEW.title,
    'body', 'The job posting "' || NEW.title || '" was ' || kind || '.',
    'link', '/job-postings/' || NEW.id))
  ON CONFLICT (id) DO NOTHING;
  RETURN NULL;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS hrms_posting_published ON public.job_postings;
CREATE TRIGGER hrms_posting_published AFTER UPDATE OF status ON public.job_postings
  FOR EACH ROW WHEN (OLD.status = 'draft' AND NEW.status = 'open') EXECUTE FUNCTION public.hrms_queue_posting_status();
DROP TRIGGER IF EXISTS hrms_posting_closed ON public.job_postings;
CREATE TRIGGER hrms_posting_closed AFTER UPDATE OF status ON public.job_postings
  FOR EACH ROW WHEN (OLD.status = 'open' AND NEW.status = 'closed') EXECUTE FUNCTION public.hrms_queue_posting_status();
