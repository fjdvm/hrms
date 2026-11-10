<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Agent skills

### Issue tracker

Issues and specs live as GitHub issues on `fjdvm/hrms`, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`), plus `blocked`. Blocking uses GitHub's native "blocked by". See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## UI design reference

Always use this Figma file as the reference for UI design: https://www.figma.com/design/76nS6Pw2TXA6fWfUvTmzJ1/Bren-Raphael-s-CRM---Orders-Prototype?node-id=0-1&p=f&t=ZlW5bZYq2Dp1w315-0

Check it before building or changing any UI, and follow it over your own design instincts.

## No polling

No app polls (ADR-0005 in the Portal repo, `docs/adr/0005-no-polling-anywhere.md`). Never repeat a data request on a timer, window focus or tab visibility; use the WebSocket, refetch on (re)connect, or refetch on a user action. A 30–60 second in-memory heartbeat is a keepalive, not polling, and timers that never touch the network (clocks, countdowns) are fine. Idle-tab check: `tests/no-polling.test.ts` and `tests/header-notifications.test.tsx`.
