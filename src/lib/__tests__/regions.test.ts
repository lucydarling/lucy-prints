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

test("every journal layout fits its page's measured area, in every orientation it offers", () => {
  for (const region of getRegions(JOURNAL)) {
    const area = JOURNAL_PAGE_AREAS[region.page];
    assert.ok(area, `no measured area for page ${region.page}`);
    for (const layout of region.layouts) {
      for (const o of layout.orientations) {
        const { width, height } = getPrintDimensions(
          layout.size,
          isSquarePrintSize(layout.size) ? undefined : o
        );
        assert.ok(
          fitsGrid(layout.count, width / 300, height / 300, area.width, area.height),
          `p${region.page} ${layout.id} ${o} does not fit ${area.width}x${area.height}`
        );
      }
    }
  }
});

test("each region offers every size at most once, so a stored size names one layout", () => {
  for (const region of getRegions(JOURNAL)) {
    const sizes = region.layouts.map((l) => l.size);
    assert.equal(new Set(sizes).size, sizes.length, region.key);
  }
});

test("month pages hold one photo, except Month 3 which also offers 2 × 3x3", () => {
  for (const region of getRegions(JOURNAL).filter((r) => r.key.startsWith("pj_month_"))) {
    const max = Math.max(...region.layouts.map((l) => l.count));
    if (region.key === "pj_month_3") {
      assert.ok(region.layouts.some((l) => l.id === "2x3x3"));
      assert.equal(max, 2);
    } else {
      assert.equal(max, 1, region.key);
    }
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
        assert.deepEqual(choiceFromPrintLabel(region, label), { layoutId: layout.id, orientation: o });
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
