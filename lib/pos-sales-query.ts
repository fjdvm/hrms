import type { PosSession } from "./pos-connection";

/**
 * The sale definition `net-sales-v1` (access contract, section 3.5) as one read-only query. Nothing here writes, and no customer
 * data, order number or order line leaves the database: it returns one row per cashier, branch and Manila business day.
 *
 *   Scope        OrderSource POS, OrderType Store, a branch (LocationId not null). A bazaar sale is a Store order at a branch whose
 *                type is Bazaar, so it is in scope and found through the branch (see {@link readLocations}).
 *   Cashier      SubmittedBy of 1000 or more, joined to PosStaffUsers (Id to AuthUserId, the Portal user id). Anything else is
 *                unattributed and not counted.
 *   A sale       Completed, Refund Requested or Refunded, with at least one order line. Voided, Void Requested, Cancelled and the
 *                rest are out. A refunded order stays in gross sales; its refund is subtracted on the approval day.
 *   Gross        sum of Orders.TotalAmount (after the Senior/PWD discount) on the Manila day of CreatedAt; orders is the count.
 *   Refunds      approved RefundRequests: QuantityToReturn times UnitPrice, one price per (OrderId, VariationId) so repeated lines
 *                never repeat a refund, on the Manila day of ApprovedAt; credited to the original order's cashier and branch.
 *                Older whole-order refunds (Refunded, Orders.ApprovedAt set, no approved request) use the sum of OrderItems.Subtotal
 *                on the Orders.ApprovedAt day.
 *   Net          gross minus refunds. Gross and refunds can fall in different days or months, so a day can be negative.
 *
 * The contract does not spell out the approved-request status text; it is `Approved` here, to be confirmed on the POS development
 * database before any score is used. `from` and `to` are Manila days, both included.
 */

export const APPROVED_REFUND_STATUS = "Approved";
export const SALE_STATUSES = ["Completed", "Refund Requested", "Refunded"] as const;
const MANILA = (column: string) => `(${column} AT TIME ZONE 'Asia/Manila')::date`;

const SQL = `
WITH sale AS (
  SELECT o."OrderId" AS order_id, o."SubmittedBy" AS staff_id, o."LocationId" AS location_id, o."TotalAmount" AS total,
    o."OrderStatus" AS status, o."ApprovedAt" AS approved_at, ${MANILA('o."CreatedAt"')} AS created_day
  FROM public."Orders" o
  WHERE o."OrderSource" = 'POS' AND o."OrderType" = 'Store' AND o."LocationId" IS NOT NULL AND o."SubmittedBy" >= 1000
    AND o."OrderStatus" = ANY($3::text[])
    AND EXISTS (SELECT 1 FROM public."OrderItems" i WHERE i."OrderId" = o."OrderId")
), gross AS (
  SELECT staff_id, location_id, created_day AS day, count(*) AS orders, sum(total) AS gross
  FROM sale WHERE created_day BETWEEN $1::date AND $2::date GROUP BY 1, 2, 3
), price AS (
  SELECT "OrderId" AS order_id, "VariationId" AS variation_id, max("UnitPrice") AS unit_price FROM public."OrderItems" GROUP BY 1, 2
), refunds AS (
  SELECT s.staff_id, s.location_id, ${MANILA('r."ApprovedAt"')} AS day, sum(r."QuantityToReturn" * p.unit_price) AS refund
  FROM public."RefundRequests" r
  JOIN sale s ON s.order_id = r."OrderId"
  JOIN price p ON p.order_id = r."OrderId" AND p.variation_id = r."VariationId"
  WHERE r."Status" = $4 AND r."ApprovedAt" IS NOT NULL AND ${MANILA('r."ApprovedAt"')} BETWEEN $1::date AND $2::date
  GROUP BY 1, 2, 3
  UNION ALL
  SELECT s.staff_id, s.location_id, ${MANILA("s.approved_at")} AS day, sum(i."Subtotal") AS refund
  FROM sale s JOIN public."OrderItems" i ON i."OrderId" = s.order_id
  WHERE s.status = 'Refunded' AND s.approved_at IS NOT NULL AND ${MANILA("s.approved_at")} BETWEEN $1::date AND $2::date
    AND NOT EXISTS (SELECT 1 FROM public."RefundRequests" r WHERE r."OrderId" = s.order_id AND r."Status" = $4)
  GROUP BY 1, 2, 3
), refund AS (
  SELECT staff_id, location_id, day, sum(refund) AS refund FROM refunds GROUP BY 1, 2, 3
), days AS (
  SELECT staff_id, location_id, day FROM gross UNION SELECT staff_id, location_id, day FROM refund
)
SELECT u."AuthUserId" AS "portalUserId", d.staff_id AS "staffId", d.location_id AS "locationId", d.day::text AS "businessDate",
  coalesce(g.orders, 0)::text AS orders, coalesce(g.gross, 0)::text AS "grossSales", coalesce(r.refund, 0)::text AS "refundAmount",
  (coalesce(g.gross, 0) - coalesce(r.refund, 0))::text AS "netSales"
FROM days d
JOIN public."PosStaffUsers" u ON u."Id" = d.staff_id
LEFT JOIN gross g ON g.staff_id = d.staff_id AND g.location_id = d.location_id AND g.day = d.day
LEFT JOIN refund r ON r.staff_id = d.staff_id AND r.location_id = d.location_id AND r.day = d.day
ORDER BY d.day, d.location_id, d.staff_id`;

export type RawSalesRow = Record<string, unknown>;

/** Runs the query for the Manila days `from` to `to` (inclusive, "YYYY-MM-DD"). The rows are not yet validated; see `pos-sales-map.ts`. */
export async function querySales(session: PosSession, from: string, to: string): Promise<RawSalesRow[]> {
  return (await session.query<RawSalesRow>(SQL, [from, to, [...SALE_STATUSES], APPROVED_REFUND_STATUS])).rows;
}

export type RawLocationRow = Record<string, unknown>;

/** The POS branches and their type (a bazaar is a branch type), for the branch map. Reads the granted `Locations` columns only. */
export async function queryLocations(session: PosSession): Promise<RawLocationRow[]> {
  return (await session.query<RawLocationRow>(`SELECT "LocationId" AS "locationId", "LocationName" AS name, "LocationType" AS type, "IsActive" AS "isActive" FROM public."Locations" ORDER BY "LocationId"`)).rows;
}
