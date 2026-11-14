import { Card } from "@/components/ui/card";
import { reminderDueAt, reminderWhen } from "@/lib/training-terms";

/** The detail page's Reminder card: when the automatic reminder goes out, and to how many employees. */
export function ReminderCard({ trainingDate, emailed, withoutEmail, now = new Date() }: { trainingDate: string; emailed: number; withoutEmail: number; now?: Date }) {
  const due = reminderDueAt(trainingDate);
  return (
    <Card className="flex flex-col gap-[14px] rounded-xl px-[20px] py-[18px] shadow-none">
      <h2 className="text-[15px] font-semibold text-zinc-900">Reminder</h2>
      <p className="text-[13px] text-foreground">
        {emailed === 0
          ? "No assigned employee has an email, so no reminder will be emailed."
          : `${now < due ? "Automatic reminder on" : "Automatic reminder went out on"} ${reminderWhen(trainingDate)} (Manila time) to ${emailed} ${emailed === 1 ? "employee" : "employees"} with an email.`}
      </p>
      {withoutEmail > 0 && <p className="text-xs text-[#8a5a00]">{withoutEmail} without an email {withoutEmail === 1 ? "needs" : "need"} a printed schedule.</p>}
    </Card>
  );
}
