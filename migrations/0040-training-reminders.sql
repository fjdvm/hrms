-- Automatic Reminder notices. The scheduled job queues one per assigned Employee 1 day before the Training at 8:00 AM Manila
-- time. automatic_for is the Training date that reminder is for: it marks the notice as automatic (a manual "Send reminder"
-- leaves it empty) and, with the index below, makes the job safe to repeat or overlap. A Training moved to a new date is
-- reminded again for the new date.
ALTER TABLE public.hrms_training_notices ADD COLUMN automatic_for date;
CREATE UNIQUE INDEX IF NOT EXISTS hrms_training_notices_automatic_reminder
  ON public.hrms_training_notices (training_id, employee_id, automatic_for)
  WHERE kind = 'Reminder' AND automatic_for IS NOT NULL;
