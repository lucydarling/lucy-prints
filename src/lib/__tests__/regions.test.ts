import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BOOK_THEMES,
  PHOTO_SLOTS,
  SLOTS_BY_PRODUCT,
  choiceFromPrintLabel,
  getBookProgress,
  getBookSlots,
  getPrintDimensions,
  getPrintSizeLabel,
  getRegions,
  getSlots,
  isSquarePrintSize,
  parsePrintLabel,
} from "@/lib/photo-slots";
import { regionChoicesFromStoredPhotos } from "@/lib/photo-slots";
import { JOURNAL_PAGE_AREAS } from "@/lib/journal-slots";

const JOURNAL = "love_grows_desert_sand";
const GAP = 0.25;

/** Do `count` prints of w×h inches fit in W×H, in a grid, 0.25" apart? */
function fitsGrid(count: number, w: number, h: number, W: number, H: number): boolean {
  for (let rows = 1; rows <= count; rows++) {
    const cols = Math.ceil(count / rows);
    if (cols * w + (cols - 1) * GAP <= W + 1e-9 && rows * h + (rows - 1) * GAP <= H + 1e-9) {
      return true;
    }
  }
  return false;
}

/** Does the layout fit inside ONE of the page's rectangles? */
function fitsAnyRect(
  page: number,
  count: number,
  w: number,
  h: number
): boolean {
  return JOURNAL_PAGE_AREAS[page].some((r) => fitsGrid(count, w, h, r.width, r.height));
}

test("journal areas are at most two rectangles, inside the 8.5\" trim with a 0.375\" margin", () => {
  for (const region of getRegions(JOURNAL)) {
    const areas = JOURNAL_PAGE_AREAS[region.page];
    assert.ok(areas && areas.length >= 1 && areas.length <= 2, `p${region.page} areas`);
    for (const r of areas) {
      assert.ok(r.x >= 0.375 - 1e-9 && r.y >= 0.375 - 1e-9, `p${region.page} starts inside the margin`);
      assert.ok(r.x + r.width <= 8.125 + 1e-9 && r.y + r.height <= 8.125 + 1e-9, `p${region.page} ends inside the margin`);
    }
  }
});

test("every journal layout fits one of its page's rectangles, in every orientation it offers", () => {
  for (const region of getRegions(JOURNAL)) {
    assert.ok(JOURNAL_PAGE_AREAS[region.page], `no measured area for page ${region.page}`);
    for (const layout of region.layouts) {
      for (const o of layout.orientations) {
        const { width, height } = getPrintDimensions(
          layout.size,
          isSquarePrintSize(layout.size) ? undefined : o
        );
        assert.ok(
          fitsAnyRect(region.page, layout.count, width / 300, height / 300),
          `p${region.page} ${layout.id} ${o} does not fit its page area`
        );
      }
    }
  }
});

test("a layout bigger than the page area is caught by the fit check", () => {
  // p3's area is 7.75 x 3.7: a 4x4 (4.0 tall) must not fit, 4 x 3x3 must not fit.
  assert.equal(fitsAnyRect(3, 1, 4, 4), false);
  assert.equal(fitsAnyRect(3, 4, 3, 3), false);
  assert.equal(fitsAnyRect(3, 2, 3, 3), true);
});

// Illustrations may be covered (Kevin, 2026-10-13); layouts are only ever added.
// Saved sessions reference these ids, so none may be removed or renamed.
const SHIPPED_LAYOUT_IDS: Record<string, string[]> = {
  pj_big_news: ["2x3x3", "1x4x3"],
  pj_first_ultrasound: ["2x3x3", "1x4x3"],
  pj_month_1_2: ["1x4x4", "1x4x3", "1x3x3", "1x4x6"],
  pj_month_3: ["1x4x3", "2x3x3"],
  pj_month_4: ["1x4x4", "1x4x3", "1x3x3"],
  pj_month_5: ["1x4x4", "1x4x3", "1x3x3"],
  pj_month_6: ["1x4x3", "1x3x3"],
  pj_month_7: ["1x4x4", "1x4x3", "1x3x3"],
  pj_month_8: ["1x4x4", "1x4x3", "1x3x3"],
  pj_month_9: ["1x4x4", "1x4x3", "1x3x3", "1x4x6"],
  pj_shower_p16: ["4x3x3", "2x4x3", "1x4x4", "1x4x6"],
  pj_shower_p17: ["4x3x3", "2x4x3", "1x4x4", "1x4x6"],
  pj_shower_p18: ["4x3x3", "2x4x3", "1x4x4", "1x4x6"],
  pj_first_photos: ["2x3x3", "2x4x3", "1x4x4", "1x4x6"],
  pj_born_photos: ["4x3x3", "2x4x3", "1x4x4", "1x4x6"],
  pj_birth_announcement: ["1x4x6"],
  pj_adjusting: ["2x3x3", "2x4x3", "1x4x4", "1x4x6"],
  pj_sleepy: ["4x3x3", "2x4x3", "1x4x4", "1x4x6"],
};

test("every shipped layout id is still offered, and page 28 gains 4 x 3x3", () => {
  for (const region of getRegions(JOURNAL)) {
    const ids = region.layouts.map((l) => l.id);
    for (const id of SHIPPED_LAYOUT_IDS[region.key]) assert.ok(ids.includes(id), `${region.key} lost ${id}`);
    assert.equal(ids[0], SHIPPED_LAYOUT_IDS[region.key][0], `${region.key} default layout changed`);
  }
  const p28 = getRegions(JOURNAL).find((r) => r.key === "pj_adjusting")!;
  assert.ok(p28.layouts.some((l) => l.id === "4x3x3"));
});

test("each region offers each count + size at most once", () => {
  for (const region of getRegions(JOURNAL)) {
    const ids = region.layouts.map((l) => l.id);
    assert.equal(new Set(ids).size, ids.length, region.key);
  }
});

test("month pages hold one photo by default and offer at most 2 x 3x3 as the larger layout", () => {
  for (const region of getRegions(JOURNAL).filter((r) => r.key.startsWith("pj_month_"))) {
    assert.equal(region.layouts[0].count, 1, `${region.key} default`);
    for (const l of region.layouts) {
      assert.ok(l.count === 1 || l.id === "2x3x3" || region.key === "pj_month_3", `${region.key} ${l.id}`);
    }
    assert.ok(region.layouts.some((l) => l.id === "2x3x3"), `${region.key} offers 2 x 3x3`);
  }
});

test("journal fixed slots: p12 is 3x3, p19 and p26 are the 3.5\" printed boxes", () => {
  const fixed = getSlots(JOURNAL).filter((s) => !s.region);
  assert.deepEqual(
    fixed.map((s) => [s.page, s.size]),
    [[12, "3x3"], [12, "3x3"], [19, "3.5x3.5"], [19, "3.5x3.5"], [19, "3.5x3.5"], [26, "3.5x3.5"], [26, "3.5x3.5"]]
  );
});

test("a stored print size maps back to the layout and orientation that made it", () => {
  for (const region of getRegions(JOURNAL)) {
    for (const layout of region.layouts) {
      for (const o of layout.orientations) {
        const label = getPrintSizeLabel(layout.size, isSquarePrintSize(layout.size) ? undefined : o);
        // With no photo count the first (original) layout of that size answers.
        const first = region.layouts.find((l) => l.size === layout.size)!;
        const got = choiceFromPrintLabel(region, label, layout.count);
        assert.equal(got?.layoutId, layout.id, `${region.key} ${label} x${layout.count}`);
        assert.ok(choiceFromPrintLabel(region, label), `${region.key} ${label}`);
        void first;
      }
    }
  }
  assert.deepEqual(parsePrintLabel("3x4"), { size: "4x3", orientation: "portrait" });
  assert.deepEqual(parsePrintLabel("6x4"), { size: "4x6", orientation: "landscape" });
  assert.deepEqual(parsePrintLabel("3.5x3.5"), { size: "3.5x3.5" });
  assert.equal(parsePrintLabel("5x7"), null);
});

test("the chosen layout decides how many region photos are in use, and their shape", () => {
  const p16 = (choices = {}) => getBookSlots(JOURNAL, choices).filter((s) => s.region === "pj_shower_p16");
  assert.equal(p16().length, 4); // default 4 × 3x3
  const two = p16({ pj_shower_p16: { layoutId: "2x4x3", orientation: "portrait" } });
  assert.deepEqual(two.map((s) => [s.key, getPrintSizeLabel(s.size, s.orientation)]), [
    ["pj_shower_p16_1", "3x4"],
    ["pj_shower_p16_2", "3x4"],
  ]);
  // An orientation the layout doesn't offer falls back to one it does.
  const p21 = getBookSlots(JOURNAL, { pj_first_photos: { layoutId: "2x4x3", orientation: "landscape" } })
    .filter((s) => s.region === "pj_first_photos");
  assert.deepEqual(p21.map((s) => s.orientation), ["portrait", "portrait"]);
});

test("progress counts each region once, done when any photo in it is added", () => {
  const total = getBookProgress(JOURNAL, {}).total;
  assert.equal(total, 7 + getRegions(JOURNAL).length);
  const photos = {
    pj_shower_p16_3: { status: "cropped" },
    pj_nursery: { status: "uploaded" },
    pj_month_4_1: { status: "empty" },
  };
  assert.equal(getBookProgress(JOURNAL, photos).done, 2);
});

test("memory books are untouched: same 49 slots, no regions, no orientation", () => {
  assert.equal(getBookSlots("little_goose"), PHOTO_SLOTS);
  assert.equal(getBookProgress("little_goose", {}).total, 49);
  assert.ok(PHOTO_SLOTS.every((s) => s.orientation === undefined && !s.region));
});

test("slot keys are unique across books and safe for a storage path", () => {
  const all = Object.values(SLOTS_BY_PRODUCT).flat().map((s) => s.key);
  assert.equal(new Set(all).size, all.length);
  for (const key of all) assert.match(key, /^[a-z0-9_]+$/);
  assert.equal(BOOK_THEMES.filter((t) => t.product === "pregnancy_journal").length, 2);
});

test("resuming a saved journal: stored sizes resolve to the layout they were made with", () => {
  // A session saved before the re-measure: p28 with two 3x3 photos is still 2 x 3x3.
  const old = regionChoicesFromStoredPhotos(JOURNAL, {
    pj_adjusting_1: { printSize: "3x3" },
    pj_adjusting_2: { printSize: "3x3" },
  });
  assert.equal(old.pj_adjusting.layoutId, "2x3x3");
  // Three or four photos at 3x3 can only be the new 4 x 3x3.
  const four = regionChoicesFromStoredPhotos(JOURNAL, {
    pj_adjusting_1: { printSize: "3x3" },
    pj_adjusting_3: { printSize: "3x3" },
  });
  assert.equal(four.pj_adjusting.layoutId, "4x3x3");
  // Shower pages keep 4 x 3x3 (their original default).
  const shower = regionChoicesFromStoredPhotos(JOURNAL, { pj_shower_p16_4: { printSize: "3x3" } });
  assert.equal(shower.pj_shower_p16.layoutId, "4x3x3");
});
