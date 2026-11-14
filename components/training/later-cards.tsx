import { Play, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";

const CARD = "flex flex-col gap-[12px] rounded-xl border border-dashed border-zinc-300 bg-white px-[20px] py-[18px]";

/** Two roadmap placeholders. Nothing here is interactive: microlearning and AI recommendations are not built yet. */
export function LaterCards() {
  return (
    <div className="grid gap-[16px] md:grid-cols-2" aria-label="Later">
      <section className={CARD}>
        <div className="flex items-center gap-[12px]">
          <span className="flex size-9 items-center justify-center rounded-lg bg-accent"><Play className="size-4 text-primary" aria-hidden /></span>
          <h2 className="flex-1 text-[15px] font-semibold text-zinc-900">Microlearning materials</h2>
          <Badge variant="secondary">Later</Badge>
        </div>
        <p className="text-xs text-zinc-500">Short lessons (a 3-minute video or a one-page guide) attached to a Training, for Staff to print or show at the branch.</p>
        {[["Handwashing in 5 steps", "Video · 3 min"], ["Glove rules at the packing table", "1-page guide"]].map(([title, kind]) => (
          <div key={title} className="flex items-center gap-[10px] rounded-lg bg-muted px-[12px] py-[10px]">
            <Play className="size-3 text-zinc-500" aria-hidden />
            <div className="flex flex-col"><span className="text-[13px] font-medium text-zinc-900">{title}</span><span className="text-xs text-zinc-500">{kind}</span></div>
          </div>
        ))}
      </section>
      <section className={`${CARD} self-start`}>
        <div className="flex items-center gap-[12px]">
          <span className="flex size-9 items-center justify-center rounded-lg bg-accent"><Sparkles className="size-4 text-primary" aria-hidden /></span>
          <h2 className="flex-1 text-[15px] font-semibold text-zinc-900">AI training recommendation</h2>
          <Badge variant="secondary">Later</Badge>
        </div>
        <p className="text-xs text-zinc-500">Suggests a Training based on role and past results. Recommendation only: HR must review before assigning anyone.</p>
        <div className="flex flex-col gap-[2px] rounded-lg bg-muted px-[12px] py-[10px]">
          <span className="text-[13px] font-semibold text-zinc-900">Suggested: Food safety and hygiene refresher</span>
          <span className="text-xs text-zinc-500">3 new Production Staff hired in October have no food safety training yet.</span>
        </div>
        <div className="flex gap-[8px]">
          {["Review suggestion", "Dismiss"].map((label) => (
            <span key={label} aria-disabled="true" className="rounded-lg bg-muted px-[12px] py-[6px] text-xs font-medium text-zinc-400">{label}</span>
          ))}
        </div>
      </section>
    </div>
  );
}
