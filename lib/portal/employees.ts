import { cookies } from "next/headers";
import { employeesFor } from "../employees";
import { SESSION_COOKIE } from "./config";

/** Employee records for the Staff member making this request. */
export async function employeesForRequest() {
  return employeesFor((await cookies()).get(SESSION_COOKIE)?.value);
}
