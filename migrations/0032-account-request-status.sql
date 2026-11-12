-- Portal status webhook (#336): one event per request and status, so a repeated or out-of-order delivery records nothing twice.
CREATE UNIQUE INDEX hrms_account_request_events_one_per_status ON public.hrms_account_request_events (request_id, status);
