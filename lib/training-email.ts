// The Training emails' wording. No database or server imports, so the Edit dialog (a client component) can preview them.
import { formatTrainingDate, formatTrainingTimes, type TrainingMode } from "./training-terms";

export type NoticeTraining = { title: string; trainer: string; date: string; startTime: string; endTime: string; mode: TrainingMode; location: string };
/** The parts of a Training that make up its schedule. */
export type Schedule = { date: string; startTime: string; endTime: string; mode: TrainingMode; location: string };

const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;
const place = (training: { mode: TrainingMode; location: string }) => (training.mode === "Online" ? `Meeting link: ${training.location}` : `Venue: ${training.location}`);
/** "Fri, 20 Nov 2026 · 2:00 – 4:00 PM · Online" */
export const scheduleLine = (schedule: Schedule) => `${formatTrainingDate(schedule.date)} · ${formatTrainingTimes(schedule.startTime, schedule.endTime)} · ${schedule.mode}`;

/** The Assignment email. Names the Training, when and where, and nothing the Employee would need to sign in for. */
export function assignmentEmail(employeeName: string, training: NoticeTraining): { title: string; body: string } {
  return {
    title: `Training assigned: ${training.title}`,
    body: [
      `Hi ${firstName(employeeName)},`,
      "",
      `You have been assigned to the training "${training.title}" with ${training.trainer}.`,
      "",
      `Date: ${formatTrainingDate(training.date)}`,
      `Time: ${formatTrainingTimes(training.startTime, training.endTime)}`,
      `Mode: ${training.mode}`,
      place(training),
      "",
      "Bren Raphael's",
    ].join("\n"),
  };
}

/** The Schedule changed email: what it was, what it is now, and where to join. */
export function scheduleChangedEmail(employeeName: string, training: { title: string } & Schedule, previous: Schedule): { title: string; body: string } {
  return {
    title: `Schedule changed: ${training.title}`,
    body: [
      `Hi ${firstName(employeeName)},`,
      "",
      `The schedule for the training "${training.title}" has changed.`,
      "",
      `Before: ${scheduleLine(previous)}`,
      `Now: ${scheduleLine(training)}`,
      place(training),
      "",
      "Bren Raphael's",
    ].join("\n"),
  };
}

/** The Reminder email, sent automatically 1 day before and on demand. Names the Training, when and where. */
export function reminderEmail(employeeName: string, training: NoticeTraining): { title: string; body: string } {
  const day = formatTrainingDate(training.date);
  return {
    title: `Reminder: ${training.title} on ${day.replace(/ \d{4}$/, "")}`,
    body: [
      `Hi ${firstName(employeeName)},`,
      "",
      `This is a reminder about your training "${training.title}" on ${day}, ${formatTrainingTimes(training.startTime, training.endTime)}.`,
      "",
      training.mode === "Online" ? `Join online: ${training.location}` : `Venue: ${training.location}`,
      "",
      "Bren Raphael's HR",
    ].join("\n"),
  };
}
