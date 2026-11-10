"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Bell, CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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

const dateFormat = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Manila", month: "short", day: "numeric", year: "numeric" });

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

      <DropdownMenuContent className="w-80 bg-popover border-border text-popover-foreground z-[99999]" align="end">
        <div className="flex items-center justify-between p-sm border-b border-border">
          <DropdownMenuLabel className="p-0 text-body-sm font-bold text-foreground">Notifications</DropdownMenuLabel>
          <Button
            variant="ghost"
            className="h-auto gap-1.5 px-0 py-0 text-label-sm text-muted-foreground hover:bg-transparent hover:text-foreground"
            disabled={unread === 0}
            onClick={() => void markAllRead()}
            type="button"
          >
            <CheckCheck aria-hidden="true" className="size-4" />
            Mark all read
          </Button>
        </div>

        {inbox.notifications.length === 0 ? (
          <p className="p-md text-center text-label-sm text-muted-foreground">
            {inbox.available ? "No notifications yet." : "Notifications are unavailable right now."}
          </p>
        ) : (
          <ul className="max-h-96 divide-y divide-border overflow-y-auto">
            {inbox.notifications.map((notification) => (
              <li key={notification.id}>
                <button className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-accent" onClick={() => void open(notification)} type="button">
                  <span className={`mt-1.5 size-2 shrink-0 rounded-full ${notification.read ? "bg-transparent" : "bg-destructive"}`} title={notification.read ? undefined : "Unread"} />
                  <span className="min-w-0">
                    <span className={`block truncate text-body-sm text-foreground ${notification.read ? "" : "font-semibold"}`}>{notification.title}</span>
                    <span className="block text-label-sm text-muted-foreground">{dateFormat.format(new Date(notification.createdAt))}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <DropdownMenuSeparator className="bg-border m-0" />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
