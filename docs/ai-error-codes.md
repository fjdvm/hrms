# AI error codes

> **Status: the AI layer is built** (`lib/ai/`; the usage log is migration `0049-ai-usage.sql`). The Job description drafter and
> Development suggestions that use it are built in their own tickets. This page is the agreed list of codes and rules, so the
> screens, the server and support all use the same numbers. Update it in the same change that adds, renames or retires a code.

AI only ever suggests and a person decides: see [ADR 0006, AI is advisory only](adr/0006-ai-is-advisory-only.md).

Every refusal or failure of an AI feature (the Job description drafter now, Development suggestions later) has an **internal error
code**. Staff never see the code. They see one short message that says exactly what happened, and on a red error they also see a
short **Reference ID** for that attempt.

```
Yellow (expected, nothing to report):
  You've used all 20 AI drafts today. The limit resets at 12:00 AM Manila time. You can still write the posting yourself.

Red (unexpected):
  The AI service is busy. Please try again in a moment.
  Reference 7F3K2A · give this to support if the problem continues
```

- **The code** (`AI-` and four digits) is used in logs, the usage table, the code-to-message map and these docs. The wording can
  change; the number never does. All AI features share one list: `AI-0089` means "daily limit reached" for any of them.
- **The Reference ID** is a random six-character id made for each failed attempt. Support searches the usage log for it to find that
  exact attempt and its code. It is shown only on red banners (`AI-0091`, `AI-0092`, `AI-0093`), where Staff may need to report a
  problem. Yellow banners and the "Not available" notice already say everything, so they show no code and no reference.

## Codes

| Code | Name | When it happens | Message Staff see | Banner |
| --- | --- | --- | --- | --- |
| `AI-0089` | Daily limit reached | The Staff member has used their daily allowance for that feature (20 drafts a day for the Job description drafter). | You've used all 20 AI drafts today. The limit resets at 12:00 AM Manila time. You can still write the posting yourself. | Yellow |
| `AI-0090` | Daily budget reached | The optional company-wide daily cap is reached. | AI drafting is unavailable right now. Please try again tomorrow. | Yellow |
| `AI-0091` | Service busy | The AI provider answered with its own rate-limit or quota error, or was unavailable. | The AI service is busy. Please try again in a moment. | Red |
| `AI-0092` | Timed out | The call took longer than 30 seconds. | That took too long. Please try again. | Red |
| `AI-0093` | Draft not usable | The output failed the schema or wording checks twice. | The AI draft couldn't be used. Please try again or write it yourself. | Red |
| `AI-0094` | Feature off | The feature's switch is off. | None: the button is hidden or disabled with a tooltip. | None |
| `AI-0100` | Not available for this evaluation | Development suggestions only: the Evaluation has Insufficient data, so there are too few KPI results to suggest from. | Suggestions aren't available for this evaluation: it has Insufficient data, so there are too few KPI results to suggest from. | Grey (info) |

`AI-0095` to `AI-0099` are held for further Job description drafter codes. Later features take the next free numbers, starting at `AI-0100`.

### Wording per feature

The code and its meaning are the same in every feature; only the noun and the "what you can still do" sentence change.

| Code | Job description drafter | Development suggestions |
| --- | --- | --- |
| `AI-0089` | You've used all 20 AI drafts today. The limit resets at 12:00 AM Manila time. You can still write the posting yourself. | You've used all 60 AI suggestions today. The limit resets at 12:00 AM Manila time. You can still flag development needs yourself. |
| `AI-0090` | AI drafting is unavailable right now. Please try again tomorrow. | AI suggestions are unavailable right now. Please try again tomorrow. |
| `AI-0091` | The AI service is busy. Please try again in a moment. | The AI service is busy. Please try again in a moment. |
| `AI-0092` | That took too long. Please try again. | That took too long. Please try again. |
| `AI-0093` | The AI draft couldn't be used. Please try again or write it yourself. | The AI suggestions couldn't be used. Please try again or flag a development need yourself. |
| `AI-0094` | Button hidden or disabled with a tooltip. | Button hidden or disabled with a tooltip. |
| `AI-0100` | Not used. | Suggestions aren't available for this evaluation: it has Insufficient data, so there are too few KPI results to suggest from. |

Development suggestions are only offered on a submitted (Evaluated) Evaluation, so the button is hidden on one that is still in review
(that is not an error, so it has no code). An Evaluation with Insufficient data shows `AI-0100` in place of the suggestions.

### Rules for the codes

- **Staff never see a code.** The message carries the meaning; the Reference ID on a red banner carries the lookup.
- **Never reuse or renumber a code.** Retire it in the table (keep the row, mark it Retired) and add a new one.
- **No billing or quota wording reaches Staff.** A provider quota or billing error is shown with the generic "busy" message (`AI-0091`);
  the real provider detail is logged on the server only.
- **No personal data in a message or a log row.** Prompts and drafted text are not stored in the usage log.
- **Wording that is not an error is not a code.** The "Needs a look" notice on a draft (a flagged phrase such as a gender preference)
  is a warning on a usable draft, not a failure, so it has no code.
- **A Reference ID holds no personal data and no meaning.** It is random, so it cannot be guessed from a Staff member or a posting.
- **One place in code maps a reason to a code and a message,** beside the other `*-messages.ts` maps. Screens never write a
  code or a message themselves.

## The daily limit

| Setting | Meaning | Default |
| --- | --- | --- |
| `OPENAI_API_KEY` | The provider key. Secret, read on the server only, never in a `NEXT_PUBLIC_` variable. | none (every call fails as `AI-0091`) |
| `OPENAI_MODEL` | The model every AI feature calls | `gpt-4.1-mini` |
| `AI_JOB_DRAFTER_ENABLED` | Switch for the Job description drafter. `false`, `0`, `off` or `no` turns it off (`AI-0094`). | on |
| `AI_SUGGESTIONS_ENABLED` | The same switch for Development suggestions | on |
| `AI_DAILY_LIMIT_JOB_DRAFT` | Drafts per Staff member per Manila day for the Job description drafter | 20 |
| `AI_DAILY_LIMIT_SUGGESTIONS` | Suggestion runs per Staff member per Manila day for Development suggestions (a month-end run covers many employees) | 60 |
| `AI_DAILY_BUDGET` | Company-wide calls per Manila day across all AI features. **Set to 200 in production.** Unset means no cap. | unset (200 in production) |

- **The day is a Manila calendar day.** The count resets at 12:00 AM Manila time, the same business day the rest of HRMS uses.
- **What counts:** every request that reaches the AI provider, including **Regenerate**. A request is regenerated once on its own
  if the first result is unusable; that second try is part of the same request and uses the same single slot.
- **What does not count:** a request we refuse (`AI-0089`, `AI-0090`, `AI-0094`), and a call that fails on the provider's side
  (`AI-0091`, `AI-0092`), so Staff are not charged for our failures. An unusable draft (`AI-0093`) does count, because the provider
  was used.
- **No overshoot.** The check and the usage row are written in one SQL statement (`SELECT * FROM hrms_ai_reserve(...)`, which takes a
  lock so reservations take turns), so two clicks at the same moment cannot both take the last slot. The same statement checks the
  company cap. A request that is in flight (`pending`) already holds its slot; a provider failure gives it back.
- **The cap counts the same calls.** `AI_DAILY_BUDGET` counts the requests that count toward a Staff limit, across all features and
  Staff, so refused and provider-failed requests do not use it up.
- **The dialog shows what is left**, for example "17 of 20 drafts left today". At zero the Generate button is disabled and the
  limit message (`AI-0089`) shows.

## Where the code and the Reference ID are stored

The AI usage log (`hrms_ai_usage`) records, for each call: the Staff member, the feature, the model, token counts, the outcome, the
internal error code when there is one, a finer internal reason behind it (for example `provider-quota` behind `AI-0091`, so the team can
see the balance ran out without Staff seeing billing wording), whether it counts toward the limit, and the Reference ID. Support finds a Staff member's report by the Reference ID they read out
("7F3K2A"), or by the time when they have no ID. Counting by code (how often `AI-0091` happened this week) is for the team, not
shown to Staff. The log holds no prompt text and no drafted text.

## Where it is designed

The proposal frames are in the HRMS page of the Bren Raphael's CRM Figma file, in two rows below the existing frames. Existing frames
are unchanged; every proposal layer is named "(proposal)".

**AI · Job description drafter**

- **Dialog · Draft with AI · Limit reached** shows the yellow limit message (`AI-0089`), with no code on screen.
- **Dialog · Draft with AI · Unavailable** shows the red busy message (`AI-0091`) and a Reference ID.
- **Reference · AI error codes · Job description drafter** is the table of codes and messages.

**AI · Development suggestions**

- **Evaluation · AI suggestions · Limit reached** shows the yellow limit message (`AI-0089`), with no code on screen.
- **Evaluation · AI suggestions · Unavailable** shows the red busy message (`AI-0091`) and a Reference ID.
- **Evaluation · AI suggestions · Not available** shows the grey notice (`AI-0100`), with no code on screen.
- **Reference · AI error codes · Development suggestions** is the table with this feature's wording.

`AI-0090`, `AI-0092` and `AI-0093` have no frame of their own: they reuse the same banner with the message in the tables above
(`AI-0092` and `AI-0093` are red and show a Reference ID; `AI-0090` is yellow and does not).

Every new frame carries a purple **NEW** tag in the top bar, so it is easy to tell from the original frames. The tag is an
annotation, named "Tag · NEW AI proposal"; delete it when the frame is folded into the main design.

## Tests

The AI layer's tests cover each code: the 20th call succeeds and the 21st returns `AI-0089`; the count resets at Manila midnight;
a provider quota error returns `AI-0091` without using a slot; a call over 30 seconds returns `AI-0092`; two bad outputs in a row
return `AI-0093`; with the switch off the call returns `AI-0094`; and two simultaneous calls at the boundary never both succeed.
A red error (`AI-0091`, `AI-0092`, `AI-0093`) returns a Reference ID that matches a usage-log row; a yellow or grey one returns none; and no
message ever contains an internal code.
