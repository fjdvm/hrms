import { cookies } from "next/headers";
import { performanceFor } from "../performance";
import { SESSION_COOKIE } from "./config";

/** Performance for the Staff member making this request. */
export async function performanceForRequest() {
  return performanceFor((await cookies()).get(SESSION_COOKIE)?.value);
}
