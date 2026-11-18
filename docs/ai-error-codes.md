# AI error codes

> **Status: planned.** The AI layer and the Job description drafter are not built yet. This page is the agreed list of codes and
> rules, written before the code so the screens, the server and support all use the same numbers. Update it in the same change
> that adds, renames or retires a code.

Every refusal or failure of an AI feature (the Job description drafter now, Development suggestions later) shows one short
message and one **error code** under it. The code is for support and logs; the wording can change, the number never does.

```
You've used all 20 AI drafts today. The limit resets at 12:00 AM Manila time.
Error code AI-0089
```

The format is `AI-` and four digits. All AI features share one list: `AI-0089` means "daily limit reached" for any of them, and the
feature is recorded separately in the usage log.

## Codes

| Code | Name | When it happens | Message Staff see | Banner |
| --- | --- | --- | --- | --- |
| `AI-0089` | Daily limit reached | The Staff member has used their daily allowance for that feature (20 drafts a day for the Job description drafter). | You've used all 20 AI drafts today. The limit resets at 12:00 AM Manila time. You can still write the posting yourself. | Yellow |
| `AI-0090` | Daily budget reached | The optional company-wide daily cap is reached. | AI drafting is unavailable right now. Please try again tomorrow. | Yellow |
| `AI-0091` | Service busy | The AI provider answered with its own rate-limit or quota error, or was unavailable. | The AI service is busy. Please try again in a moment. | Red |
| `AI-0092` | Timed out | The call took longer than 30 seconds. | That took too long. Please try again. | Red |
| `AI-0093` | Draft not usable | The output failed the schema or wording checks twice. | The AI draft couldn't be used. Please try again or write it yourself. | Red |
| `AI-0094` | Feature off | The feature's switch is off. | None: the button is hidden or disabled with a tooltip. | None |

`AI-0095` to `AI-0099` are held for further Job description drafter codes. Later features take the next free numbers.

### Rules for the codes

- **Never reuse or renumber a code.** Retire it in the table (keep the row, mark it Retired) and add a new one.
- **No billing or quota wording reaches Staff.** A provider quota or billing error is shown as `AI-0091` with the generic message;
  the real provider detail is logged on the server only.
- **No personal data in a message or a log row.** Prompts and drafted text are not stored in the usage log.
- **Wording that is not an error is not a code.** The "Needs a look" notice on a draft (a flagged phrase such as a gender preference)
  is a warning on a usable draft, not a failure, so it has no code.
- **One place in code maps a reason to a code and a message,** beside the other `*-messages.ts` maps. Screens never write a
  code or a message themselves.

## The daily limit

| Setting | Meaning | Default |
| --- | --- | --- |
| `AI_DAILY_LIMIT_JOB_DRAFT` | Drafts per Staff member per Manila day for the Job description drafter | 20 |
| `AI_DAILY_LIMIT_SUGGESTIONS` | Suggestion runs per Staff member per Manila day for Development suggestions (a month-end run covers many employees) | 60 |
| `AI_DAILY_BUDGET` | Optional company-wide calls per Manila day across all AI features; unset means no cap | unset |

- **The day is a Manila calendar day.** The count resets at 12:00 AM Manila time, the same business day the rest of HRMS uses.
- **What counts:** every call that reaches the AI provider, including **Regenerate**.
- **What does not count:** a request we refuse (`AI-0089`, `AI-0090`, `AI-0094`), and a call that fails on the provider's side
  (`AI-0091`, `AI-0092`), so Staff are not charged for our failures. An unusable draft (`AI-0093`) does count, because the provider
  was used.
- **No overshoot.** The check and the usage row are written in one SQL statement, so two clicks at the same moment cannot both
  take the last slot.
- **The dialog shows what is left**, for example "17 of 20 drafts left today". At zero the Generate button is disabled and the
  `AI-0089` message shows.

## Where the code is stored

The AI usage log (`hrms_ai_usage`) records, for each call: the Staff member, the feature, the model, token counts, the outcome
and the error code when there is one. Support can find a Staff member's report ("I saw AI-0091 at about 10:15") by the code and
the time. The log holds no prompt text and no drafted text.

## Where it is designed

The proposal frames are in the HRMS page of the Bren Raphael's CRM Figma file, in the row titled "AI · Job description drafter
(proposal)":

- **Dialog · Draft with AI · Limit reached** shows `AI-0089`.
- **Dialog · Draft with AI · Unavailable** shows `AI-0091`.
- **Reference · AI error codes · Job description drafter** is the table above.

## Tests

The AI layer's tests cover each code: the 20th call succeeds and the 21st returns `AI-0089`; the count resets at Manila midnight;
a provider quota error returns `AI-0091` without using a slot; a call over 30 seconds returns `AI-0092`; two bad outputs in a row
return `AI-0093`; with the switch off the call returns `AI-0094`; and two simultaneous calls at the boundary never both succeed.
