import { database, type Database } from "./database";
import { accessFor } from "./portal/access";
import { assignmentEmail, queueNotice, reminderEmail, scheduleChangedEmail, type NoticeTraining } from "./training-notices";
import { gatewayMaterialFiles, type MaterialFiles } from "./training-material-files";
import {
  TRAINING_TABS, cancelledEmail, completionOf, formatMonth, readFeedback, readResultMarks, manilaToday, materialProblem, readCancelReason, readTrainingForm, tabOf, trainingStatus,
  HISTORY_TABS, MAX_SCHEDULE_TRAININGS, historyRowsFor, type PrintableTraining, type ScheduleItem, type ScheduleSheet, type HistoryEmployee, type HistoryRow, type HistoryTab, type TrainingHistory,
  scheduleDiffers, type LogEvent, type LogRow, type LogTab, type NotificationLog, type ScheduleChange, type UpdateResult,
  type AssignableEmployee, type AssignedEmployee, type AssignRequest, type AssignResult, type CancelRequest, type CancelResult, type MarkResultsResult, type ReminderResult, type TrainingFeedback, type ResultMark, type MaterialRequest, type TrainingMaterial, type TrainingMode, type TrainingStatus, type TrainingCompletion, type TrainingTab, type TrainingTerms,
} from "./training-terms";

export type TrainingListItem = {
  id: number;
  title: string;
  trainer: string;
  date: string;
  startTime: string;
  endTime: string;
  mode: TrainingMode;
  /** The date before the latest reschedule, when there was one. */
  rescheduledFrom: string | null;
  hasMaterials: boolean;
  assigned: number;
  completed: number;
  /** A Training whose date has passed, with Assigned employees and no result recorded yet. */
  resultsNotRecorded: boolean;
  status: TrainingStatus;
};
export type CalendarTraining = {
  id: number;
  title: string;
  trainer: string;
  date: string;
  startTime: string;
  endTime: string;
  /** Tells Online from In person apart on the Calendar. */
  mode: TrainingMode;
  /** A meeting link when Online, a venue when In person. */
  location: string;
  rescheduledFrom: string | null;
  assigned: number;
  status: TrainingStatus;
};
export type TrainingPage = {
  rows: TrainingListItem[];
  counts: Record<TrainingTab, number>;
  /** Trainings dated in the current month (Manila time), whatever their status. */
  thisMonth: number;
  /** The month Training completion covers, e.g. "November 2026" (Manila time). */
  month: string;
  /** Null when no Training was held this month, so the card says "Nothing to show yet". */
  completion: TrainingCompletion | null;
  /** Trainings held this month with Assigned employees and no result recorded yet, oldest first. */
  needResults: { id: number; title: string }[];
};

/** Everything the Training page shows. */
export type TrainingDetail = TrainingTerms & {
  id: number;
  status: TrainingStatus;
  rescheduledFrom: string | null;
  /** Employees whose result is recorded (Completed or Did not attend). From the first one the date, time and venue are locked. */
  recordedResults: number;
  /** Why Staff cancelled it; set only when the status is Cancelled. */
  cancelReason: string | null;
  /** Objectives, one per line, as a list. */
  objectiveList: string[];
  materials: TrainingMaterial[];
  assigned: AssignedEmployee[];
};

export class TrainingError extends Error {
  constructor(public readonly reason: "denied" | "invalid" | "unavailable" | "validation" | "not-found" | "conflict" | "locked" | "early") {
    super(`Training: ${reason}`);
  }
}

type Row = {
  id: number; title: string; trainer: string; date: string; startTime: string; endTime: string; mode: TrainingMode;
  rescheduledFrom: string | null; cancelled: boolean; hasMaterials: boolean; assigned: number; completed: number; recorded: number; due: number;
};

const SELECT = `
  SELECT t.id, t.title, t.trainer, t.training_date::text AS date, to_char(t.start_time, 'HH24:MI') AS "startTime",
    to_char(t.end_time, 'HH24:MI') AS "endTime", t.mode, t.rescheduled_from::text AS "rescheduledFrom",
    t.cancelled_at IS NOT NULL AS cancelled,
    EXISTS (SELECT 1 FROM public.hrms_training_materials m WHERE m.training_id = t.id AND m.status = 'Active') AS "hasMaterials",
    count(a.employee_id)::int AS assigned,
    (count(a.employee_id) FILTER (WHERE a.status = 'Completed'))::int AS completed,
    (count(a.employee_id) FILTER (WHERE a.status NOT IN ('Assigned', 'Cancelled')))::int AS recorded,
    (count(a.employee_id) FILTER (WHERE a.status <> 'Cancelled'))::int AS due
  FROM public.hrms_trainings t
  LEFT JOIN public.hrms_training_assignments a ON a.training_id = t.id
  GROUP BY t.id`;

/** Upcoming first, soonest first; then Past and Cancelled, most recent first. */
const order = (a: TrainingListItem, b: TrainingListItem) => {
  const rank = (item: TrainingListItem) => (item.status === "Upcoming" ? 0 : 1);
  if (rank(a) !== rank(b)) return rank(a) - rank(b);
  const key = (item: TrainingListItem) => `${item.date} ${item.startTime}`;
  if (a.status === "Upcoming") return key(a).localeCompare(key(b)) || a.id - b.id;
  return key(b).localeCompare(key(a)) || b.id - a.id;
};

/** Server-side boundary. Rechecks the Portal on every operation; `now` is injectable so tests control the clock. */
export function trainingsFor(sessionHandle: string | undefined, db: Database = database, now: () => Date = () => new Date(), files: MaterialFiles = gatewayMaterialFiles()) {
  async function authorise() {
    const access = await accessFor(sessionHandle).check("Training");
    if (access.decision !== "allowed") throw new TrainingError(access.decision);
    return access.staff;
  }

  const validId = (id: unknown) => Number.isInteger(id) && (id as number) > 0 && (id as number) <= 2_147_483_647;
  const unavailable = (error: unknown): never => { throw error instanceof TrainingError ? error : new TrainingError("unavailable"); };

  async function buildSchedule(trainingIds: number[], includeNames: boolean, printedBy: string): Promise<ScheduleSheet> {
    const ids = [...new Set(trainingIds)];
    if (ids.length === 0 || ids.length > MAX_SCHEDULE_TRAININGS || !ids.every(validId)) throw new TrainingError("validation");
    const { rows } = await db.query<Omit<ScheduleItem, "assigned" | "assignedCount"> & { cancelled: boolean }>(`
      SELECT id, title, trainer, training_date::text AS date, to_char(start_time, 'HH24:MI') AS "startTime", to_char(end_time, 'HH24:MI') AS "endTime",
        mode, location, cancelled_at IS NOT NULL AS cancelled
      FROM public.hrms_trainings WHERE id = ANY($1::int[]) ORDER BY training_date, start_time, id`, [ids]);
    if (rows.length !== ids.length) throw new TrainingError("not-found");
    if (rows.some((row) => row.cancelled)) throw new TrainingError("conflict");
    const { rows: people } = await db.query<{ trainingId: number; employeeId: number; name: string; email: string | null }>(`
      SELECT a.training_id AS "trainingId", e.id AS "employeeId", e.full_name AS name, NULLIF(btrim(e.email), '') AS email
      FROM public.hrms_training_assignments a JOIN public.hrms_employees e ON e.id = a.employee_id
      WHERE a.training_id = ANY($1::int[]) AND a.status <> 'Cancelled' ORDER BY e.full_name, e.id`, [ids]);
    const items: ScheduleItem[] = rows.map(({ cancelled, ...row }) => {
      void cancelled;
      const names = people.filter((person) => person.trainingId === row.id).map((person) => person.name);
      return { ...row, assignedCount: names.length, assigned: includeNames ? names : null };
    });
    const needPrinted = [...new Map(people.filter((person) => !person.email).map((person) => [person.employeeId, { employeeId: person.employeeId, name: person.name }])).values()];
    return { printedOn: manilaToday(now()), printedBy, items, includeNames, needPrinted };
  }

  async function requireTraining(id: number) {
    if (!validId(id)) throw new TrainingError("not-found");
    const { rows } = await db.query<{ cancelled: boolean }>(`SELECT cancelled_at IS NOT NULL AS cancelled FROM public.hrms_trainings WHERE id = $1`, [id]);
    if (!rows[0]) throw new TrainingError("not-found");
    return rows[0];
  }

  /** How many Employees have a recorded result (Completed or Did not attend). */
  async function recordedResults(trainingId: number) {
    const { rows } = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.hrms_training_assignments WHERE training_id = $1 AND status NOT IN ('Assigned', 'Cancelled')`, [trainingId]);
    return rows[0].n;
  }

  return {
    /** Every Training in one tab, with all tab counts from the same snapshot. */
    async list(tab: TrainingTab = "All"): Promise<TrainingPage> {
      await authorise();
      if (!TRAINING_TABS.includes(tab)) throw new TrainingError("validation");
      const clock = now();
      const { rows } = await db.query<Row>(SELECT);
      const items: TrainingListItem[] = rows.map((row) => {
        const status = trainingStatus(row, clock);
        return {
          id: row.id, title: row.title, trainer: row.trainer, date: row.date, startTime: row.startTime, endTime: row.endTime,
          mode: row.mode, rescheduledFrom: row.rescheduledFrom, hasMaterials: row.hasMaterials,
          assigned: row.assigned, completed: row.completed,
          resultsNotRecorded: status === "Completed" && row.due > 0 && row.recorded === 0, status,
        };
      });
      const counts: Record<TrainingTab, number> = { All: items.length, Upcoming: 0, Past: 0, Cancelled: 0 };
      for (const item of items) counts[tabOf(item.status)] += 1;
      const today = manilaToday(clock);
      const month = today.slice(0, 7);
      // Held = its date has passed (status Completed). Results due = Assigned employees who are not Cancelled.
      const held = rows.filter((row, index) => row.date.startsWith(month) && items[index].status === "Completed");
      const dueCount = held.reduce((sum, row) => sum + row.due, 0);
      const completedCount = held.reduce((sum, row) => sum + row.completed, 0);
      return {
        counts,
        month: formatMonth(today),
        completion: completionOf(completedCount, dueCount),
        needResults: items.filter((item) => item.date.startsWith(month) && item.resultsNotRecorded)
          .sort((a, b) => `${a.date} ${a.startTime}`.localeCompare(`${b.date} ${b.startTime}`) || a.id - b.id).map((item) => ({ id: item.id, title: item.title })),
        thisMonth: items.filter((item) => item.date.startsWith(month)).length,
        rows: items.filter((item) => tab === "All" || tabOf(item.status) === tab).sort(order),
      };
    },
    /** Trainings dated in [from, to), both "YYYY-MM-DD" in Manila, soonest first. Cancelled ones are included, marked by status. */
    async calendar(range: { from: string; to: string }): Promise<CalendarTraining[]> {
      await authorise();
      const day = /^\d{4}-\d{2}-\d{2}$/;
      if (!day.test(range.from) || !day.test(range.to) || range.to <= range.from) throw new TrainingError("validation");
      const clock = now();
      const { rows } = await db.query<Row & { location: string }>(`
        SELECT t.id, t.title, t.trainer, t.training_date::text AS date, to_char(t.start_time, 'HH24:MI') AS "startTime",
          to_char(t.end_time, 'HH24:MI') AS "endTime", t.mode, t.location, t.rescheduled_from::text AS "rescheduledFrom",
          t.cancelled_at IS NOT NULL AS cancelled,
          (SELECT count(*)::int FROM public.hrms_training_assignments a WHERE a.training_id = t.id) AS assigned
        FROM public.hrms_trainings t
        WHERE t.training_date >= $1 AND t.training_date < $2
        ORDER BY t.training_date, t.start_time, t.id`, [range.from, range.to]);
      return rows.map((row) => ({
        id: row.id, title: row.title, trainer: row.trainer, date: row.date, startTime: row.startTime, endTime: row.endTime,
        mode: row.mode, location: row.location, rescheduledFrom: row.rescheduledFrom, assigned: row.assigned, status: trainingStatus(row, clock),
      }));
    },
    /** Saves a new Training from the form's raw values; an invalid form is refused, not repaired. */
    async create(terms: TrainingTerms, materialIds: string[] = []): Promise<number> {
      const staff = await authorise();
      const { terms: checked } = readTrainingForm({ ...terms }, manilaToday(now()));
      if (!checked) throw new TrainingError("validation");
      const { rows } = await db.query<{ id: number }>(`
        INSERT INTO public.hrms_trainings
          (title, trainer, description, objectives, training_date, start_time, end_time, mode, location, created_by_name)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
      [checked.title, checked.trainer, checked.description, checked.objectives, checked.date, checked.startTime, checked.endTime, checked.mode, checked.location, staff.name]);
      // Claim this Staff member's confirmed uploads from the form; anyone else's, or already attached, stay untouched.
      if (materialIds.length > 0) {
        await db.query(`UPDATE public.hrms_training_materials SET training_id = $1
          WHERE file_id = ANY($2::text[]) AND training_id IS NULL AND status = 'Active' AND uploaded_by = $3`, [rows[0].id, materialIds, staff.username]);
      }
      return rows[0].id;
    },
    /**
     * Edits a Training. A change to the date, time, Mode or venue is a reschedule: the Training stays Upcoming, keeps its
     * previous date for the "Rescheduled from" caption, records a Schedule changed event, flags no-email Employees
     * "Reprint needed", and (when `notify` is on) queues a Schedule changed email for each assigned Employee with an email.
     */
    async update(id: number, edited: TrainingTerms, { notify }: { notify: boolean }): Promise<UpdateResult> {
      const staff = await authorise();
      if (!validId(id)) throw new TrainingError("not-found");
      const { rows: found } = await db.query<TrainingTerms & { rescheduledFrom: string | null; cancelled: boolean }>(`
        SELECT title, trainer, description, objectives, training_date::text AS date, to_char(start_time, 'HH24:MI') AS "startTime",
          to_char(end_time, 'HH24:MI') AS "endTime", mode, location, rescheduled_from::text AS "rescheduledFrom", cancelled_at IS NOT NULL AS cancelled
        FROM public.hrms_trainings WHERE id = $1`, [id]);
      const current = found[0];
      if (!current) throw new TrainingError("not-found");
      if (current.cancelled) throw new TrainingError("conflict");
      const { terms } = readTrainingForm({ ...edited }, manilaToday(now()), { currentDate: current.date });
      if (!terms) throw new TrainingError("validation");
      const changed = (Object.keys(terms) as (keyof TrainingTerms)[]).some((key) => terms[key] !== current[key]);
      if (!changed) return { changed: false, rescheduled: false, notified: 0, needPrintedSchedule: 0 };
      const rescheduled = scheduleDiffers(terms, current);
      // Once any Employee has a recorded result the date, time, Mode and venue are history: Staff create a new Training instead.
      if (rescheduled && (await recordedResults(id)) > 0) throw new TrainingError("locked");
      // Only a new date makes a "Rescheduled from" caption; a time or venue change keeps whatever was there.
      const rescheduledFrom = terms.date !== current.date ? current.date : current.rescheduledFrom;
      const at = now().toISOString();
      await db.query(`UPDATE public.hrms_trainings SET title = $2, trainer = $3, description = $4, objectives = $5, training_date = $6,
        start_time = $7, end_time = $8, mode = $9, location = $10, rescheduled_from = $11, updated_at = $12::timestamptz WHERE id = $1`,
      [id, terms.title, terms.trainer, terms.description, terms.objectives, terms.date, terms.startTime, terms.endTime, terms.mode, terms.location, rescheduledFrom, at]);
      if (!rescheduled) return { changed: true, rescheduled: false, notified: 0, needPrintedSchedule: 0 };

      const { rows: people } = await db.query<{ id: number; name: string; email: string | null }>(`
        SELECT e.id, e.full_name AS name, NULLIF(btrim(e.email), '') AS email
        FROM public.hrms_training_assignments a JOIN public.hrms_employees e ON e.id = a.employee_id
        WHERE a.training_id = $1 AND a.status <> 'Cancelled' ORDER BY a.assigned_at, e.id`, [id]);
      const noEmail = people.filter((person) => !person.email);
      if (noEmail.length > 0) {
        await db.query(`UPDATE public.hrms_training_assignments SET reprint_needed = true WHERE training_id = $1 AND employee_id = ANY($2::int[])`, [id, noEmail.map((person) => person.id)]);
      }
      let notified = 0;
      if (notify) {
        for (const person of people) {
          const notice = queueNotice("Schedule changed", person, scheduleChangedEmail(person.name, terms, current));
          if (!notice) continue;
          notified += 1;
          await db.query(`INSERT INTO public.hrms_training_notices (training_id, employee_id, kind, email, payload, next_attempt_at, created_at)
            VALUES ($1, $2, $3, $4, $5::jsonb, $6::timestamptz, $6::timestamptz)`, [id, person.id, notice.kind, notice.email, JSON.stringify(notice.payload), at]);
        }
      }
      const pick = (t: { date: string; startTime: string; endTime: string; mode: TrainingMode; location: string }) => ({ date: t.date, startTime: t.startTime, endTime: t.endTime, mode: t.mode, location: t.location });
      await db.query(`INSERT INTO public.hrms_training_events (training_id, kind, detail, notified, notified_count, needs_printed, actor_name, created_at)
        VALUES ($1, 'Schedule changed', $2::jsonb, $3, $4, $5, $6, $7::timestamptz)`,
      [id, JSON.stringify({ from: pick(current), to: pick(terms) }), notify, notified, noEmail.length, staff.name, at]);
      return { changed: true, rescheduled: true, notified, needPrintedSchedule: noEmail.length };
    },
    /** One Training with its schedule, text and Active materials. */
    async read(id: number): Promise<TrainingDetail> {
      await authorise();
      if (!validId(id)) throw new TrainingError("not-found");
      const { rows: found } = await db.query<TrainingTerms & { id: number; rescheduledFrom: string | null; cancelReason: string | null; cancelled: boolean }>(`
        SELECT id, title, trainer, description, objectives, training_date::text AS date, to_char(start_time, 'HH24:MI') AS "startTime",
          to_char(end_time, 'HH24:MI') AS "endTime", mode, location, rescheduled_from::text AS "rescheduledFrom",
          cancel_reason AS "cancelReason", cancelled_at IS NOT NULL AS cancelled
        FROM public.hrms_trainings WHERE id = $1`, [id]);
      if (!found[0]) throw new TrainingError("not-found");
      const { rows: materials } = await db.query<TrainingMaterial>(`
        SELECT file_id AS "fileId", filename, content_type AS "contentType", size FROM public.hrms_training_materials
        WHERE training_id = $1 AND status = 'Active' ORDER BY created_at, file_id`, [id]);
      const { rows: assigned } = await db.query<Omit<AssignedEmployee, "needsPrintedSchedule" | "feedback"> & { feedbackRating: number | null; feedbackComments: string }>(`
        SELECT e.id AS "employeeId", e.full_name AS name, e.position, e.branch, NULLIF(btrim(e.email), '') AS email,
          a.status, a.completed_on::text AS "completedOn", a.reprint_needed AS "reprintNeeded",
          a.printed_at AS "printedAt", a.printed_date::text AS "printedDate",
          a.feedback_rating AS "feedbackRating", a.feedback_comments AS "feedbackComments"
        FROM public.hrms_training_assignments a JOIN public.hrms_employees e ON e.id = a.employee_id
        WHERE a.training_id = $1 ORDER BY a.assigned_at, e.full_name, e.id`, [id]);
      const { cancelled, ...training } = found[0];
      const recordedResultCount = assigned.filter((person) => person.status === "Completed" || person.status === "Did not attend").length;
      return { ...training, recordedResults: recordedResultCount, assigned: assigned.map(({ feedbackRating, feedbackComments, ...person }) => ({ ...person, needsPrintedSchedule: !person.email, feedback: feedbackRating === null ? null : { rating: feedbackRating, comments: feedbackComments } })), status: trainingStatus({ date: training.date, cancelled }, now()), objectiveList: training.objectives.split("\n").filter(Boolean), materials };
    },
    /** Everyone the Assign dialog may offer: Employee records only, never Staff, with who is already on this Training. */
    async assignable(trainingId: number): Promise<AssignableEmployee[]> {
      await authorise();
      await requireTraining(trainingId);
      const { rows } = await db.query<AssignableEmployee>(`
        SELECT e.id AS "employeeId", e.full_name AS name, e.position, e.branch, e.department, NULLIF(btrim(e.email), '') AS email,
          EXISTS (SELECT 1 FROM public.hrms_training_assignments a WHERE a.training_id = $1 AND a.employee_id = e.id) AS "alreadyAssigned"
        FROM public.hrms_employees e ORDER BY e.full_name, e.id`, [trainingId]);
      return rows;
    },
    /** Assigns Employees by person or by whole department. Already-assigned Employees are left as they are. */
    async assign(trainingId: number, request: AssignRequest): Promise<AssignResult> {
      const staff = await authorise();
      const training = await requireTraining(trainingId);
      if (training.cancelled) throw new TrainingError("conflict");
      const byDepartment = "department" in request;
      if (byDepartment ? typeof request.department !== "string" || request.department.trim() === "" : !Array.isArray(request.employeeIds) || request.employeeIds.length === 0 || !request.employeeIds.every(validId)) {
        throw new TrainingError("validation");
      }
      const { rows: chosen } = await db.query<{ id: number; name: string; email: string | null; assigned: boolean }>(`
        SELECT e.id, e.full_name AS name, NULLIF(btrim(e.email), '') AS email,
          EXISTS (SELECT 1 FROM public.hrms_training_assignments a WHERE a.training_id = $1 AND a.employee_id = e.id) AS assigned
        FROM public.hrms_employees e
        WHERE ${byDepartment ? "e.department = $2" : "e.id = ANY($2::int[])"}`,
      [trainingId, byDepartment ? request.department.trim() : [...new Set(request.employeeIds)]]);
      // Anyone who is not an Employee record (a Staff member, or an id that doesn't exist) is not found here, so it is refused.
      if (chosen.length === 0 || (!byDepartment && chosen.length !== new Set(request.employeeIds).size)) throw new TrainingError("validation");
      const fresh = chosen.filter((person) => !person.assigned);
      if (fresh.length > 0) {
        await db.query(`INSERT INTO public.hrms_training_assignments (training_id, employee_id, assigned_by, assigned_at)
          SELECT $1, unnest($2::int[]), $3, $4::timestamptz ON CONFLICT DO NOTHING`, [trainingId, fresh.map((person) => person.id), staff.username, now().toISOString()]);
        // Everyone with an email gets the Assignment email; no-email Employees get none and are listed as Needs printed schedule.
        const { rows: details } = await db.query<NoticeTraining>(`
          SELECT title, trainer, training_date::text AS date, to_char(start_time, 'HH24:MI') AS "startTime", to_char(end_time, 'HH24:MI') AS "endTime", mode, location
          FROM public.hrms_trainings WHERE id = $1`, [trainingId]);
        for (const person of fresh) {
          const notice = queueNotice("Assignment", person, assignmentEmail(person.name, details[0]));
          if (!notice) continue;
          await db.query(`INSERT INTO public.hrms_training_notices (training_id, employee_id, kind, email, payload, next_attempt_at, created_at)
            VALUES ($1, $2, $3, $4, $5::jsonb, $6::timestamptz, $6::timestamptz)`, [trainingId, person.id, notice.kind, notice.email, JSON.stringify(notice.payload), now().toISOString()]);
        }
      }
      return { added: fresh.length, alreadyAssigned: chosen.length - fresh.length, needPrintedSchedule: fresh.filter((person) => !person.email).length };
    },
    /**
     * Cancels a Training with a required reason. Every Assigned employee becomes Cancelled, and, when `notify` is on, each one
     * with an email is queued a Cancelled notice (no-email Employees are never emailed; they are told directly). Notices not
     * yet delivered for this Training stop, since they describe a session that is off. A Training that is already cancelled,
     * or that has recorded results, is refused.
     */
    async cancel(trainingId: number, request: CancelRequest): Promise<CancelResult> {
      await authorise();
      const training = await requireTraining(trainingId);
      const { reason } = readCancelReason(request?.reason);
      if (reason === null || typeof request.notify !== "boolean") throw new TrainingError("validation");
      if (training.cancelled) throw new TrainingError("conflict");
      const { rows: recorded } = await db.query(`SELECT 1 FROM public.hrms_training_assignments WHERE training_id = $1 AND status NOT IN ('Assigned', 'Cancelled') LIMIT 1`, [trainingId]);
      if (recorded[0]) throw new TrainingError("conflict");
      // The guard in WHERE makes a double submit cancel once; the second finds nothing to update.
      const { rows: done } = await db.query<{ title: string; date: string }>(`
        UPDATE public.hrms_trainings SET cancelled_at = $2::timestamptz, cancel_reason = $3
        WHERE id = $1 AND cancelled_at IS NULL RETURNING title, training_date::text AS date`, [trainingId, now().toISOString(), reason]);
      if (!done[0]) throw new TrainingError("conflict");
      const { rows: people } = await db.query<{ id: number; name: string; email: string | null }>(`
        UPDATE public.hrms_training_assignments a SET status = 'Cancelled'
        FROM public.hrms_employees e WHERE a.training_id = $1 AND a.status = 'Assigned' AND e.id = a.employee_id
        RETURNING e.id, e.full_name AS name, NULLIF(btrim(e.email), '') AS email`, [trainingId]);
      // An Assignment or Reminder still waiting to go out would announce a session that is off.
      await db.query(`DELETE FROM public.hrms_training_notices WHERE training_id = $1 AND state IN ('Queued', 'Retrying')`, [trainingId]);
      let notified = 0;
      if (request.notify) {
        for (const person of people) {
          const notice = queueNotice("Cancelled", person, cancelledEmail(person.name, done[0], reason));
          if (!notice) continue;
          await db.query(`INSERT INTO public.hrms_training_notices (training_id, employee_id, kind, email, payload, next_attempt_at)
            VALUES ($1, $2, $3, $4, $5::jsonb, $6::timestamptz)`, [trainingId, person.id, notice.kind, notice.email, JSON.stringify(notice.payload), now().toISOString()]);
          notified += 1;
        }
      }
      return { cancelled: people.length, notified, needPrintedSchedule: people.filter((person) => !person.email).length };
    },
    /**
     * Marks results from the paper sign-in sheet, one or many Employees at once: Completed (with a completion date),
     * Did not attend, or back to Assigned. Cancelled Employees are set only by cancelling the Training and are never touched here.
     * Allowed from the day of the Training. The first recorded result locks the Training's date, time and venue.
     */
    async markResults(trainingId: number, request: { marks: ResultMark[] }): Promise<MarkResultsResult> {
      await authorise();
      if (!validId(trainingId)) throw new TrainingError("not-found");
      const { rows: found } = await db.query<{ date: string; cancelled: boolean }>(`SELECT training_date::text AS date, cancelled_at IS NOT NULL AS cancelled FROM public.hrms_trainings WHERE id = $1`, [trainingId]);
      if (!found[0]) throw new TrainingError("not-found");
      if (found[0].cancelled) throw new TrainingError("conflict");
      const today = manilaToday(now());
      const { marks } = readResultMarks(request?.marks, { trainingDate: found[0].date, today });
      if (!marks) throw new TrainingError("validation");
      if (found[0].date > today) throw new TrainingError("early");
      // Someone not assigned to this Training, or Cancelled, is refused up front rather than half-applied.
      const ids = marks.map((mark) => mark.employeeId);
      const { rows: eligible } = await db.query(`SELECT 1 FROM public.hrms_training_assignments WHERE training_id = $1 AND employee_id = ANY($2::int[]) AND status <> 'Cancelled'`, [trainingId, ids]);
      if (eligible.length !== ids.length) throw new TrainingError("validation");
      await db.query(`
        UPDATE public.hrms_training_assignments a SET status = m.status, completed_on = NULLIF(m.completed_on, '')::date,
          feedback_rating = CASE WHEN m.status = 'Completed' THEN a.feedback_rating END,
          feedback_comments = CASE WHEN m.status = 'Completed' THEN a.feedback_comments ELSE '' END,
          feedback_recorded_at = CASE WHEN m.status = 'Completed' THEN a.feedback_recorded_at END,
          feedback_recorded_by = CASE WHEN m.status = 'Completed' THEN a.feedback_recorded_by END
        FROM unnest($2::int[], $3::text[], $4::text[]) AS m(employee_id, status, completed_on)
        WHERE a.training_id = $1 AND a.employee_id = m.employee_id AND a.status <> 'Cancelled'`,
      [trainingId, ids, marks.map((mark) => mark.status), marks.map((mark) => mark.completedOn ?? "")]);
      return { marked: ids.length };
    },
    /**
     * Records, or replaces, the feedback typed from an Employee's paper feedback form: a 1 to 5 rating and optional comments.
     * Only an employee whose result is Completed has feedback. Moving them off Completed clears it.
     */
    async recordFeedback(trainingId: number, employeeId: number, input: { rating: number; comments?: string }): Promise<TrainingFeedback> {
      const staff = await authorise();
      await requireTraining(trainingId);
      if (!validId(employeeId)) throw new TrainingError("not-found");
      const { feedback } = readFeedback(input);
      if (!feedback) throw new TrainingError("validation");
      const { rows } = await db.query<{ status: string }>(`SELECT status FROM public.hrms_training_assignments WHERE training_id = $1 AND employee_id = $2`, [trainingId, employeeId]);
      if (!rows[0]) throw new TrainingError("not-found");
      if (rows[0].status !== "Completed") throw new TrainingError("conflict");
      await db.query(`UPDATE public.hrms_training_assignments SET feedback_rating = $3, feedback_comments = $4, feedback_recorded_at = $5::timestamptz, feedback_recorded_by = $6
        WHERE training_id = $1 AND employee_id = $2`, [trainingId, employeeId, feedback.rating, feedback.comments, now().toISOString(), staff.username]);
      return feedback;
    },
    /**
     * Sends a reminder now, on top of the automatic one: queued for every assigned Employee still marked Assigned who has an
     * email. Employees without an email are never emailed (they are told with a printed schedule) and are counted in `notEmailed`.
     * Only an Upcoming Training can be reminded about.
     */
    async sendReminder(trainingId: number): Promise<ReminderResult> {
      await authorise();
      const training = await requireTraining(trainingId);
      if (training.cancelled) throw new TrainingError("conflict");
      const { rows: details } = await db.query<NoticeTraining>(`
        SELECT title, trainer, training_date::text AS date, to_char(start_time, 'HH24:MI') AS "startTime", to_char(end_time, 'HH24:MI') AS "endTime", mode, location
        FROM public.hrms_trainings WHERE id = $1`, [trainingId]);
      const at = now();
      if (details[0].date < manilaToday(at)) throw new TrainingError("conflict");
      const { rows: people } = await db.query<{ id: number; name: string; email: string | null }>(`
        SELECT e.id, e.full_name AS name, NULLIF(btrim(e.email), '') AS email
        FROM public.hrms_training_assignments a JOIN public.hrms_employees e ON e.id = a.employee_id
        WHERE a.training_id = $1 AND a.status = 'Assigned' ORDER BY a.assigned_at, e.id`, [trainingId]);
      let queued = 0;
      for (const person of people) {
        const notice = queueNotice("Reminder", person, reminderEmail(person.name, details[0]));
        if (!notice) continue;
        queued += 1;
        await db.query(`INSERT INTO public.hrms_training_notices (training_id, employee_id, kind, email, payload, next_attempt_at, created_at)
          VALUES ($1, $2, $3, $4, $5::jsonb, $6::timestamptz, $6::timestamptz)`, [trainingId, person.id, notice.kind, notice.email, JSON.stringify(notice.payload), at.toISOString()]);
      }
      return { queued, notEmailed: people.length - queued };
    },
    /** Removes an Employee from a Training. */
    async unassign(trainingId: number, employeeId: number): Promise<void> {
      await authorise();
      await requireTraining(trainingId);
      if (!validId(employeeId)) throw new TrainingError("not-found");
      const { rows } = await db.query(`DELETE FROM public.hrms_training_assignments WHERE training_id = $1 AND employee_id = $2 RETURNING 1`, [trainingId, employeeId]);
      if (!rows[0]) throw new TrainingError("not-found");
      // Notices not yet delivered stop with the assignment; delivered and failed ones stay in the log.
      await db.query(`DELETE FROM public.hrms_training_notices WHERE training_id = $1 AND employee_id = $2 AND state IN ('Queued', 'Retrying')`, [trainingId, employeeId]);
    },
    /** The Employees the Training history picker offers: Employee records only, by name. */
    async historyEmployees(): Promise<{ id: number; name: string; employeeNumber: string }[]> {
      await authorise();
      const { rows } = await db.query<{ id: number; name: string; employeeNumber: string }>(
        `SELECT id, full_name AS name, employee_number AS "employeeNumber" FROM public.hrms_employees ORDER BY full_name, id`);
      return rows;
    },
    /** The Trainings one Employee was assigned to, with their result and completion date, and counts for each tab. */
    async history(employeeId: number): Promise<TrainingHistory> {
      await authorise();
      if (!validId(employeeId)) throw new TrainingError("not-found");
      const { rows: found } = await db.query<HistoryEmployee>(`
        SELECT id, full_name AS name, employee_number AS "employeeNumber", position, branch, status FROM public.hrms_employees WHERE id = $1`, [employeeId]);
      if (!found[0]) throw new TrainingError("not-found");
      const { rows } = await db.query<{
        trainingId: number; title: string; trainer: string; date: string; startTime: string; endTime: string; mode: TrainingMode;
        cancelled: boolean; status: HistoryRow["result"]; completedOn: string | null;
      }>(`
        SELECT t.id AS "trainingId", t.title, t.trainer, t.training_date::text AS date, to_char(t.start_time, 'HH24:MI') AS "startTime",
          to_char(t.end_time, 'HH24:MI') AS "endTime", t.mode, t.cancelled_at IS NOT NULL AS cancelled, a.status, a.completed_on::text AS "completedOn"
        FROM public.hrms_training_assignments a JOIN public.hrms_trainings t ON t.id = a.training_id
        WHERE a.employee_id = $1 ORDER BY t.training_date DESC, t.start_time DESC, t.id DESC`, [employeeId]);
      const clock = now();
      const history: HistoryRow[] = rows.map((row) => {
        const status = trainingStatus(row, clock);
        const result = row.cancelled ? "Cancelled" : row.status;
        return {
          trainingId: row.trainingId, title: row.title, trainer: row.trainer, date: row.date, startTime: row.startTime, endTime: row.endTime, mode: row.mode,
          result, completedOn: result === "Completed" ? row.completedOn : null,
          resultsNotRecorded: result === "Assigned" && status === "Completed", upcoming: result === "Assigned" && status === "Upcoming",
        };
      });
      const counts = Object.fromEntries(HISTORY_TABS.map((tab) => [tab, historyRowsFor(history, tab as HistoryTab).length])) as Record<HistoryTab, number>;
      return { employee: found[0], rows: history, counts };
    },
    /** Trainings Staff may put on a schedule: not Cancelled, today or later (Manila), soonest first. */
    async printable(): Promise<PrintableTraining[]> {
      await authorise();
      const { rows } = await db.query<PrintableTraining>(`
        SELECT id, title, trainer, training_date::text AS date, to_char(start_time, 'HH24:MI') AS "startTime", to_char(end_time, 'HH24:MI') AS "endTime", mode
        FROM public.hrms_trainings WHERE cancelled_at IS NULL AND training_date >= $1::date
        ORDER BY training_date, start_time, id LIMIT ${MAX_SCHEDULE_TRAININGS}`, [manilaToday(now())]);
      return rows;
    },
    /**
     * The schedule for the chosen Trainings, in date order, with the names under each when asked. Read-only: the preview
     * uses it. Unknown or Cancelled Trainings are refused rather than left out silently.
     */
    async schedule(trainingIds: number[], { includeNames }: { includeNames: boolean }): Promise<ScheduleSheet> {
      const staff = await authorise();
      return buildSchedule(trainingIds, includeNames, staff.name);
    },
    /**
     * Produces the schedule to print or export. When it lists the names, every no-email Employee on these Trainings is marked
     * printed (when, and the Training date on the sheet) and "Reprint needed" is cleared. Without the names the sheet does
     * not say who it is for, so nothing is marked.
     */
    async printSchedule(trainingIds: number[], { includeNames }: { includeNames: boolean }): Promise<{ sheet: ScheduleSheet; marked: number }> {
      const staff = await authorise();
      const sheet = await buildSchedule(trainingIds, includeNames, staff.name);
      if (!includeNames || sheet.needPrinted.length === 0) return { sheet, marked: 0 };
      const { rows } = await db.query<{ n: number }>(`
        WITH marked AS (
          UPDATE public.hrms_training_assignments a SET printed_at = $2::timestamptz, printed_date = t.training_date, reprint_needed = false
          FROM public.hrms_trainings t, public.hrms_employees e
          WHERE a.training_id = ANY($1::int[]) AND t.id = a.training_id AND e.id = a.employee_id AND a.status <> 'Cancelled'
            AND NULLIF(btrim(e.email), '') IS NULL
          RETURNING a.employee_id
        ) SELECT count(*)::int AS n FROM marked`, [sheet.items.map((item) => item.id), now().toISOString()]);
      return { sheet, marked: rows[0].n };
    },
    /** The Notification log: a row per Employee notice, the Not reached list and the Needs printed schedule list. */
    async log(trainingId: number): Promise<NotificationLog> {
      await authorise();
      await requireTraining(trainingId);
      const { rows: stored } = await db.query<LogRow & { at: Date | string; nextAttemptAt: Date | string | null }>(`
        SELECT n.id AS "noticeId", e.id AS "employeeId", e.full_name AS "employeeName", e.position, e.branch, n.kind, n.email,
          CASE n.state WHEN 'Queued' THEN 'Sending' ELSE n.state END AS state,
          COALESCE(n.last_attempt_at, n.created_at) AS at, n.attempts, n.next_attempt_at AS "nextAttemptAt"
        FROM public.hrms_training_notices n JOIN public.hrms_employees e ON e.id = n.employee_id
        WHERE n.training_id = $1`, [trainingId]);
      const { rows: noEmail } = await db.query<LogRow & { at: Date | string }>(`
        SELECT NULL::bigint AS "noticeId", e.id AS "employeeId", e.full_name AS "employeeName", e.position, e.branch, 'Assignment' AS kind,
          NULL::text AS email, 'Needs printed schedule' AS state, a.assigned_at AS at, 0 AS attempts, NULL::timestamptz AS "nextAttemptAt",
          a.printed_at AS "printedAt", a.printed_date::text AS "printedDate", a.reprint_needed AS "reprintNeeded"
        FROM public.hrms_training_assignments a JOIN public.hrms_employees e ON e.id = a.employee_id
        WHERE a.training_id = $1 AND NULLIF(btrim(e.email), '') IS NULL`, [trainingId]);
      const iso = (value: Date | string | null) => (value === null ? null : new Date(value).toISOString());
      const rows: LogRow[] = [...stored, ...noEmail]
        .map((row) => ({ ...row, noticeId: row.noticeId === null ? null : Number(row.noticeId), at: iso(row.at)!, nextAttemptAt: iso(row.nextAttemptAt) }))
        .sort((a, b) => b.at.localeCompare(a.at) || (b.noticeId ?? 0) - (a.noticeId ?? 0));
      const notReached = rows.filter((row) => row.state === "Failed");
      const needsPrinted = rows.filter((row) => row.state === "Needs printed schedule");
      const counts: Record<LogTab, number> = { "All notices": rows.length, "Not reached": notReached.length, "Needs printed schedule": needsPrinted.length };
      const { rows: changes } = await db.query<{ at: Date | string; detail: { from: ScheduleChange["from"]; to: ScheduleChange["to"] }; notified: boolean; notifiedCount: number; needsPrinted: number }>(`
        SELECT created_at AS at, detail, notified, notified_count AS "notifiedCount", needs_printed AS "needsPrinted"
        FROM public.hrms_training_events WHERE training_id = $1 ORDER BY created_at DESC, id DESC`, [trainingId]);
      const scheduleChanges: ScheduleChange[] = changes.map((change) => ({
        at: new Date(change.at).toISOString(), from: change.detail.from, to: change.detail.to,
        notified: change.notified, notifiedCount: change.notifiedCount, needsPrinted: change.needsPrinted,
      }));
      return { rows, scheduleChanges, notReached, needsPrinted, counts };
    },
    /** The latest notice events for the detail page, each with how many were sent, retrying, failed or need a printed schedule. */
    async logPreview(trainingId: number, limit = 3): Promise<LogEvent[]> {
      const { rows, scheduleChanges } = await this.log(trainingId);
      const { rows: created } = await db.query<{ kind: string; createdAt: Date | string; state: string }>(
        `SELECT kind, created_at AS "createdAt", state FROM public.hrms_training_notices WHERE training_id = $1`, [trainingId]);
      const events = new Map<string, LogEvent>();
      const at = (value: Date | string) => new Date(value).toISOString();
      const bucket = (kind: string, when: string) => {
        const key = `${kind}|${when.slice(0, 16)}`;
        if (!events.has(key)) events.set(key, { kind, at: when, sent: 0, retrying: 0, failed: 0, needPrinted: 0 });
        return events.get(key)!;
      };
      for (const row of created) {
        const event = bucket(row.kind, at(row.createdAt));
        if (row.state === "Sent") event.sent += 1; else if (row.state === "Failed") event.failed += 1; else event.retrying += 1;
      }
      for (const row of rows.filter((item) => item.state === "Needs printed schedule")) bucket(row.kind, row.at).needPrinted += 1;
      // A reschedule is an event of its own, even when nobody was emailed (Notify off, or no one assigned with an email).
      for (const change of scheduleChanges) {
        const event = bucket("Schedule changed", change.at);
        event.needPrinted = change.needsPrinted;
        event.notified = change.notified;
      }
      return [...events.values()].sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
    },
    /** Puts a Not reached notice back in the queue; it gets the full three retries again. */
    async retryNotice(trainingId: number, noticeId: number): Promise<void> {
      await authorise();
      await requireTraining(trainingId);
      if (!Number.isInteger(noticeId) || noticeId <= 0) throw new TrainingError("not-found");
      const { rows } = await db.query<{ state: string }>(`SELECT state FROM public.hrms_training_notices WHERE id = $1 AND training_id = $2`, [noticeId, trainingId]);
      if (!rows[0]) throw new TrainingError("not-found");
      if (rows[0].state !== "Failed") throw new TrainingError("conflict");
      await db.query(`UPDATE public.hrms_training_notices SET state = 'Retrying', attempts = 0, next_attempt_at = $2::timestamptz
        WHERE id = $1 AND state = 'Failed'`, [noticeId, now().toISOString()]);
    },
    /** Asks file-storage for an upload address. The file is Pending, and uploaded by this Staff member, until confirmed. */
    async requestMaterial(file: MaterialRequest, trainingId?: number): Promise<{ fileId: string; uploadUrl: string }> {
      const staff = await authorise();
      if (materialProblem(file)) throw new TrainingError("validation");
      if (trainingId !== undefined) {
        if (!validId(trainingId)) throw new TrainingError("not-found");
        const { rows } = await db.query(`SELECT 1 FROM public.hrms_trainings WHERE id = $1`, [trainingId]);
        if (!rows[0]) throw new TrainingError("not-found");
      }
      const requested = await files.requestUpload(file).catch(unavailable);
      await db.query(`INSERT INTO public.hrms_training_materials (file_id, training_id, filename, content_type, size, uploaded_by)
        VALUES ($1, $2, $3, $4, $5, $6)`, [requested.fileId, trainingId ?? null, file.filename.replace(/\s+/g, " ").trim(), file.contentType, file.size, staff.username]);
      return requested;
    },
    /** Confirms the bytes arrived, so the material becomes Active and shows on the Training. */
    async confirmMaterial(fileId: string): Promise<TrainingMaterial> {
      const staff = await authorise();
      const { rows } = await db.query<TrainingMaterial & { status: string }>(`
        SELECT file_id AS "fileId", filename, content_type AS "contentType", size, status FROM public.hrms_training_materials
        WHERE file_id = $1 AND uploaded_by = $2`, [String(fileId), staff.username]);
      if (!rows[0]) throw new TrainingError("not-found");
      if (rows[0].status === "Pending") {
        await files.confirm(rows[0].fileId).catch(unavailable);
        await db.query(`UPDATE public.hrms_training_materials SET status = 'Active' WHERE file_id = $1`, [rows[0].fileId]);
      }
      const { status, ...material } = rows[0];
      void status;
      return material;
    },
    /** Deletes a material from file-storage and from its Training. Only files HRMS itself recorded can be deleted. */
    async deleteMaterial(fileId: string): Promise<void> {
      await authorise();
      const { rows } = await db.query(`SELECT 1 FROM public.hrms_training_materials WHERE file_id = $1`, [String(fileId)]);
      if (!rows[0]) throw new TrainingError("not-found");
      await files.remove(String(fileId)).catch(unavailable);
      await db.query(`DELETE FROM public.hrms_training_materials WHERE file_id = $1`, [String(fileId)]);
    },
    /** A short-lived signed address for one Active material. */
    async materialUrl(fileId: string): Promise<string> {
      await authorise();
      const { rows } = await db.query(`SELECT 1 FROM public.hrms_training_materials WHERE file_id = $1 AND status = 'Active' AND training_id IS NOT NULL`, [String(fileId)]);
      if (!rows[0]) throw new TrainingError("not-found");
      return files.viewUrl(String(fileId)).catch(unavailable);
    },
  };
}
