import { connection, NextResponse } from "next/server";
import { accessibleSystems } from "@/lib/portal/systems";

/** The Systems this person may open, for the module switcher. `null` means unknown. */
export async function GET() {
  // Per request: this answer depends on the signed-in person, so it must never be prerendered.
  await connection();
  return NextResponse.json({ systems: await accessibleSystems() }, { headers: { "cache-control": "no-store" } });
}
