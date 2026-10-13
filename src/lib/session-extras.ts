import { supabaseAdmin } from "@/lib/supabase-server";
import { collapseDuplicateExtras } from "@/lib/collapse-extras";
import { getPrintedState, type PrintedState } from "@/lib/print-orders/printed";

/** A session_extras row as every reader uses it. */
export interface StoredExtraRow {
  extra_id: string;
  print_size: string;
  orientation: string | null;
  storage_path: string | null;
  quantity: number;
  created_at: string | null;
}

/**
 * MD5 eTag of every stored file in a session's extras folder, keyed by its
 * storage path. On any error the map is empty, so nothing collapses (every
 * row shows, as before the collapse existed).
 */
async function extrasFingerprints(sessionId: string): Promise<Map<string, string>> {
  const prefix = `${sessionId}/extras`;
  const etags = new Map<string, string>();
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabaseAdmin.storage.from("photos").list(prefix, { limit: pageSize, offset });
    if (error || !data) {
      if (error) console.error("extras fingerprint listing failed:", error);
      return new Map();
    }
    for (const f of data) {
      const etag = (f.metadata as { eTag?: string } | null)?.eTag;
      if (etag) etags.set(`${prefix}/${f.name}`, etag);
    }
    if (data.length < pageSize) return etags;
  }
}

/**
 * A session's extras with duplicate copies collapsed (see collapse-extras.ts).
 * `hidden` maps a shown extra to the copies merged into it, for removal.
 * Shaped like a Supabase result so callers keep their error handling.
 */
export async function loadSessionExtras(
  sessionId: string,
  printed?: PrintedState
): Promise<{ data: StoredExtraRow[] | null; error: unknown; hidden: Map<string, StoredExtraRow[]> }> {
  const [{ data, error }, etags, printedState] = await Promise.all([
    supabaseAdmin
      .from("session_extras")
      .select("extra_id, print_size, orientation, storage_path, quantity, created_at")
      .eq("session_id", sessionId),
    extrasFingerprints(sessionId),
    printed ? Promise.resolve(printed) : getPrintedState(sessionId),
  ]);
  if (error || !data) return { data: null, error: error ?? new Error("no rows"), hidden: new Map() };
  const { rows, hidden } = collapseDuplicateExtras(data as StoredExtraRow[], etags, printedState.extras);
  return { data: rows, error: null, hidden };
}

/** The unprinted copies merged into a shown extra (empty when it has none). */
export async function hiddenCopiesOf(sessionId: string, extraId: string, printed: PrintedState): Promise<StoredExtraRow[]> {
  const { hidden } = await loadSessionExtras(sessionId, printed);
  return hidden.get(extraId) ?? [];
}

/**
 * Remove extra rows the way the delete route removes one: row first, then its
 * file (a failed file removal leaves a harmless orphan, never a row pointing
 * at a missing file). Returns false if a row couldn't be removed.
 */
export async function removeExtraRows(sessionId: string, rows: StoredExtraRow[]): Promise<boolean> {
  if (rows.length === 0) return true;
  const { error } = await supabaseAdmin
    .from("session_extras")
    .delete()
    .eq("session_id", sessionId)
    .in("extra_id", rows.map((r) => r.extra_id));
  if (error) {
    console.error("Extra copies delete (rows) error:", error);
    return false;
  }
  const paths = rows.map((r) => r.storage_path).filter((p): p is string => Boolean(p));
  if (paths.length) {
    const { error: rmError } = await supabaseAdmin.storage.from("photos").remove(paths);
    if (rmError) console.error("Extra copies delete (files) error — orphaned files:", paths, rmError);
  }
  return true;
}
