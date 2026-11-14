import { database, type Database } from "./database";
import { accessFor } from "./portal/access";
import { gatewayMaterialFiles, type MaterialFiles } from "./training-material-files";
import {
  TRAINING_TABS, manilaToday, materialProblem, readTrainingForm, tabOf, trainingStatus,
  type MaterialRequest, type TrainingMaterial, type TrainingMode, type TrainingStatus, type TrainingTab, type TrainingTerms,
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
};

export class TrainingError extends Error {
  constructor(public readonly reason: "denied" | "invalid" | "unavailable" | "validation" | "not-found") {
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
      const { cancelled, ...training } = found[0];
      return { ...training, status: trainingStatus({ date: training.date, cancelled }, now()), objectiveList: training.objectives.split("\n").filter(Boolean), materials };
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
