-- A structured shift on the Employee record, for Performance scoring. One fixed shift per Employee: the same hours on
-- every Working day. Additive and nullable; the free-text schedule is left as it is and never parsed.
-- Working days are ISO weekdays: 1 = Monday ... 7 = Sunday. An Employee has either the whole shift or none of it.
ALTER TABLE public.hrms_employees
  ADD COLUMN IF NOT EXISTS shift_start time,
  ADD COLUMN IF NOT EXISTS shift_end time,
  ADD COLUMN IF NOT EXISTS working_days smallint[];

-- Reviewed backfill: only the Employees whose schedule text is exactly "Mon-Sat, 6 AM-2 PM". Every other Employee,
-- including the Mon-Fri ones, stays empty until HR sets their shift.
-- The change trigger is off for the backfill: it is a data fix, not an edit by HR, so it adds no history or audit rows.
ALTER TABLE public.hrms_employees DISABLE TRIGGER hrms_employee_changes;
UPDATE public.hrms_employees
SET shift_start = '06:00', shift_end = '14:00', working_days = ARRAY[1,2,3,4,5,6]::smallint[]
WHERE btrim(schedule) = 'Mon-Sat, 6 AM-2 PM';
ALTER TABLE public.hrms_employees ENABLE TRIGGER hrms_employee_changes;

-- Constraints go on after the backfill. A bypassing request still hits them, whatever the form allows.
ALTER TABLE public.hrms_employees
  ADD CONSTRAINT hrms_employee_shift_complete CHECK (
    (shift_start IS NULL AND shift_end IS NULL AND working_days IS NULL)
    OR (shift_start IS NOT NULL AND shift_end IS NOT NULL AND working_days IS NOT NULL)),
  -- Overnight shifts are refused: the end must be after the start.
  ADD CONSTRAINT hrms_employee_shift_order CHECK (shift_end IS NULL OR shift_start IS NULL OR shift_end > shift_start),
  ADD CONSTRAINT hrms_employee_working_days CHECK (
    working_days IS NULL OR (cardinality(working_days) BETWEEN 1 AND 7 AND working_days <@ ARRAY[1,2,3,4,5,6,7]::smallint[]));

-- A shift change is recorded in the Employee history like the other employment edits.
CREATE OR REPLACE FUNCTION public.hrms_employee_changes() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  previous jsonb := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE '{}'::jsonb END;
  current_row jsonb := to_jsonb(NEW);
  employee integer;
  item record;
  field_name text;
  actor text := COALESCE(NULLIF(current_setting('hrms.actor_name',true),''),'System');
  actor_id text := COALESCE(NULLIF(current_setting('hrms.actor_id',true),''),'system');
  effective date;
BEGIN
  employee := (current_row->>CASE WHEN TG_TABLE_NAME = 'hrms_employees' THEN 'id' ELSE 'employee_id' END)::integer;
  IF TG_TABLE_NAME = 'hrms_employees' AND TG_OP = 'INSERT' THEN
    INSERT INTO public.hrms_employee_history(employee_id,actor_name,kind,field,new_value,effective_date,occurred_at)
    VALUES(employee,NEW.hired_by_name,'Hired','terms',jsonb_build_object('position',NEW.position,'department',NEW.department,'branch',NEW.branch,'employmentType',NEW.employment_type,'reportsTo',NEW.reports_to,'monthlyPay',NEW.monthly_salary,'schedule',NEW.schedule,'probation',NEW.probation,'startDate',NEW.start_date),NEW.start_date,NEW.created_at);
    RETURN NEW;
  END IF;
  effective := COALESCE(NULLIF(current_setting('hrms.effective_date',true),'')::date,(clock_timestamp() AT TIME ZONE 'Asia/Manila')::date);
  FOR item IN SELECT key,value FROM jsonb_each(current_row) LOOP
    IF item.key IN ('id','employee_id','created_at') OR item.value IS NOT DISTINCT FROM COALESCE(previous->item.key,'null'::jsonb) THEN CONTINUE; END IF;
    field_name := CASE item.key WHEN 'full_name' THEN 'name' WHEN 'civil_status' THEN 'civilStatus'
      WHEN 'home_address' THEN 'homeAddress' WHEN 'start_date' THEN 'startDate' WHEN 'probation_end_date' THEN 'probationEndDate'
      WHEN 'employment_type' THEN 'employmentType' WHEN 'reports_to' THEN 'reportsTo' WHEN 'monthly_salary' THEN 'monthlyPay'
      WHEN 'pagibig_mid' THEN 'pagibigMid'
      WHEN 'shift_start' THEN 'shiftStart' WHEN 'shift_end' THEN 'shiftEnd' WHEN 'working_days' THEN 'workingDays' ELSE item.key END;
    INSERT INTO public.hrms_employee_audit(employee_id,actor_id,actor_name,kind,field,old_value,new_value)
    VALUES(employee,actor_id,actor,CASE WHEN item.key = 'status' THEN 'status' ELSE 'edit' END,field_name,previous->item.key,item.value);
    IF TG_TABLE_NAME = 'hrms_employees' AND item.key IN ('position','department','branch','employment_type','reports_to','monthly_salary','shift_start','shift_end','working_days') THEN
      INSERT INTO public.hrms_employee_history(employee_id,actor_name,kind,field,old_value,new_value,effective_date)
      VALUES(employee,actor,'Changed',field_name,previous->item.key,item.value,effective);
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
