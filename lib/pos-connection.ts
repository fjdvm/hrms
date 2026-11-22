import { Client } from "pg";

/**
 * The connection to the POS database, read-only through the `hrms_reader` role. The connection string comes from one server-side
 * environment variable and is never logged, returned or put in an error: a failure carries a reason and a short code only.
 *
 * One connection per read, a 30 second timeout (also set on the statement), and one retry after 5 seconds when the POS cannot be
 * reached. HRMS never writes to the POS database: the role has no write grants, and this module offers no way to write.
 */

export const POS_DATABASE_ENV = "POS_DATABASE_URL";
export const POS_TIMEOUT_MS = 30_000;
export const POS_RETRY_DELAY_MS = 5_000;

export type PosSession = { query<T>(sql: string, values?: unknown[]): Promise<{ rows: T[] }> };
export type PosConnection = { session: PosSession; close(): Promise<void> };
export type PosConnect = () => Promise<PosConnection>;

export type PosFailure = "not-configured" | "unreachable" | "data-changed";

/** Why a POS read failed. `problems` lists what changed in the POS data (table and column names only); `code` is a driver code such as ECONNREFUSED. */
export class PosReadError extends Error {
  constructor(public readonly reason: PosFailure, public readonly problems: readonly string[] = [], public readonly code?: string) {
    super(`POS: ${reason}`);
  }
}

/** Opens one read-only connection from the environment. The URL is read here and goes nowhere else. */
export function connectFromEnv(env: Record<string, string | undefined> = process.env): PosConnect {
  return async () => {
    const connectionString = env[POS_DATABASE_ENV];
    if (!connectionString) throw new PosReadError("not-configured");
    const client = new Client({ connectionString, connectionTimeoutMillis: POS_TIMEOUT_MS, query_timeout: POS_TIMEOUT_MS, statement_timeout: POS_TIMEOUT_MS, application_name: "hrms-performance-import" });
    client.on("error", () => {});
    try {
      await client.connect();
    } catch (error) {
      await client.end().catch(() => {});
      throw new PosReadError("unreachable", [], codeOf(error));
    }
    return { session: { query: async <T>(sql: string, values?: unknown[]) => ({ rows: (await client.query(sql, values)).rows as T[] }) }, close: () => client.end() };
  };
}

const codeOf = (error: unknown) => (error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : undefined);

/** A missing table, a missing column or a refused grant (SQLSTATE class 42) means the POS data changed; it is not worth retrying. */
const isDataChange = (code: string | undefined) => code !== undefined && /^42/.test(code);

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Runs `run` on a fresh connection and closes it. When the POS cannot be reached (or a query times out) it tries once more after
 * 5 seconds, then fails with "unreachable". A "data changed" failure is not retried. `sleep` is injectable so tests need not wait.
 */
export async function withPos<T>(connect: PosConnect, run: (session: PosSession) => Promise<T>, sleep: (ms: number) => Promise<void> = wait): Promise<T> {
  let last: PosReadError | undefined;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    if (attempt > 1) await sleep(POS_RETRY_DELAY_MS);
    let connection: PosConnection | undefined;
    try {
      connection = await connect();
      return await run(connection.session);
    } catch (error) {
      if (error instanceof PosReadError) {
        if (error.reason !== "unreachable") throw error;
        last = error;
      } else if (isDataChange(codeOf(error))) {
        throw new PosReadError("data-changed", ["a query was refused by the POS database"], codeOf(error));
      } else {
        last = new PosReadError("unreachable", [], codeOf(error));
      }
    } finally {
      await connection?.close().catch(() => {});
    }
  }
  throw last ?? new PosReadError("unreachable");
}
