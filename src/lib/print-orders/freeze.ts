import { supabaseAdmin } from "@/lib/supabase-server";

export type PrintLock = "frozen" | "held" | null;

export const FROZEN_MESSAGE =
  "This book has been sent to print, so its photos and details can't be changed. Start a new book if you'd like to make another.";

/**
 * Is this session locked because of a print order?
 *  - "frozen": a print order for it is ready or refused — no edits.
 *  - "held": a print order is waiting for photos — the customer may still add them.
 *  - null: no print order.
 * Fails OPEN (null) if the lookup errors or the table does not exist yet:
 * what prints is defined by the snapshot taken at payment, so a missed lock
 * can never change a printed order; a blocked customer would be worse.
 */
export async function getPrintLock(sessionId: string): Promise<PrintLock> {
  const { data, error } = await supabaseAdmin
    .from("print_orders")
    .select("status")
    .eq("session_id", sessionId);
  if (error) {
    // 42P01 / PGRST205 = table not created yet (migration 008 not applied).
    if (!/42P01|PGRST205|does not exist|schema cache/i.test(`${error.code ?? ""} ${error.message}`)) {
      console.error("print lock lookup failed:", error);
    }
    return null;
  }
  return lockFromStatuses((data ?? []).map((r) => r.status as string));
}

/** ready or refused → frozen; otherwise held → held; otherwise unlocked. */
export function lockFromStatuses(statuses: string[]): PrintLock {
  if (statuses.some((s) => s === "ready" || s === "refused")) return "frozen";
  if (statuses.includes("held")) return "held";
  return null;
}
