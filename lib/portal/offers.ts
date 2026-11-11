import { cookies } from "next/headers";
import { offersFor } from "../offers";
import { SESSION_COOKIE } from "./config";

/** Offers for the Staff member making this request. */
export async function offersForRequest() {
  return offersFor((await cookies()).get(SESSION_COOKIE)?.value);
}
