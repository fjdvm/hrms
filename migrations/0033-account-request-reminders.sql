-- Remind admin (#342): a reminder is an event that can repeat (at most once per 24 hours), so it is the one status
-- exempt from "one event per request and status" (0032). The six contract statuses keep that guarantee.
ALTER TABLE public.hrms_account_request_events DROP CONSTRAINT IF EXISTS hrms_account_request_events_status_check;
ALTER TABLE public.hrms_account_request_events ADD CONSTRAINT hrms_account_request_events_status_check
  CHECK (status IN ('requested','seen','account_created','login_sent','cancelled','declined','reminded'));
DROP INDEX public.hrms_account_request_events_one_per_status;
CREATE UNIQUE INDEX hrms_account_request_events_one_per_status
  ON public.hrms_account_request_events (request_id, status) WHERE status <> 'reminded';
