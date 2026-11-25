"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Bell, CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LIVE_EVENT } from "@/lib/live-events";
import type { Inbox, StaffNotification } from "@/lib/notifications/notifications";

const MAX_BADGE = 99;
const EMPTY_INBOX: Inbox = { available: false, unread: 0, notifications: [] };

/** Only web links and same-site paths are followed. */
function isWebLink(link: string) {
  try {
    const { protocol } = new URL(link, window.location.href);

    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/** Same date and time as the other Systems' bells, e.g. "11/26/2026, 12:26:48 AM", in Philippine time. */
const dateFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Manila",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
});

async function fetchInbox(): Promise<Inbox> {
  try {
    const response = await fetch("/api/notifications", { cache: "no-store" });

    return response.ok ? ((await response.json()) as Inbox) : EMPTY_INBOX;
  } catch {
    return EMPTY_INBOX;
  }
}

/** A connected tab makes requests only on connect, on a pushed event, or on a user action. */
function useInbox() {
  const [inbox, setInbox] = useState<Inbox>(EMPTY_INBOX);
  const refresh = useCallback(async () => setInbox(await fetchInbox()), []);

  useEffect(() => {
    let cancelled = false;
    let socket: WebSocket | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    let revision = 0;

    async function sync() {
      const current = ++revision;
      const next = await fetchInbox();
      if (!cancelled && current === revision) setInbox(next);
    }

    function retry() {
      if (cancelled) return;
      // Only a disconnected tab retries. Jitter spreads reconnects after a deploy.
      const delay = Math.min(30_000, 1000 * 2 ** Math.min(failures++, 5));
      timer = setTimeout(() => void connect(), delay + Math.random() * delay * 0.25);
    }

    async function connect() {
      try {
        const response = await fetch("/api/notifications/live", { method: "POST", cache: "no-store" });
        if (cancelled || response.status === 401 || response.status === 403) return;
        if (!response.ok) throw new Error("Live unavailable");
        const { url } = await response.json();
        if (cancelled) return;
        const connection = new WebSocket(url);
        socket = connection;
        // Fetch after subscribing, so events during catch-up cannot be missed.
        connection.onopen = () => {
          failures = 0;
          void sync();
        };
        connection.onmessage = (message) => {
          try {
            const event = JSON.parse(message.data);
            if (event.type === "notification.created" || event.type === "notifications.read") {
              failures = 0;
              void sync();
              if (event.type === "notification.created") window.dispatchEvent(new Event(LIVE_EVENT));
            }
          } catch { /* Ignore unknown frames. */ }
        };
        connection.onerror = () => connection.close();
        connection.onclose = () => retry();
      } catch {
        retry();
      }
    }

    void sync();
    void connect();

    return () => {
      cancelled = true;
      clearTimeout(timer);
      socket?.close();
    };
  }, []);

  return { inbox, setInbox, refresh };
}

async function post(path: string) {
  const response = await fetch(path, { method: "POST" });
  if (!response.ok) throw new Error(`Request failed: ${response.status}`);
}

export function HeaderNotifications({ navigate = (link: string) => window.location.assign(link) }: { navigate?: (link: string) => void }) {
  const { inbox, setInbox, refresh } = useInbox();
  const unread = inbox.available ? inbox.unread : 0;

  async function open(notification: StaffNotification) {
    if (!notification.read) {
      setInbox((current) => ({
        ...current,
        unread: Math.max(0, current.unread - 1),
        notifications: current.notifications.map((item) => (item.id === notification.id ? { ...item, read: true } : item)),
      }));
      try {
        await post(`/api/notifications/${encodeURIComponent(notification.id)}/read`);
      } catch {
        void refresh();
      }
    }
    if (notification.link && isWebLink(notification.link)) navigate(notification.link);
  }

  async function markAllRead() {
    setInbox((current) => ({ ...current, unread: 0, notifications: current.notifications.map((item) => ({ ...item, read: true })) }));
    try {
      await post("/api/notifications/read-all");
    } catch {
      void refresh();
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:text-foreground relative w-8 h-8 cursor-pointer"
          title="Notifications"
          aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        >
          <Bell className="w-4 h-4" />
          {unread > 0 ? (
            <span aria-hidden="true" className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-none text-white">
              {unread > MAX_BADGE ? `${MAX_BADGE}+` : unread}
            </span>
          ) : null}
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent className="w-80 p-0 bg-popover border-border text-popover-foreground shadow-lg z-[99999]" align="end">
        <div className="flex items-center justify-between p-3 border-b border-border">
          <DropdownMenuLabel className="p-0 text-base font-semibold text-foreground">Notifications</DropdownMenuLabel>
          <Button
            variant="ghost"
            className="h-auto gap-1.5 px-0 py-0 text-sm font-medium text-primary hover:bg-transparent hover:text-primary/80"
            disabled={unread === 0}
            onClick={() => void markAllRead()}
            type="button"
          >
            <CheckCheck aria-hidden="true" className="size-4" />
            Mark all read
          </Button>
        </div>

        {inbox.notifications.length === 0 ? (
          <div className="p-6 text-center text-muted-foreground space-y-1">
            <Bell aria-hidden="true" className="size-6 mx-auto opacity-30" />
            <p className="text-sm font-medium">{inbox.available ? "No notifications yet." : "Notifications are unavailable right now."}</p>
          </div>
        ) : (
          <ul className="max-h-80 divide-y divide-border overflow-y-auto">
            {inbox.notifications.map((notification) => (
              <li key={notification.id}>
                <button
                  className={`flex w-full items-start gap-2.5 p-3 text-left hover:bg-muted focus-visible:bg-muted focus-visible:outline-none ${notification.read ? "" : "bg-muted/50"}`}
                  onClick={() => void open(notification)}
                  type="button"
                >
                  <span aria-hidden="true" className="mt-0.5 shrink-0 rounded-full border border-border bg-muted p-1.5">
                    <Bell className="size-3.5 text-muted-foreground" />
                  </span>
                  <span className="min-w-0 flex-1 space-y-0.5">
                    <span className="block break-words text-sm font-semibold text-foreground">{notification.title}</span>
                    {notification.body ? <span className="block break-words text-sm text-muted-foreground">{notification.body}</span> : null}
                    <time dateTime={notification.createdAt} className="block text-xs text-muted-foreground">{dateFormat.format(new Date(notification.createdAt))}</time>
                    {notification.read ? null : <span className="sr-only">Unread</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
