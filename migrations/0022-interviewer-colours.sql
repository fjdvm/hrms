-- Serialize allocations so concurrent directory reads consume the palette in order.
CREATE TABLE public.hrms_interviewer_colour_guard (id boolean PRIMARY KEY CHECK (id));
INSERT INTO public.hrms_interviewer_colour_guard VALUES (true);
CREATE TABLE public.hrms_interviewer_colours (
  staff_id text PRIMARY KEY,
  colour_index integer NOT NULL CHECK (colour_index BETWEEN 0 AND 5)
);

CREATE FUNCTION public.hrms_assign_interviewer_colours(staff_ids text[])
RETURNS TABLE (staff_id text, colour_index integer)
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  member_id text;
BEGIN
  PERFORM 1 FROM public.hrms_interviewer_colour_guard FOR UPDATE;
  FOREACH member_id IN ARRAY staff_ids LOOP
    IF NOT EXISTS (SELECT 1 FROM public.hrms_interviewer_colours c WHERE c.staff_id = member_id) THEN
      INSERT INTO public.hrms_interviewer_colours (staff_id, colour_index)
      SELECT member_id, (count(*) % 6)::integer FROM public.hrms_interviewer_colours;
    END IF;
  END LOOP;
  RETURN QUERY SELECT c.staff_id, c.colour_index FROM public.hrms_interviewer_colours c
    WHERE c.staff_id = ANY(staff_ids);
END;
$$;
