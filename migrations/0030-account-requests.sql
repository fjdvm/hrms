-- Account requests (#332): one row per request, one event per step. The table itself came with 0028.
-- A request is active from "requested" until it is cancelled or declined; "login_sent" follows "account_created",
-- so it stays active too: the person has an account and must not get a second request.

CREATE TABLE public.hrms_account_request_events (
  id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  request_id integer NOT NULL REFERENCES public.hrms_account_requests(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('requested','seen','account_created','login_sent','cancelled','declined')),
  actor_name text NOT NULL,
  reason text,
  message text,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX ON public.hrms_account_request_events (request_id, occurred_at, id);

-- At most one active request per Employee record, and one active request per work email.
CREATE UNIQUE INDEX hrms_account_requests_one_active
  ON public.hrms_account_requests (employee_id) WHERE status IN ('requested','seen','account_created','login_sent');
CREATE UNIQUE INDEX hrms_account_requests_active_work_email
  ON public.hrms_account_requests (lower(work_email)) WHERE status IN ('requested','seen','account_created','login_sent');
