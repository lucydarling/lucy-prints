import { test } from "node:test";
import assert from "node:assert/strict";
import { EXTRA_PRINT_SIZES, getExtraPrintSizes } from "@/lib/photo-slots";
import { milestoneFor, reviewThresholdsFor, type ReviewState } from "@/lib/review-prompt";
import { getReviewUrl } from "@/lib/review-links";

// ── Job 2: extra-print sizes per product ──

test("Little Years extras offer 4x4 and 4x6 only", () => {
  assert.deepEqual([...getExtraPrintSizes("little_years_boy")], ["4x4", "4x6"]);
  assert.deepEqual([...getExtraPrintSizes("little_years_girl")], ["4x4", "4x6"]);
});

test("Memory Book and journal keep their four extra sizes", () => {
  for (const theme of ["little_camper", "honey_bee", "love_grows_moss_green", null, "retired_theme"]) {
    assert.deepEqual([...getExtraPrintSizes(theme)], ["3x3", "4x3", "4x4", "4x6"], String(theme));
  }
  assert.deepEqual([...EXTRA_PRINT_SIZES], ["3x3", "4x3", "4x4", "4x6"]);
});

// ── Job 3: review thresholds per product ──

const fresh: ReviewState = { asks: 0, clicked: false };
const once: ReviewState = { asks: 1, clicked: false };

test("Memory Book and journal ask at 10 and 25", () => {
  for (const theme of ["little_camper", "love_grows_desert_sand"]) {
    const t = reviewThresholdsFor(theme);
    assert.equal(milestoneFor(9, 10, fresh, t), "photos_10");
    assert.equal(milestoneFor(24, 25, once, t), "photos_25");
    assert.equal(milestoneFor(9, 30, fresh, t), "photos_10"); // jump past both: earliest allowed ask
  }
  // The default (no thresholds passed) is unchanged.
  assert.equal(milestoneFor(9, 10, fresh), "photos_10");
});

test("Little Years asks at 30 and 75, not at 10 or 25", () => {
  const t = reviewThresholdsFor("little_years_girl");
  assert.equal(milestoneFor(9, 10, fresh, t), null);
  assert.equal(milestoneFor(24, 25, fresh, t), null);
  assert.equal(milestoneFor(29, 30, fresh, t), "photos_30");
  assert.equal(milestoneFor(74, 75, once, t), "photos_75");
  assert.equal(milestoneFor(29, 75, fresh, t), "photos_30"); // jump past both: earliest allowed ask
});

test("Little Years keeps the max-2-asks and click-stops-everything rules", () => {
  const t = reviewThresholdsFor("little_years_boy");
  assert.equal(milestoneFor(74, 75, { asks: 2, clicked: false }, t), null);
  assert.equal(milestoneFor(29, 30, { asks: 0, clicked: true }, t), null);
  assert.equal(milestoneFor(29, 30, null, t), null);
});

test("Little Years review links carry photos_30 / photos_75", () => {
  assert.match(getReviewUrl("little_years_boy", "photos_30")!, /utm_content=photos_30#/);
  assert.match(getReviewUrl("little_years_girl", "photos_75")!, /utm_content=photos_75#/);
});

// ── Job 1: extra pages per age ──

import {
  EXTRA_PAGES_PER_AGE,
  LITTLE_YEARS_AGES,
  extraPageAge,
  extraPagesFor,
  isAgeFull,
  newExtraPageId,
} from "@/lib/extra-pages";
import { usePhotoStore } from "@/store/photo-store";
import { generateBookDetailsText } from "@/lib/download-zip";
import { getBookPrompts } from "@/lib/book-prompts";
import { getBookSlots, getBookProgress } from "@/lib/photo-slots";

test("five ages of 29 slots, each ending on its last Snapshot", () => {
  assert.deepEqual(LITTLE_YEARS_AGES.map((a) => a.label), ["Age One", "Age Two", "Age Three", "Age Four", "Age Five"]);
  assert.deepEqual(LITTLE_YEARS_AGES.map((a) => a.slots.length), [29, 29, 29, 29, 29]);
  assert.deepEqual(LITTLE_YEARS_AGES.map((a) => a.lastSortOrder), [30, 59, 88, 117, 146]);
  for (const a of LITTLE_YEARS_AGES) assert.match(a.slots.at(-1)!.key, /snapshot/);
});

test("extra-page ids carry their age and pass the server's extra-id check", () => {
  const id = newExtraPageId("a3");
  assert.equal(extraPageAge(id), "a3");
  assert.match(id, /^extra_[a-z0-9_]+$/i); // upload + delete routes
  assert.equal(extraPageAge("extra_1710000000_ab12c"), null); // ordinary extras untouched
});

test("store: 24 extra pages per age, 4x4, and they never count toward 146", () => {
  usePhotoStore.setState({ bookTheme: "little_years_boy", extras: [], photos: {} });
  const s = () => usePhotoStore.getState();
  for (let i = 0; i < 3; i++) assert.ok(s().addExtraPage("a1"));
  for (let i = 0; i < EXTRA_PAGES_PER_AGE; i++) assert.ok(s().addExtraPage("a2"));
  assert.equal(s().addExtraPage("a2"), null, "cap enforced");
  assert.equal(extraPagesFor(s().extras, "a1").length, 3);
  assert.equal(extraPagesFor(s().extras, "a2").length, 24);
  assert.ok(s().extras.every((e) => e.size === "4x4"));
  assert.equal(s().getProgress().total, 146);
  assert.equal(getBookProgress("little_years_boy", {}, {}).total, 146);
});

test("store: restoreExtra keeps the saved id (no duplicate on a second restore)", () => {
  usePhotoStore.setState({ extras: [] });
  const r = { id: "extra_pg_a1_1_x", size: "4x4" as const, orientation: "portrait" as const, url: "data:x", quantity: 1 };
  usePhotoStore.getState().restoreExtra(r);
  usePhotoStore.getState().restoreExtra(r);
  assert.deepEqual(usePhotoStore.getState().extras.map((e) => e.id), ["extra_pg_a1_1_x"]);
  assert.equal(extraPageAge(usePhotoStore.getState().extras[0].id), "a1");
});

test("isAgeFull needs every one of the age's 29 crops", () => {
  const a1 = LITTLE_YEARS_AGES[0];
  const photos: Record<string, { croppedUrl: string | null }> = {};
  for (const s of a1.slots.slice(0, 28)) photos[s.key] = { croppedUrl: "data:x" };
  assert.equal(isAgeFull(photos, a1), false);
  photos[a1.slots[28].key] = { croppedUrl: "data:x" };
  assert.equal(isAgeFull(photos, a1), true);
});

const LY_SLOTS = getBookSlots("little_years_boy", {});
const LY_PROMPTS = getBookPrompts("little_years_boy");

test("Book Details: extra pages listed under their age, after its notes", () => {
  const a1Birthday = LY_PROMPTS.find((p) => p.slotKey.startsWith("ly_a1_birthday"))!;
  const notes = { [a1Birthday.slotKey]: { [a1Birthday.prompts[0].key]: "Grandma came" } };
  const text = generateBookDetailsText(notes, "Ollie", LY_SLOTS, LY_PROMPTS, [
    { label: "Age One", prefixes: ["030-01", "030-02", "030-03"] },
    { label: "Age Three", prefixes: ["088-01"] },
  ])!;
  const lines = text.split("\n");
  const i1 = lines.indexOf("═══ Age One ═══");
  const i3 = lines.indexOf("═══ Age Three ═══");
  const note = lines.findIndex((l) => l.includes("Grandma came"));
  const ep1 = lines.indexOf('  3 photos (4x4"), files 030-01 to 030-03');
  const ep3 = lines.indexOf('  1 photo (4x4"), file 088-01');
  assert.ok(i1 >= 0 && note > i1 && ep1 > note, "Age One: heading, notes, then extra pages");
  assert.ok(i3 > ep1 && ep3 > i3, "Age Three gets its own heading (it has no notes)");
  assert.equal(lines.filter((l) => l === "── Extra pages ──").length, 2);
});

test("Book Details: extra pages alone still produce the sheet; nothing at all produces none", () => {
  assert.ok(generateBookDetailsText({}, "Baby", LY_SLOTS, LY_PROMPTS, [{ label: "Age Two", prefixes: ["059-01"] }]));
  assert.equal(generateBookDetailsText({}, "Baby", LY_SLOTS, LY_PROMPTS, []), null);
});

// ── Storage-full detection (the banner) ──

import { countMissingFromBrowser, isStorageFull, safeLocalStorage, useStorageStatus } from "@/store/storage-status";

test("a failed localStorage write is reported, not thrown; a later success clears it", () => {
  const real = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  let room = true;
  const data = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => {
        if (!room) throw new DOMException("quota", "QuotaExceededError");
        data.set(k, v);
      },
      removeItem: (k: string) => data.delete(k),
    },
  });
  try {
    useStorageStatus.setState({ failedKeys: [] });
    const photos = safeLocalStorage<{ n: number }>();
    const save = safeLocalStorage<{ t: string }>();
    photos.setItem("lucy-prints-photos", { state: { n: 1 }, version: 0 });
    assert.equal(isStorageFull(useStorageStatus.getState()), false);

    room = false;
    assert.doesNotThrow(() => photos.setItem("lucy-prints-photos", { state: { n: 2 }, version: 0 }));
    assert.doesNotThrow(() => save.setItem("lucy-prints-save", { state: { t: "x" }, version: 0 }));
    assert.deepEqual(useStorageStatus.getState().failedKeys, ["lucy-prints-photos", "lucy-prints-save"]);

    // A small store writing fine again must not hide the photos key's failure.
    room = true;
    save.setItem("lucy-prints-save", { state: { t: "y" }, version: 0 });
    assert.equal(isStorageFull(useStorageStatus.getState()), true);
    photos.setItem("lucy-prints-photos", { state: { n: 3 }, version: 0 });
    assert.equal(isStorageFull(useStorageStatus.getState()), false);
  } finally {
    if (real) Object.defineProperty(globalThis, "localStorage", real);
    else delete (globalThis as { localStorage?: unknown }).localStorage;
    useStorageStatus.setState({ failedKeys: [] });
  }
});

test("a saved book's cloud photos with no crop in this browser are counted as missing", () => {
  const photos = { a: { croppedUrl: "data:a" }, b: { croppedUrl: null } };
  const extras = [{ id: "extra_pg_a1_1_x", croppedUrl: "data:x" }, { id: "extra_2", croppedUrl: null }];
  assert.equal(countMissingFromBrowser(["a", "extra_pg_a1_1_x"], photos, extras), 0);
  assert.equal(countMissingFromBrowser(["a", "b", "c", "extra_pg_a1_1_x", "extra_2"], photos, extras), 3);
  assert.equal(countMissingFromBrowser([], {}, []), 0);
});

// ── Print-order extras cap per product ──

import { MAX_EXTRAS_PER_ORDER, maxExtrasPerOrder } from "@/lib/print-orders/config";
import { validatePrintRequest } from "@/lib/print-orders/print-request";

const EXTRAS_PER_BOOK_OF_PAGES = LITTLE_YEARS_AGES.length * EXTRA_PAGES_PER_AGE;

test("extras cap: Little Years 120, every other book 100", () => {
  assert.equal(maxExtrasPerOrder("little_years_boy"), 120);
  assert.equal(maxExtrasPerOrder("little_years_girl"), 120);
  assert.equal(EXTRAS_PER_BOOK_OF_PAGES, 120);
  for (const t of ["little_camper", "love_grows_moss_green", null, "retired_theme"]) assert.equal(maxExtrasPerOrder(t), 100);
  assert.equal(MAX_EXTRAS_PER_ORDER, 100);
});


test("a Memory Book order over 100 extras is still refused", () => {
  const over = (n: number) => validatePrintRequest({ bookTheme: "little_camper", newPhotos: 10, extraPrints: n, reprints: 0 }).errors.some((e) => e.includes("extra prints in one order"));
  assert.equal(over(100), false);
  assert.equal(over(101), true);
});
