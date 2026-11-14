-- Trainings: one dated session each, with one time and one venue or meeting link. HRMS owns these tables.
-- Status is never stored: it is derived from the date (Manila time) and cancelled_at.
CREATE TABLE IF NOT EXISTS public.hrms_trainings (
  id integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  title text NOT NULL CHECK (length(btrim(title)) > 0),
  trainer text NOT NULL CHECK (length(btrim(trainer)) > 0),
  description text NOT NULL DEFAULT '',
  objectives text NOT NULL DEFAULT '',
  training_date date NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL CHECK (end_time > start_time),
  mode text NOT NULL CHECK (mode IN ('Online', 'In person')),
  -- A meeting link when Online, a venue when In person.
  location text NOT NULL CHECK (length(btrim(location)) > 0),
  -- The date before the latest reschedule, for the "Rescheduled from" caption.
  rescheduled_from date,
  cancelled_at timestamptz,
  cancel_reason text,
  created_by_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS hrms_trainings_date ON public.hrms_trainings (training_date, start_time);

-- Assigned employees per Training, with a status each. Assigning is built in a later slice; the list counts read this table.
CREATE TABLE IF NOT EXISTS public.hrms_training_assignments (
  training_id integer NOT NULL REFERENCES public.hrms_trainings (id) ON DELETE CASCADE,
  employee_id integer NOT NULL,
  status text NOT NULL DEFAULT 'Assigned' CHECK (status IN ('Assigned', 'Completed', 'Did not attend', 'Cancelled')),
  completed_on date,
  PRIMARY KEY (training_id, employee_id)
);
