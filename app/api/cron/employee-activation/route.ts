import { employeeActivationJob } from "@/lib/employee-activation";

/**
 * Daily job, early in the Manila day (see `vercel.json`): makes every Onboarding person Active whose account exists (or who
 * needs none) and whose start date has arrived. Idempotent, so a repeated run changes nothing.
 */
export async function GET(request: Request) {
  return employeeActivationJob()(request);
}
