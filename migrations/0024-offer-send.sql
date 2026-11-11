-- Sending an Offer: its history, and the emails queued for the Applicant.
-- Both are HRMS-owned. next_attempt_at is when the email may go out, so the same outbox
-- handles "now" and a later time, and failures retry with backoff.
CREATE TABLE IF NOT EXISTS public.hrms_offer_activity (
  id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  offer_id integer NOT NULL REFERENCES public.hrms_offers(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('sent', 'reply-by-extended', 'email-scheduled', 'email-sent')),
  actor_name text,
  detail text,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS hrms_offer_activity_timeline ON public.hrms_offer_activity (offer_id, occurred_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS public.hrms_offer_emails (
  id text PRIMARY KEY,
  offer_id integer NOT NULL REFERENCES public.hrms_offers(id) ON DELETE CASCADE,
  payload jsonb NOT NULL,
  delivered_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS hrms_offer_emails_due ON public.hrms_offer_emails (next_attempt_at, id) WHERE delivered_at IS NULL;
