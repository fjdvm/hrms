import { PAGE } from "@/components/hiring/parts";
import { OnboardingSkeleton } from "./onboarding-skeleton";

export default function Loading() {
  return (
    <div className={PAGE}>
      <OnboardingSkeleton />
    </div>
  );
}
