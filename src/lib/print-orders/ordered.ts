import { supabaseAdmin } from "@/lib/supabase-server";

/**
 * How many distinct book slots each of these sessions has had printed (from
 * print_order_items). Fails OPEN to "none printed" — a missing label is
 * cosmetic; a failed lookup must never break the book list.
 */
export async function printedCounts(sessionIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (sessionIds.length === 0) return out;
  const { data, error } = await supabaseAdmin
    .from("print_order_items")
    .select("session_id, item_key")
    .in("session_id", sessionIds)
    .eq("kind", "slot");
  if (error) return out;
  const seen = new Set<string>();
  for (const r of data ?? []) {
    const key = `${r.session_id}|${r.item_key}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.set(r.session_id as string, (out.get(r.session_id as string) ?? 0) + 1);
  }
  return out;
}
