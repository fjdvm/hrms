-- Recording an Applicant's reply: when it came in, and the two new kinds of history it writes.
ALTER TABLE public.hrms_offers ADD COLUMN IF NOT EXISTS replied_at timestamptz;
ALTER TABLE public.hrms_offer_activity DROP CONSTRAINT IF EXISTS hrms_offer_activity_kind_check;
ALTER TABLE public.hrms_offer_activity ADD CONSTRAINT hrms_offer_activity_kind_check
  CHECK (kind IN ('sent', 'reply-by-extended', 'email-scheduled', 'email-sent', 'accepted', 'declined'));
