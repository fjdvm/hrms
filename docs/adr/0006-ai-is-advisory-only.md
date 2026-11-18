# AI is advisory only

AI in HRMS suggests; a person decides. The AI features (the Job description drafter now, Development suggestions later) never change a score, a rating, a status or a published Job Posting, and never assign anyone to anything. Every AI output is shown to a Staff member to read, edit and choose to use, and it takes effect only through the same actions, validation and audit events as text a person typed. Nothing AI-generated is stored on a Job Posting, so there is no AI marker on the record, and Careers' table is not changed.

We rejected letting AI act on its own (for example publishing a drafted posting, setting an Evaluation rating, or flagging a development need without a person) because these are decisions about people and the company's public voice, and a wrong or biased output would take effect before anyone could catch it. We also rejected storing the AI draft or a "drafted by AI" flag on the posting: HRMS and Careers share one database and Careers owns `job_postings` (ADR-0001), and once a person has read and saved the text it is theirs. The note on the form that the text is AI-drafted and must be checked lasts until they save.

## Consequences

- The AI step writes nothing but its own usage row (`hrms_ai_usage`). Saving and publishing use the existing actions, so audit events (`job_posting.*`) name the Staff member who saved or published, never the AI.
- The wording check (gender, age, marital status, appearance, religion, nationality) only warns on AI output; it never blocks, and it is never run on text a person typed.
- A refusal or failure of an AI feature is a plain message with, on an unexpected error, a Reference ID. It never leaves a posting or an Evaluation half-changed. See `docs/ai-error-codes.md`.
- Any future AI feature that would decide, score, rank or assign (for example screening Applicants) is outside this decision and needs its own ADR and a fresh look.

## Why 0006

"ADR-0005" already means the no-polling decision (`docs/adr/0005-no-polling-anywhere.md` in the Portal repository), which this repository's AGENTS.md cites. HRMS's own ADRs stop at 0004, so this one is numbered 0006 to keep "ADR-0005" meaning one thing.
