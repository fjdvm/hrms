import { trainingNoticesJob } from "@/lib/training-notices";

/**
 * Every 15 minutes (see `vercel.json`): sends Training notices that are due, which is how a failed email is retried
 * about 15 minutes after the last try. Idempotent, so a repeated run sends nothing twice.
 */
export async function GET(request: Request) {
  return trainingNoticesJob()(request);
}
