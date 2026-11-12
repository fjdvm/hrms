// The Portal and HRMS use the same nine Module names (see CONTEXT.md).
export const MODULES = [
  { name: "Dashboard", href: "/dashboard" },
  { name: "Job Postings", href: "/job-postings" },
  { name: "Applications", href: "/applicants" },
  { name: "Interviews", href: "/interviews" },
  { name: "Offers", href: "/offers" },
  { name: "Employee Information", href: "/employee-information" },
  { name: "Employee Onboarding", href: "/employee-onboarding" },
  { name: "Training", href: "/training" },
  { name: "Performance", href: "/performance" },
] as const;

export type Module = (typeof MODULES)[number];
export type ModuleName = Module["name"];
