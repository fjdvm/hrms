"use client";

import { useOptimistic, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * Switch tabs and views without waiting for the next page: the choice lights up on the click and the page is marked busy until the new
 * data arrives. Modified clicks (new tab, copy link) still use the plain link.
 */
export function useOptimisticNav<T>(current: T) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [shown, setShown] = useOptimistic(current);
  const go = (value: T, href: string) => (event: React.MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    start(() => { setShown(value); router.push(href); });
  };
  return { shown, pending, go };
}
