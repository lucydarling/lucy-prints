import { supabaseAdmin } from "@/lib/supabase-server";

/** A print order in any of these states means the book was ordered (held = still waiting for photos, so not yet). */
export const ORDERED_STATUSES = ["ready", "sent", "refused", "error"];

/**
 * Which of these sessions have a print order? Fails OPEN to "none ordered" —
 * a missing label is cosmetic; a failed lookup must never break the book list.
 */
export async function orderedSessionIds(sessionIds: string[]): Promise<Set<string>> {
  if (sessionIds.length === 0) return new Set();
  const { data, error } = await supabaseAdmin
    .from("print_orders")
    .select("session_id")
    .in("session_id", sessionIds)
    .in("status", ORDERED_STATUSES);
  if (error) return new Set();
  return new Set((data ?? []).map((r) => r.session_id as string));
}
