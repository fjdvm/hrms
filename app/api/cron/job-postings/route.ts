import { retryApplicationNotifications } from "@/lib/application-notifications";
import { deliverStaffNotifications } from "@/lib/staff-notifications";
import { closeExpiredJobPostings, retryJobPostingAnnouncements } from "@/lib/job-postings";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  await closeExpiredJobPostings();
  await retryJobPostingAnnouncements();
  await retryApplicationNotifications();
  await deliverStaffNotifications();
  return Response.json({ ok: true });
}
