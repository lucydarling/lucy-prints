import { test } from "node:test";
import assert from "node:assert/strict";
import { EXTRA_PRINT_SIZES, getExtraPrintSizes } from "@/lib/photo-slots";

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
