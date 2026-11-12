"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { onboardingHref, type OnboardingTab } from "@/lib/onboarding-view";

const DEBOUNCE_MS = 300;

/** Search lives in the URL beside the tab; typing waits for a pause. The timer only delays a navigation. */
export function OnboardingSearch({ tab, search }: { tab: OnboardingTab; search: string }) {
  const router = useRouter();
  const [value, setValue] = useState(search);
  const applied = useRef(search);

  useEffect(() => {
    const next = value.trim();
    if (next === applied.current) return;
    const timer = setTimeout(() => {
      applied.current = next;
      router.replace(onboardingHref({ tab, search: next }), { scroll: false });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [value, tab, router]);

  return (
    <form role="search" className="relative w-full sm:w-[240px]" onSubmit={(event) => event.preventDefault()}>
      <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input name="q" aria-label="Search new hires" placeholder="Search new hires" maxLength={100}
        value={value} onChange={(event) => setValue(event.target.value)} className="h-auto rounded-lg border-zinc-200 bg-white py-[9px] pl-9 text-sm shadow-none" />
    </form>
  );
}
