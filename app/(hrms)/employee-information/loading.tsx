import { PAGE } from "@/components/hiring/parts";
import { EmployeeListSkeleton } from "./employee-list-skeleton";

export default function Loading() {
  return (
    <div className={PAGE}>
      <EmployeeListSkeleton />
    </div>
  );
}
