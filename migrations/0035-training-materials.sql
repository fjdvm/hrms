-- Training materials: Private, Permanent Files in file-storage (ADR-0003), attached to a Training here.
-- A row is Pending from the moment HRMS asks file-storage for an upload address until the upload is confirmed.
-- training_id is NULL while the file is uploaded on the New training form, before the Training is saved.
CREATE TABLE IF NOT EXISTS public.hrms_training_materials (
  file_id text PRIMARY KEY,
  training_id integer REFERENCES public.hrms_trainings (id) ON DELETE CASCADE,
  filename text NOT NULL CHECK (length(btrim(filename)) > 0),
  content_type text NOT NULL,
  size integer NOT NULL CHECK (size > 0),
  status text NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Active')),
  uploaded_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS hrms_training_materials_training ON public.hrms_training_materials (training_id);
