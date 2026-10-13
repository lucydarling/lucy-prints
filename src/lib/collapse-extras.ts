/**
 * Duplicate extras, collapsed on load.
 *
 * Until 2026-10-13 every resume re-created each extra under a new id and
 * uploaded it again, so some sessions hold the same extra many times over
 * (one had 226 rows for 5 files). The rows are never deleted for that (they
 * are customer photos); instead every reader shows each set once.
 *
 * Rows match when their stored files are byte-identical (same MD5 eTag) AND
 * they have the same print size and orientation. A set shows as one extra:
 * the printed row if there is one, otherwise the oldest (ties: lowest id),
 * at its own quantity. A printed row is never merged away. A row with no
 * stored file, or whose fingerprint is unknown, is never merged.
 *
 * Only rows created before the resume fix went live can be merged. After it,
 * identical files mean the parent added the same photo twice on purpose (the
 * same photo with the default crop gives the same bytes), which must stay two
 * prints.
 */

/** When the resume fix (lucy-prints 235b4e5, deployed with 5b47834) was live. */
export const RESUME_FIX_LIVE_AT = "2026-10-13T18:00:00Z";
const fixLive = Date.parse(RESUME_FIX_LIVE_AT);

export interface CollapsibleExtraRow {
  extra_id: string;
  print_size: string;
  orientation: string | null;
  storage_path: string | null;
  created_at?: string | null;
}

export interface CollapsedExtras<R extends CollapsibleExtraRow> {
  /** One row per extra the customer sees, oldest first. */
  rows: R[];
  /** extra_id of a shown row → the hidden (unprinted) rows merged into it. */
  hidden: Map<string, R[]>;
}

const byAge = (a: CollapsibleExtraRow, b: CollapsibleExtraRow) =>
  (a.created_at ?? "").localeCompare(b.created_at ?? "") || a.extra_id.localeCompare(b.extra_id);

export function collapseDuplicateExtras<R extends CollapsibleExtraRow>(
  rows: R[],
  /** storage_path → MD5 eTag. A missing entry means "unknown": never merged. */
  etagByPath: Map<string, string>,
  /** extra_id of every printed extra. */
  printed: Set<string>
): CollapsedExtras<R> {
  const sets = new Map<string, R[]>();
  const single: R[] = [];
  for (const row of rows) {
    const etag = row.storage_path ? etagByPath.get(row.storage_path) : undefined;
    const created = Date.parse(row.created_at ?? "");
    // Unknown age counts as "after the fix": never merged.
    if (!etag || !(created < fixLive)) {
      single.push(row);
      continue;
    }
    const key = `${etag}|${row.print_size}|${row.orientation === "landscape" ? "landscape" : "portrait"}`;
    const set = sets.get(key);
    if (set) set.push(row);
    else sets.set(key, [row]);
  }

  const shown: R[] = [...single];
  const hidden = new Map<string, R[]>();
  for (const set of sets.values()) {
    set.sort(byAge);
    const printedRows = set.filter((r) => printed.has(r.extra_id));
    const unprinted = set.filter((r) => !printed.has(r.extra_id));
    // Every printed row stays visible; the unprinted copies merge into the
    // first printed one, or (none printed) into the oldest.
    const keep = printedRows[0] ?? unprinted[0];
    shown.push(...printedRows);
    if (!printedRows.length) shown.push(keep);
    const merged = unprinted.filter((r) => r !== keep);
    if (merged.length) hidden.set(keep.extra_id, merged);
  }
  shown.sort(byAge);
  return { rows: shown, hidden };
}
