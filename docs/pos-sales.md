# POS sales in Performance: operations note

HRMS reads each cashier's sales from the POS database for two things in Performance: the **Sales KPI** and the **Top sales** card. The decision is in `docs/adr/0007-hrms-reads-pos-sales-through-a-read-only-database-role.md`; the words are in `CONTEXT.md`. The POS and the Portal are not changed.

## The contract in short

The full grants and the sale definition are in the access contract, "POS to HRMS cashier sales integration: access contract" (a Google Doc linked from #486). What HRMS relies on:

- **A read-only role.** `hrms_reader`, created by the POS owner in SQL (not in the Neon Console), with column-level `GRANT SELECT` only. HRMS never writes to the POS database, never runs migrations on it and never calls the POS API.
- **Granted columns** (`lib/pos-schema.ts`, `GRANTED`):
  - `Orders`: OrderId, OrderSource, OrderType, OrderStatus, TotalAmount, SubmittedBy, LocationId, ApprovedAt, CreatedAt, UpdatedAt
  - `OrderItems`: ItemId, OrderId, VariationId, Quantity, UnitPrice, Subtotal
  - `RefundRequests`: RefundRequestId, OrderId, VariationId, LocationId, QuantityToReturn, Status, RequestedBy, ApprovedBy, ApprovedAt
  - `PosStaffUsers`: Id, AuthUserId (the Portal user id)
  - `Locations`: LocationId, LocationName, LocationType, IsActive
- **The sale definition, `net-sales-v1`** (`lib/pos-sales-query.ts`): POS Store orders at a branch, Completed, Refund Requested or Refunded with at least one line, credited to the cashier who submitted them (staff number 1000 or more) on the Manila day of `CreatedAt`. A refunded order stays in gross sales; each approved refund is subtracted on the day it was approved. Net sales is gross minus refunds, so a day can be negative. No customer data, order number or order line is read.
- **Schema check.** Before every read, HRMS checks that each granted table and column exists with the expected type. If one does not (a POS migration that re-created a table loses its grants), the import stops with "POS data changed" and the table and column names, and nothing is read.
- **Timeouts.** One connection per read, a 30 second timeout, and one retry after 5 seconds when the POS cannot be reached.

## The environment variable

| Variable | Where | Secret |
| --- | --- | --- |
| `POS_DATABASE_URL` | Server-side only, in the production environment of the HRMS deployment (see `docs/deploy-vercel.md`). Never a `NEXT_PUBLIC_` variable. | Yes |

It is the connection string of the `hrms_reader` role on `pos_db`. It is never logged, returned or put in an error. With it unset, an import says the POS is not configured and saves nothing. Never commit it; `.env.production.example` and `.env.example` list the name only.

## Before the first import

1. The POS owner has cleared test data from the POS, created `hrms_reader` with the grants above and told HR the production **go-live date**.
2. The connection string is installed as `POS_DATABASE_URL` and the app is redeployed.
3. HR has set the **POS go-live date** in KPI Setup. Until it is set, Import POS sales is refused, and no import reads a day before it.
4. HR has linked each cashier's POS account to their Employee (POS account links). Sales of an account with no link are not counted for anyone; the import preview names those accounts.

## How to run an import

An import runs only when a Staff member who holds Performance clicks **Import POS sales** in the Performance header. Nothing runs on a timer.

1. Click Import POS sales. HRMS reads the previous and the current Manila month, always both, because a late void or refund can reach back.
2. Read the preview: the totals, the database check result, the POS accounts that are not linked to an Employee, and how many sales could not be credited to a cashier (a staff number below 1000, or none). Nothing is saved yet.
3. Click Confirm import to save. It is one transaction: the import record, the branches, the daily figures (upserted by cashier, branch and day) and the audit entry. A day the POS no longer returns is removed, so a stored figure never outlives its source.
4. A POS that is unreachable, or whose data changed, saves nothing. Try again later, or tell the POS owner what the message names.

A month stays **Provisional** on the Top sales card until an import that ran after the month ended has covered all of it, so run an import early in the following month. A Sales KPI is Not applicable until an import has run after its period ended.

The dialog and the header button are built in the "Import POS sales dialog and header button" ticket (#501). The interface calls behind them are `previewPosImport`, `importPosSales` and `listPosImports` in `lib/performance.ts`.

## How to rotate the key

The key is the password in `hrms_reader`'s connection string.

1. The POS owner sets a new password for the role in SQL (`ALTER ROLE hrms_reader PASSWORD '...'`), not in the Neon Console, and gives HR the new connection string through a secure channel, never in chat, a ticket or a commit.
2. Replace `POS_DATABASE_URL` in the production environment and redeploy so the new value is read.
3. Open Import POS sales and look at the preview, which checks the connection and the schema, without saving anything. Cancel it, or confirm if an import was due anyway.
4. Once it works, the POS owner confirms the old password no longer connects.

If the string may have leaked, rotate at once. The role cannot write or read customer data, but it can read the granted columns. To switch the feature off without a deploy of code, the POS owner revokes the grants or drops the role; the next import then stops at the schema check and nothing else changes.

## How to reconcile

Reconciliation is a manual step with no screen. Do it on the POS development database first, and before any real Employee is scored.

1. Run an import and confirm it, so the month is stored.
2. In the POS, run the **Sales Report** for the same month and branch, filtered to Store/Walk-in sales. Its figure is gross minus discounts minus returns.
3. Compare it with the HRMS net sales for that branch and month. The preview's totals give the month; Top sales shows each Cashier's figure for it.
4. Explain any difference. Known causes: orders left out because they cannot be credited to a cashier (shown in the preview), refunds approved in a later month, a bazaar branch not yet mapped to an HRMS branch, and the two old POS refund routes that can still move refund days.
5. Record the result (the month, the branches compared, both figures and who checked) in the reconciliation ticket.

If the figures differ for a reason that is not understood, do not score real Employees on the Sales KPI: leave its weight at 0.
