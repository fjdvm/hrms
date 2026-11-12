import type { AccountState, OnboardingFilters, OnboardingRow } from "./employees";
import { formatOfferDate, formatShortDate } from "./offer-view";

export const ONBOARDING_TABS = ["All", "Needs account", "Requested", "Account created", "No account needed"] as const;
export type OnboardingTab = (typeof ONBOARDING_TABS)[number];
const STATE_OF_TAB: Record<OnboardingTab, AccountState | undefined> = {
  All: undefined, "Needs account": "Not requested", Requested: "Requested", "Account created": "Account created", "No account needed": "No account needed",
};
const PARAM_OF_TAB: Record<OnboardingTab, string> = {
  All: "", "Needs account": "needs-account", Requested: "requested", "Account created": "account-created", "No account needed": "no-account-needed",
};

/** An unknown or missing tab in the URL means All. */
export const onboardingTabFromParam = (value: string | undefined): OnboardingTab => ONBOARDING_TABS.find((tab) => tab !== "All" && PARAM_OF_TAB[tab] === value) ?? "All";
/** Blank search in the URL means none. Over-long values are cut so a hand-edited URL never errors the page. */
export const onboardingSearchFromParam = (value: string | undefined) => value?.trim().slice(0, 100) || undefined;
export const onboardingFiltersOf = ({ tab, search }: { tab: OnboardingTab; search?: string }): OnboardingFilters => ({ state: STATE_OF_TAB[tab], search });

/** The page URL for a view; defaults are left out so the plain page keeps its plain link. */
export function onboardingHref({ tab, search }: { tab?: OnboardingTab; search?: string }) {
  const params = new URLSearchParams();
  if (tab && tab !== "All") params.set("status", PARAM_OF_TAB[tab]);
  if (search) params.set("q", search);
  const query = params.toString();
  return query ? `/employee-onboarding?${query}` : "/employee-onboarding";
}

/** "4 new hires · 2 need a user account". */
export function formatOnboardingSubtitle({ hires, needsAccount }: { hires: number; needsAccount: number }) {
  return `${hires} new ${hires === 1 ? "hire" : "hires"} · ${needsAccount} ${needsAccount === 1 ? "needs" : "need"} a user account`;
}

/** The small line under the account badge. */
export function accountNote(row: OnboardingRow) {
  switch (row.accountState) {
    case "Not requested": return "No account yet";
    case "Requested": return row.requestedAt ? `Sent ${formatShortDate(new Date(row.requestedAt))} · waiting for admin` : "Waiting for admin";
    case "Account created":
      if (row.becomesActiveOn) return `Becomes Active on ${formatOfferDate(row.becomesActiveOn)}`;
      return row.accountCreatedAt ? `Created ${formatShortDate(new Date(row.accountCreatedAt))}${row.accountCreatedBy ? ` by ${row.accountCreatedBy}` : ""}` : "Account is ready";
    case "No account needed": return "No login required";
  }
}
