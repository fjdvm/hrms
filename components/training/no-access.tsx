import Link from "next/link";
import { ArrowLeft, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/** Shown inside the shell to Staff who lack the Training Module; the TRAINING sidebar group is already hidden for them. */
export function TrainingNoAccess() {
  return (
    <div className="flex min-h-[calc(100vh-64px)] items-center justify-center px-md py-[28px] sm:px-xl">
      <Card className="flex w-full max-w-[520px] flex-col items-center gap-[12px] rounded-xl px-[40px] py-[48px] text-center shadow-none">
        <span className="flex size-[56px] items-center justify-center rounded-full bg-zinc-100">
          <Lock className="size-6 text-zinc-500" aria-hidden />
        </span>
        <h1 className="text-[18px] font-semibold text-foreground">No access to Training and Development</h1>
        <p className="text-sm text-muted-foreground">
          You don’t have access to Training and Development. Ask an administrator to grant it in the Portal.
        </p>
        <Button asChild className="h-auto gap-[6px] rounded-lg px-[14px] py-[9px] font-medium shadow-none">
          <Link href="/dashboard"><ArrowLeft className="size-4" aria-hidden />Back to Dashboard</Link>
        </Button>
      </Card>
    </div>
  );
}
