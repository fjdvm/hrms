ALTER TABLE public.hrms_application_notifications ADD COLUMN channel text NOT NULL DEFAULT 'careers' CHECK (channel IN ('careers', 'email'));

-- A VOLATILE function takes a fresh snapshot after acquiring the lock. Keeping
-- lock and overlap query in separate statements matters under READ COMMITTED.
CREATE OR REPLACE FUNCTION public.hrms_save_interview(p_application integer, p_interview bigint, p_details jsonb, p_actor text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  current_stage text;
  existing public.hrms_application_interviews%ROWTYPE;
  booked_id bigint;
  busy jsonb;
  clashes jsonb;
BEGIN
  -- Serialize bookings/reschedules, including changes of Interviewer. No extension
  -- or connection-scoped transaction is needed by the Applications interface.
  PERFORM pg_advisory_xact_lock(730032);
  PERFORM id FROM public.applications WHERE id = p_application FOR UPDATE;
  PERFORM id FROM public.hrms_manual_applications WHERE id = p_application FOR UPDATE;
  SELECT stage INTO current_stage FROM public.hrms_all_applications WHERE id = p_application;
  IF current_stage IS NULL THEN RETURN jsonb_build_object('error', 'not-found'); END IF;
  IF current_stage <> 'Interview' THEN RETURN jsonb_build_object('error', 'conflict', 'detail', 'Application must be in the Interview Stage.'); END IF;
  SELECT * INTO existing FROM public.hrms_application_interviews WHERE application_id = p_application FOR UPDATE;
  IF p_interview IS NULL AND existing.id IS NOT NULL THEN
    RETURN jsonb_build_object('error', 'conflict', 'detail', 'Application already has an Interview.');
  END IF;
  IF p_interview IS NOT NULL THEN
    IF existing.id IS NULL OR existing.id <> p_interview THEN RETURN jsonb_build_object('error', 'not-found'); END IF;
    IF existing.result IS NOT NULL THEN RETURN jsonb_build_object('error', 'conflict', 'detail', 'An Interview with a result cannot be rescheduled.'); END IF;
  END IF;
  IF (p_details->>'startsAt')::timestamptz <= clock_timestamp() THEN
    RETURN jsonb_build_object('error', 'validation', 'detail', 'Start must be in the future.');
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('applicantName', a.applicant_name, 'startsAt', i.starts_at, 'endsAt', i.ends_at)), '[]'::jsonb)
    INTO busy FROM public.hrms_application_interviews i JOIN public.hrms_all_applications a ON a.id = i.application_id
    WHERE i.interviewer_id = p_details->>'interviewerId' AND (p_interview IS NULL OR i.id <> p_interview)
      AND (a.stage = 'Interview' OR i.result IS NOT NULL);
  SELECT COALESCE(jsonb_agg(value), '[]'::jsonb) INTO clashes FROM jsonb_array_elements(busy)
    WHERE (value->>'startsAt')::timestamptz < (p_details->>'endsAt')::timestamptz
      AND (value->>'endsAt')::timestamptz > (p_details->>'startsAt')::timestamptz;
  IF jsonb_array_length(clashes) > 0 THEN
    RETURN jsonb_build_object('error', 'conflict', 'busy', busy, 'conflicts', clashes);
  END IF;
  IF p_interview IS NULL THEN
    INSERT INTO public.hrms_application_interviews (application_id, starts_at, ends_at, type, interviewer_name, interviewer_id, location, meeting_link, map_link, province, city, address)
      VALUES (p_application, (p_details->>'startsAt')::timestamptz, (p_details->>'endsAt')::timestamptz, p_details->>'type', p_details->>'interviewerName', p_details->>'interviewerId',
        COALESCE(p_details->>'location', ''), p_details->>'meetingLink', p_details->>'mapLink', p_details->>'province', p_details->>'city', p_details->>'address') RETURNING id INTO booked_id;
  ELSE
    UPDATE public.hrms_application_interviews SET starts_at = (p_details->>'startsAt')::timestamptz, ends_at = (p_details->>'endsAt')::timestamptz,
      type = p_details->>'type', interviewer_name = p_details->>'interviewerName', interviewer_id = p_details->>'interviewerId', location = COALESCE(p_details->>'location', ''),
      meeting_link = p_details->>'meetingLink', map_link = p_details->>'mapLink', province = p_details->>'province', city = p_details->>'city', address = p_details->>'address'
      WHERE id = p_interview RETURNING id INTO booked_id;
  END IF;
  INSERT INTO public.hrms_application_activity(application_id, from_stage, to_stage, actor_name, interview_id, reason, occurred_at)
    VALUES (p_application, 'Interview', 'Interview', p_actor, booked_id, CASE WHEN p_interview IS NOT NULL THEN 'Interview rescheduled' END, clock_timestamp());
  -- Older deployed callers may omit notification during the migration/deploy window.
  IF p_details->'notification' IS NOT NULL THEN
  -- The Interview and both delivery intents commit together. Retries never rebook it.
  INSERT INTO public.hrms_application_notifications(id, channel, payload)
    SELECT 'interview.email:' || (p_details->'notification'->>'eventId'), 'email',
      jsonb_build_object('to', a.applicant_email, 'app', 'HRMS',
        'title', p_details->'notification'->>'title', 'body', p_details->'notification'->>'body')
      || CASE WHEN p_details->>'type' = 'Online' THEN jsonb_build_object('button',
        jsonb_build_object('label', 'Join meeting', 'link', p_details->>'meetingLink'))
      WHEN p_details->>'mapLink' IS NOT NULL THEN jsonb_build_object('button',
        jsonb_build_object('label', 'View map', 'link', p_details->>'mapLink')) ELSE '{}'::jsonb END
    FROM public.hrms_all_applications a WHERE a.id = p_application;
  INSERT INTO public.hrms_application_notifications(id, payload)
    SELECT 'interview.careers:' || (p_details->'notification'->>'eventId'),
      jsonb_build_object('sendingApp', 'hrms', 'targetApp', 'careers', 'userIds', jsonb_build_array(c.applicant_id),
        'type', 'interview.invite', 'title', p_details->'notification'->>'title',
        'body', p_details->'notification'->>'body',
        'idempotencyKey', 'interview.careers:' || (p_details->'notification'->>'eventId'))
    FROM (
      SELECT applicant_id FROM public.applications WHERE id = p_application
      UNION
      SELECT p.applicant_id FROM public.hrms_manual_applications m
        JOIN public.applicant_profiles p ON lower(p.email) = lower(m.email)
        WHERE m.id = p_application
    ) c WHERE EXISTS (SELECT 1 FROM neon_auth."user" u WHERE u.id::text = c.applicant_id);
  END IF;
  RETURN jsonb_build_object('id', booked_id);
END;
$$;
