ALTER TABLE public.hrms_employee_audit ADD COLUMN old_value jsonb, ADD COLUMN new_value jsonb;
CREATE TABLE public.hrms_employee_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_id integer NOT NULL REFERENCES public.hrms_employees(id),
  actor_name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('Hired','Changed')),
  field text NOT NULL,
  old_value jsonb,
  new_value jsonb,
  effective_date date NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX ON public.hrms_employee_audit(employee_id,occurred_at DESC,id DESC);
CREATE INDEX ON public.hrms_employee_history(employee_id,occurred_at DESC,id DESC);

CREATE FUNCTION public.hrms_employee_changes() RETURNS trigger LANGUAGE plpgsql AS $$
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
    VALUES(employee,NEW.hired_by_name,'Hired','terms',jsonb_build_object('position',NEW.position,'department',NEW.department,'branch',NEW.branch,'employmentType',NEW.employment_type,'reportsTo',NEW.reports_to,'monthlyPay',NEW.monthly_salary),NEW.start_date,NEW.created_at);
    RETURN NEW;
  END IF;
  effective := COALESCE(NULLIF(current_setting('hrms.effective_date',true),'')::date,(clock_timestamp() AT TIME ZONE 'Asia/Manila')::date);
  FOR item IN SELECT key,value FROM jsonb_each(current_row) LOOP
    IF item.key IN ('id','employee_id','created_at') OR item.value IS NOT DISTINCT FROM COALESCE(previous->item.key,'null'::jsonb) THEN CONTINUE; END IF;
    field_name := CASE item.key WHEN 'full_name' THEN 'name' WHEN 'civil_status' THEN 'civilStatus'
      WHEN 'home_address' THEN 'homeAddress' WHEN 'start_date' THEN 'startDate' WHEN 'probation_end_date' THEN 'probationEndDate'
      WHEN 'employment_type' THEN 'employmentType' WHEN 'reports_to' THEN 'reportsTo' WHEN 'monthly_salary' THEN 'monthlyPay'
      WHEN 'pagibig_mid' THEN 'pagibigMid' ELSE item.key END;
    INSERT INTO public.hrms_employee_audit(employee_id,actor_id,actor_name,kind,field,old_value,new_value)
    VALUES(employee,actor_id,actor,CASE WHEN item.key = 'status' THEN 'status' ELSE 'edit' END,field_name,previous->item.key,item.value);
    IF TG_TABLE_NAME = 'hrms_employees' AND item.key IN ('position','department','branch','employment_type','reports_to','monthly_salary') THEN
      INSERT INTO public.hrms_employee_history(employee_id,actor_name,kind,field,old_value,new_value,effective_date)
      VALUES(employee,actor,'Changed',field_name,previous->item.key,item.value,effective);
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
CREATE TRIGGER hrms_employee_changes AFTER INSERT OR UPDATE ON public.hrms_employees FOR EACH ROW EXECUTE FUNCTION public.hrms_employee_changes();
CREATE TRIGGER hrms_employee_id_changes AFTER INSERT OR UPDATE ON public.hrms_employee_government_ids FOR EACH ROW EXECUTE FUNCTION public.hrms_employee_changes();
CREATE TRIGGER hrms_employee_contact_changes AFTER INSERT OR UPDATE ON public.hrms_employee_emergency_contacts FOR EACH ROW EXECUTE FUNCTION public.hrms_employee_changes();
INSERT INTO public.hrms_employee_history(employee_id,actor_name,kind,field,new_value,effective_date,occurred_at)
SELECT id,hired_by_name,'Hired','terms',jsonb_build_object('position',position,'department',department,'branch',branch,'employmentType',employment_type,'reportsTo',reports_to,'monthlyPay',monthly_salary),start_date,created_at FROM public.hrms_employees;
-- NOT VALID leaves historical records untouched while validating all subsequent writes.
ALTER TABLE public.hrms_employees ADD CONSTRAINT hrms_employee_probation_dates
  CHECK (probation_end_date IS NULL OR probation_end_date >= start_date) NOT VALID;
