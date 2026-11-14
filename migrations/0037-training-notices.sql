-- Training notices: one row per Employee per notice, with its delivery state. HRMS owns this table.
-- Employees without an email never get a row (they appear under "Needs printed schedule", derived from the assignment),
-- so a notice is never Failed for lack of an address.
-- attempts counts failed sends. A Retrying notice goes out again at next_attempt_at (about 15 minutes later); after the
-- third retry fails it is Failed, which is what the log calls Not reached. Retry on a Failed notice starts the cycle again.
CREATE TABLE IF NOT EXISTS public.hrms_training_notices (
  id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  training_id integer NOT NULL REFERENCES public.hrms_trainings (id) ON DELETE CASCADE,
  employee_id integer NOT NULL REFERENCES public.hrms_employees (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('Assignment', 'Schedule changed', 'Cancelled', 'Reminder')),
  -- Queued is only the moment before the first send; the log shows Sent, Retrying and Failed.
  state text NOT NULL DEFAULT 'Queued' CHECK (state IN ('Queued', 'Sent', 'Retrying', 'Failed')),
  email text NOT NULL CHECK (length(btrim(email)) > 0),
  payload jsonb NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz,
  last_attempt_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS hrms_training_notices_due ON public.hrms_training_notices (next_attempt_at, id) WHERE state IN ('Queued', 'Retrying');
CREATE INDEX IF NOT EXISTS hrms_training_notices_training ON public.hrms_training_notices (training_id, created_at DESC, id DESC);
