import { database, type Database } from "./database";
import { accessFor } from "./portal/access";
import { assignmentEmail, queueNotice, scheduleChangedEmail, type NoticeTraining } from "./training-notices";
import { gatewayMaterialFiles, type MaterialFiles } from "./training-material-files";
import {
  TRAINING_TABS, manilaToday, materialProblem, readTrainingForm, tabOf, trainingStatus,
  scheduleDiffers, type LogEvent, type LogRow, type LogTab, type NotificationLog, type ScheduleChange, type UpdateResult,
  type AssignableEmployee, type AssignedEmployee, type AssignRequest, type AssignResult, type MaterialRequest, type TrainingMaterial, type TrainingMode, type TrainingStatus, type TrainingTab, type TrainingTerms,
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
};

/** Everything the Training page shows. */
export type TrainingDetail = TrainingTerms & {
  id: number;
  status: TrainingStatus;
  rescheduledFrom: string | null;
  /** Objectives, one per line, as a list. */
  objectiveList: string[];
  materials: TrainingMaterial[];
  assigned: AssignedEmployee[];
};

export class TrainingError extends Error {
  constructor(public readonly reason: "denied" | "invalid" | "unavailable" | "validation" | "not-found" | "conflict") {
    super(`Training: ${reason}`);
  }
}

type Row = {
  id: number; title: string; trainer: string; date: string; startTime: string; endTime: string; mode: TrainingMode;
  rescheduledFrom: string | null; cancelled: boolean; hasMaterials: boolean; assigned: number; completed: number; recorded: number;
};

const SELECT = `
  SELECT t.id, t.title, t.trainer, t.training_date::text AS date, to_char(t.start_time, 'HH24:MI') AS "startTime",
    to_char(t.end_time, 'HH24:MI') AS "endTime", t.mode, t.rescheduled_from::text AS "rescheduledFrom",
    t.cancelled_at IS NOT NULL AS cancelled,
    EXISTS (SELECT 1 FROM public.hrms_training_materials m WHERE m.training_id = t.id AND m.status = 'Active') AS "hasMaterials",
    count(a.employee_id)::int AS assigned,
    (count(a.employee_id) FILTER (WHERE a.status = 'Completed'))::int AS completed,
    (count(a.employee_id) FILTER (WHERE a.status NOT IN ('Assigned', 'Cancelled')))::int AS recorded
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

  async function requireTraining(id: number) {
    if (!validId(id)) throw new TrainingError("not-found");
    const { rows } = await db.query<{ cancelled: boolean }>(`SELECT cancelled_at IS NOT NULL AS cancelled FROM public.hrms_trainings WHERE id = $1`, [id]);
    if (!rows[0]) throw new TrainingError("not-found");
    return rows[0];
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
          resultsNotRecorded: status === "Completed" && row.assigned > 0 && row.recorded === 0, status,
        };
      });
      const counts: Record<TrainingTab, number> = { All: items.length, Upcoming: 0, Past: 0, Cancelled: 0 };
      for (const item of items) counts[tabOf(item.status)] += 1;
      const month = manilaToday(clock).slice(0, 7);
      return {
        counts,
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
      const { rows: found } = await db.query<TrainingTerms & { id: number; rescheduledFrom: string | null; cancelled: boolean }>(`
        SELECT id, title, trainer, description, objectives, training_date::text AS date, to_char(start_time, 'HH24:MI') AS "startTime",
          to_char(end_time, 'HH24:MI') AS "endTime", mode, location, rescheduled_from::text AS "rescheduledFrom", cancelled_at IS NOT NULL AS cancelled
        FROM public.hrms_trainings WHERE id = $1`, [id]);
      if (!found[0]) throw new TrainingError("not-found");
      const { rows: materials } = await db.query<TrainingMaterial>(`
        SELECT file_id AS "fileId", filename, content_type AS "contentType", size FROM public.hrms_training_materials
        WHERE training_id = $1 AND status = 'Active' ORDER BY created_at, file_id`, [id]);
      const { rows: assigned } = await db.query<Omit<AssignedEmployee, "needsPrintedSchedule">>(`
        SELECT e.id AS "employeeId", e.full_name AS name, e.position, e.branch, NULLIF(btrim(e.email), '') AS email,
          a.status, a.completed_on::text AS "completedOn", a.reprint_needed AS "reprintNeeded"
        FROM public.hrms_training_assignments a JOIN public.hrms_employees e ON e.id = a.employee_id
        WHERE a.training_id = $1 ORDER BY a.assigned_at, e.full_name, e.id`, [id]);
      const { cancelled, ...training } = found[0];
      return { ...training, assigned: assigned.map((person) => ({ ...person, needsPrintedSchedule: !person.email })), status: trainingStatus({ date: training.date, cancelled }, now()), objectiveList: training.objectives.split("\n").filter(Boolean), materials };
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
          NULL::text AS email, 'Needs printed schedule' AS state, a.assigned_at AS at, 0 AS attempts, NULL::timestamptz AS "nextAttemptAt"
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
