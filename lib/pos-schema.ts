import { PosReadError, type PosSession } from "./pos-connection";

/**
 * The schema check HRMS runs before every read: each granted table and column must exist with the type HRMS expects. A migration
 * that drops and re-creates a table loses its grants, and the role then cannot see the columns at all, so a missing column is
 * also what a lost grant looks like. The check fails with "POS data changed" and the names of what is wrong, and nothing is read.
 *
 * `information_schema.columns` lists only the columns the role may see, so it matches the column-level grants of the contract.
 * Types are checked by family, because the contract names columns and not Postgres types; HRMS needs timestamps with a time zone
 * (a timestamp without one would put orders on the wrong Manila day) and exact numbers for money (never floating point).
 */

const FAMILIES = {
  key: ["integer", "bigint", "uuid", "text", "character varying"],
  int: ["integer", "bigint", "smallint"],
  text: ["text", "character varying"],
  number: ["numeric", "integer", "bigint", "smallint"],
  time: ["timestamp with time zone"],
  flag: ["boolean"],
  any: [],
} as const;
type Family = keyof typeof FAMILIES;

/** The granted tables and columns of the contract (section 3.3), with the family each must belong to. */
export const GRANTED: Record<string, Record<string, Family>> = {
  Orders: { OrderId: "key", OrderSource: "text", OrderType: "text", OrderStatus: "text", TotalAmount: "number", SubmittedBy: "int", LocationId: "int", ApprovedAt: "time", CreatedAt: "time", UpdatedAt: "time" },
  OrderItems: { ItemId: "key", OrderId: "key", VariationId: "key", Quantity: "number", UnitPrice: "number", Subtotal: "number" },
  RefundRequests: { RefundRequestId: "key", OrderId: "key", VariationId: "key", LocationId: "int", QuantityToReturn: "number", Status: "text", RequestedBy: "any", ApprovedBy: "any", ApprovedAt: "time" },
  PosStaffUsers: { Id: "int", AuthUserId: "text" },
  Locations: { LocationId: "int", LocationName: "text", LocationType: "text", IsActive: "flag" },
};

/** What is wrong with the POS schema, as short "Table.Column: ..." lines; empty when it is as expected. */
export async function schemaProblems(session: PosSession): Promise<string[]> {
  const { rows } = await session.query<{ table_name: string; column_name: string; data_type: string }>(
    `SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ANY($1::text[])`, [Object.keys(GRANTED)]);
  const found = new Map(rows.map((row) => [`${row.table_name}.${row.column_name}`, row.data_type]));
  const problems: string[] = [];
  for (const [table, columns] of Object.entries(GRANTED)) {
    for (const [column, family] of Object.entries(columns)) {
      const type = found.get(`${table}.${column}`);
      if (type === undefined) problems.push(`${table}.${column}: missing or not readable`);
      else if (family !== "any" && !(FAMILIES[family] as readonly string[]).includes(type)) problems.push(`${table}.${column}: expected ${FAMILIES[family].join(" or ")}, found ${type}`);
    }
  }
  return problems;
}

/** Stops with "POS data changed" unless the schema is as expected. */
export async function checkSchema(session: PosSession): Promise<void> {
  const problems = await schemaProblems(session);
  if (problems.length > 0) throw new PosReadError("data-changed", problems);
}
