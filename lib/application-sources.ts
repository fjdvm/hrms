/** Where HR can say an Application they add by hand came from; Careers rows are always "Careers page". */
export const MANUAL_SOURCES = ["Facebook", "JobStreet", "Walk-in", "Referral"] as const;
export type ManualSource = (typeof MANUAL_SOURCES)[number];
export type ApplicationSource = ManualSource | "Careers page" | "Unspecified";
