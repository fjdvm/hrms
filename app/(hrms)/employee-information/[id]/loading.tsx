import { PAGE } from "@/components/hiring/parts";
import { EmployeeSkeleton } from "./employee-skeleton";

export default function Loading() {
  return (
    <div className={PAGE}>
      <EmployeeSkeleton />
    </div>
  );
}
