import { database, type Database } from "./database";
import { accessFor } from "./portal/access";
import {
  TRAINING_TABS, manilaToday, readTrainingForm, tabOf, trainingStatus,
  type TrainingMode, type TrainingStatus, type TrainingTab, type TrainingTerms,
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

export class TrainingError extends Error {
  constructor(public readonly reason: "denied" | "invalid" | "unavailable" | "validation" | "not-found") {
    super(`Training: ${reason}`);
  }
}

type Row = {
  id: number; title: string; trainer: string; date: string; startTime: string; endTime: string; mode: TrainingMode;
  rescheduledFrom: string | null; cancelled: boolean; assigned: number; completed: number; recorded: number;
};

const SELECT = `
  SELECT t.id, t.title, t.trainer, t.training_date::text AS date, to_char(t.start_time, 'HH24:MI') AS "startTime",
    to_char(t.end_time, 'HH24:MI') AS "endTime", t.mode, t.rescheduled_from::text AS "rescheduledFrom",
    t.cancelled_at IS NOT NULL AS cancelled,
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
export function trainingsFor(sessionHandle: string | undefined, db: Database = database, now: () => Date = () => new Date()) {
  async function authorise() {
    const access = await accessFor(sessionHandle).check("Training");
    if (access.decision !== "allowed") throw new TrainingError(access.decision);
    return access.staff;
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
          mode: row.mode, rescheduledFrom: row.rescheduledFrom, hasMaterials: false,
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
    async create(terms: TrainingTerms): Promise<number> {
      const staff = await authorise();
      const { terms: checked } = readTrainingForm({ ...terms }, manilaToday(now()));
      if (!checked) throw new TrainingError("validation");
      const { rows } = await db.query<{ id: number }>(`
        INSERT INTO public.hrms_trainings
          (title, trainer, description, objectives, training_date, start_time, end_time, mode, location, created_by_name)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
      [checked.title, checked.trainer, checked.description, checked.objectives, checked.date, checked.startTime, checked.endTime, checked.mode, checked.location, staff.name]);
      return rows[0].id;
    },
  };
}
