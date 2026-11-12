import { BackLink, PAGE } from "@/components/hiring/parts";

export default function NotFound() {
  return (
    <div className={PAGE}>
      <BackLink href="/employee-information">Employee information</BackLink>
      <h1 className="text-2xl font-semibold text-foreground">Employee not found</h1>
      <p className="text-sm text-muted-foreground">This employee record does not exist or was removed.</p>
    </div>
  );
}
