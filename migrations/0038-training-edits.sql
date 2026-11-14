-- Editing a Training. A change to the date, time, Mode or venue is a reschedule: it is recorded as a "Schedule changed"
-- event (with what it was and what it became, and whether Employees were notified), and Employees without an email are
-- flagged "Reprint needed" because the schedule they were handed on paper is now out of date. Reprinting clears the flag
-- (built with Print schedule, #387).
ALTER TABLE public.hrms_training_assignments ADD COLUMN reprint_needed boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.hrms_training_events (
  id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  training_id integer NOT NULL REFERENCES public.hrms_trainings (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('Schedule changed')),
  -- { from: { date, startTime, endTime, mode, location }, to: { ... } }
  detail jsonb NOT NULL,
  notified boolean NOT NULL,
  notified_count integer NOT NULL DEFAULT 0,
  needs_printed integer NOT NULL DEFAULT 0,
  actor_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS hrms_training_events_training ON public.hrms_training_events (training_id, created_at DESC, id DESC);
