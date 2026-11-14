import { cookies } from "next/headers";
import { trainingsFor } from "../trainings";
import { SESSION_COOKIE } from "./config";

/** Trainings for the Staff member making this request. */
export async function trainingsForRequest() {
  return trainingsFor((await cookies()).get(SESSION_COOKIE)?.value);
}
