import { trainingNoticesJob } from "@/lib/training-notices";

/**
 * Every 15 minutes (see `.github/workflows/training-notices.yml`): queues the automatic Reminders that are due (from 8:00 AM
 * Manila time, 1 day before a Training) and sends Training notices that are due, which is how a failed email is retried
 * about 15 minutes after the last try. Idempotent, so a repeated run sends nothing twice.
 */
export async function GET(request: Request) {
  return trainingNoticesJob()(request);
}
