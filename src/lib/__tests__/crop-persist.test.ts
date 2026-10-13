import { test } from "node:test";
import assert from "node:assert/strict";
import { CROP_REF, isCropRef, listCrops, mapCrops, type PersistedPhotos } from "@/lib/crop-persist";

const state = (): PersistedPhotos & { notes: object; detailsMode: boolean } => ({
  bookTheme: "little_years_boy",
  photos: { ly_story: { croppedUrl: "data:a" }, ly_a1_birthday_1: { croppedUrl: null } },
  extras: [{ id: "extra_pg_a1_1_x", croppedUrl: "data:b" }],
  shelf: {
    memory_book: { photos: { baby_photo: { croppedUrl: "data:c" } }, extras: [{ id: "extra_1_y", croppedUrl: "data:d" }] },
    pregnancy_journal: undefined,
  },
  notes: { ly_story: { name: "Ollie" } },
  detailsMode: true,
});

test("every crop is keyed by its book's product, open book and shelf alike", () => {
  assert.deepEqual(Object.fromEntries(listCrops(state())), {
    "little_years/ly_story": "data:a",
    "little_years/ly_a1_birthday_1": null,
    "little_years/extra_pg_a1_1_x": "data:b",
    "memory_book/baby_photo": "data:c",
    "memory_book/extra_1_y": "data:d",
  });
});

test("an unknown or retired theme files its crops as a memory book", () => {
  assert.deepEqual([...listCrops({ bookTheme: "retired_theme", photos: { x: { croppedUrl: "data:z" } } }).keys()], ["memory_book/x"]);
});

test("swapping crops for references and back round-trips, leaving everything else alone", () => {
  const s = state();
  const meta = mapCrops(s, (k, u) => (u ? CROP_REF + k : u));
  assert.equal(meta.photos!.ly_story.croppedUrl, "idb:little_years/ly_story");
  assert.equal(meta.shelf!.memory_book!.extras![0].croppedUrl, "idb:memory_book/extra_1_y");
  assert.equal(meta.photos!.ly_a1_birthday_1.croppedUrl, null);
  assert.deepEqual(meta.notes, s.notes);
  assert.equal(meta.detailsMode, true);
  assert.equal(meta.shelf!.pregnancy_journal, undefined);
  const urls = new Map(listCrops(s));
  const back = mapCrops(meta, (k, u) => (isCropRef(u) ? urls.get(k) ?? null : u));
  assert.deepEqual(back, s);
  // The input is never changed.
  assert.equal(s.photos!.ly_story.croppedUrl, "data:a");
});
