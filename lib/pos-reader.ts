import { connectFromEnv, withPos, type PosConnect } from "./pos-connection";
import { checkSchema, schemaProblems } from "./pos-schema";
import { mapLocations, mapSales, type PosLocation, type PosSalesDay } from "./pos-sales-map";
import { queryLocations, querySales } from "./pos-sales-query";

export { PosReadError, type PosFailure } from "./pos-connection";
export type { PosLocation, PosSalesDay } from "./pos-sales-map";

/**
 * The POS reader: net sales per Portal account, branch and Manila business day, read from the POS database through the read-only
 * `hrms_reader` role. It writes nothing, and it reads nothing until the schema check passes. A failure is a typed `PosReadError`:
 * "unreachable" (the POS cannot be reached, even after the one retry), "data changed" (the POS no longer has the tables and
 * columns HRMS expects, or returned an unexpected shape) or "not configured" (no connection string). The import service decides
 * what to do with the rows; this module saves none.
 *
 * `connect` and `sleep` are injectable so tests drive it against an in-memory Postgres fixture of the granted tables.
 */
const isDay = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

export function posReader(connect: PosConnect = connectFromEnv(), sleep?: (ms: number) => Promise<void>) {
  return {
    /** The result of the schema check alone, for the import preview: what is wrong, or an empty list when the POS data is as expected. */
    schemaCheck: () => withPos(connect, (session) => schemaProblems(session), sleep),
    /** Net sales for the Manila days `from` to `to` (inclusive, "YYYY-MM-DD"), after the schema check. The import service passes the previous and the current month. */
    readSales: async (range: { from: string; to: string }): Promise<PosSalesDay[]> => {
      if (!isDay(range.from) || !isDay(range.to) || range.from > range.to) throw new RangeError("Not a range of days");
      return withPos(connect, async (session) => {
        await checkSchema(session);
        return mapSales(await querySales(session, range.from, range.to), range);
      }, sleep);
    },
    /** The POS branches with their type, after the schema check. */
    readLocations: () => withPos(connect, async (session) => {
      await checkSchema(session);
      return mapLocations(await queryLocations(session));
    }, sleep) as Promise<PosLocation[]>,
  };
}
