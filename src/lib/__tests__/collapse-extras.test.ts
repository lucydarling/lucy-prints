import { test } from "node:test";
import assert from "node:assert/strict";
import { RESUME_FIX_LIVE_AT, collapseDuplicateExtras, type CollapsibleExtraRow } from "@/lib/collapse-extras";

// `created` is a day of March 2026 ("1" → 2026-03-01), or a full timestamp.
const row = (id: string, path: string | null, created: string, size = "4x4", orientation = "portrait"): CollapsibleExtraRow & { quantity: number } => ({
  extra_id: id, print_size: size, orientation, storage_path: path, quantity: 1,
  created_at: created.includes("T") ? created : `2026-03-${created.slice(-2).padStart(2, "0")}T12:00:00+00:00`,
});
const etags = (pairs: Record<string, string>) => new Map(Object.entries(pairs));

test("identical copies show once, as the oldest; the rest are hidden behind it", () => {
  const rows = [row("extra_c", "s/extras/c.jpg", "3"), row("extra_a", "s/extras/a.jpg", "1"), row("extra_b", "s/extras/b.jpg", "2")];
  const { rows: shown, hidden } = collapseDuplicateExtras(rows, etags({ "s/extras/a.jpg": "X", "s/extras/b.jpg": "X", "s/extras/c.jpg": "X" }), new Set());
  assert.deepEqual(shown.map((r) => r.extra_id), ["extra_a"]);
  assert.deepEqual(hidden.get("extra_a")!.map((r) => r.extra_id), ["extra_b", "extra_c"]);
});

test("same file but a different size or orientation is a different extra", () => {
  const rows = [row("extra_a", "a", "1"), row("extra_b", "b", "2", "4x6"), row("extra_c", "c", "3", "4x4", "landscape"), row("extra_d", "d", "4")];
  const { rows: shown } = collapseDuplicateExtras(rows, etags({ a: "X", b: "X", c: "X", d: "X" }), new Set());
  assert.deepEqual(shown.map((r) => r.extra_id), ["extra_a", "extra_b", "extra_c"]);
});

test("the printed copy is the one shown, and printed rows are never merged away", () => {
  const rows = [row("extra_a", "a", "1"), row("extra_b", "b", "2"), row("extra_c", "c", "3"), row("extra_d", "d", "4")];
  const e = etags({ a: "X", b: "X", c: "X", d: "X" });
  const one = collapseDuplicateExtras(rows, e, new Set(["extra_c"]));
  assert.deepEqual(one.rows.map((r) => r.extra_id), ["extra_c"]);
  assert.deepEqual(one.hidden.get("extra_c")!.map((r) => r.extra_id), ["extra_a", "extra_b", "extra_d"]);
  const two = collapseDuplicateExtras(rows, e, new Set(["extra_b", "extra_d"]));
  assert.deepEqual(two.rows.map((r) => r.extra_id), ["extra_b", "extra_d"]);
  assert.deepEqual(two.hidden.get("extra_b")!.map((r) => r.extra_id), ["extra_a", "extra_c"]);
});

test("no fingerprint (listing failed) or no stored file: nothing merges", () => {
  const rows = [row("extra_a", "a", "1"), row("extra_b", "b", "2"), row("extra_c", null, "3"), row("extra_d", null, "4")];
  assert.equal(collapseDuplicateExtras(rows, new Map(), new Set()).rows.length, 4);
  assert.equal(collapseDuplicateExtras(rows, etags({ a: "X", b: "X" }), new Set()).rows.length, 3);
});

test("different files never merge; ties on age go to the lowest id", () => {
  const rows = [row("extra_b", "b", "1"), row("extra_a", "a", "1"), row("extra_z", "z", "1")];
  const { rows: shown, hidden } = collapseDuplicateExtras(rows, etags({ a: "X", b: "X", z: "Y" }), new Set());
  assert.deepEqual(shown.map((r) => r.extra_id), ["extra_a", "extra_z"]);
  assert.deepEqual(hidden.get("extra_a")!.map((r) => r.extra_id), ["extra_b"]);
});

test("keeps the shown row's own quantity (not a sum)", () => {
  const rows = [{ ...row("extra_a", "a", "1"), quantity: 2 }, { ...row("extra_b", "b", "2"), quantity: 5 }];
  assert.equal(collapseDuplicateExtras(rows, etags({ a: "X", b: "X" }), new Set()).rows[0].quantity, 2);
});

test("rows created after the resume fix never merge (the same photo added twice on purpose)", () => {
  const after = new Date(Date.parse(RESUME_FIX_LIVE_AT) + 60_000).toISOString();
  const rows = [row("extra_a", "a", "1"), row("extra_b", "b", "2"), row("extra_pg_a1_1", "c", after), row("extra_pg_a1_2", "d", after)];
  const { rows: shown } = collapseDuplicateExtras(rows, etags({ a: "X", b: "X", c: "X", d: "X" }), new Set());
  assert.deepEqual(shown.map((r) => r.extra_id), ["extra_a", "extra_pg_a1_1", "extra_pg_a1_2"]);
  // No age at all: also never merged.
  const unknown = [{ ...row("extra_x", "x", "1"), created_at: null }, { ...row("extra_y", "y", "1"), created_at: null }];
  assert.equal(collapseDuplicateExtras(unknown, etags({ x: "Z", y: "Z" }), new Set()).rows.length, 2);
});
