"use client";

import { useEffect, useState } from "react";
import { systems, visibleSystems } from "./sidebar-nav";

let cached: string[] | null | undefined;

/**
 * The switcher entries this person may open. Asked of the Portal once per page load (not on a
 * timer) and kept for later navigations; until it answers only the Enterprise Portal and the
 * open System show.
 */
export function useVisibleSystems() {
  const [allowed, setAllowed] = useState<string[] | null>(cached ?? null);

  useEffect(() => {
    if (cached !== undefined) return;
    let live = true;
    fetch("/api/portal/systems", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { systems?: string[] | null } | null) => {
        cached = body?.systems ?? null;
        if (live) setAllowed(cached);
      })
      .catch(() => {});
    return () => { live = false; };
  }, []);

  return visibleSystems(systems, allowed);
}
