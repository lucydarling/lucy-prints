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
