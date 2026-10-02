import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ALL_PRINT_SIZES,
  getPrintDimensions,
  getPrintSizeLabel,
  getSlots,
  isAlwaysPaddedTo4x4,
} from "@/lib/photo-slots";
import { bookPrintItems, summarizePrints } from "@/lib/print-summary";
import type { ExtraPrint, PhotoEntry } from "@/store/photo-store";

const cropped = (slotKey: string): PhotoEntry => ({
  slotKey,
  previewUrl: null,
  croppedUrl: "data:image/jpeg;base64,x",
  status: "cropped",
});

test("3.5x3.5 is 1050px square at 300 DPI and always printed on a 4x4 sheet", () => {
  assert.deepEqual(getPrintDimensions("3.5x3.5"), { width: 1050, height: 1050 });
  assert.equal(getPrintSizeLabel("3.5x3.5"), "3.5x3.5");
  assert.equal(getPrintSizeLabel("3.5x3.5", "landscape"), "3.5x3.5");
  assert.equal(isAlwaysPaddedTo4x4("3.5x3.5"), true);
  assert.equal(isAlwaysPaddedTo4x4("4x3"), true);
  assert.equal(isAlwaysPaddedTo4x4("3x3"), false);
});

test("every print size gets its own row, and the rows add up to the total", () => {
  const items = ALL_PRINT_SIZES.flatMap((size, i) =>
    Array.from({ length: i + 1 }, () => ({ size }))
  );
  const { rows, total } = summarizePrints(items);
  assert.equal(total, items.length);
  assert.deepEqual(
    rows.map((r) => r.size).sort(),
    [...ALL_PRINT_SIZES].sort(),
    "a size is missing from the summary"
  );
  assert.equal(rows.reduce((n, r) => n + r.count, 0), total);
  const half = rows.find((r) => r.size === "3.5x3.5");
  assert.ok(half?.paddedTo4x4);
});

test("a 3.5x3.5 extra is counted, not silently dropped", () => {
  const extras: ExtraPrint[] = [
    { id: "extra_a", size: "3.5x3.5", orientation: "portrait", previewUrl: null, croppedUrl: "data:x", quantity: 1 },
    { id: "extra_b", size: "4x6", orientation: "landscape", previewUrl: null, croppedUrl: "data:x", quantity: 1 },
    { id: "extra_c", size: "4x4", orientation: "portrait", previewUrl: null, croppedUrl: null, quantity: 1 },
  ];
  const { rows, total } = summarizePrints(bookPrintItems([], {}, extras));
  assert.equal(total, 2);
  assert.deepEqual(rows.map((r) => [r.size, r.count]), [["4x6", 1], ["3.5x3.5", 1]]);
});

test("memory book: counts match the slot sizes, unchanged from before", () => {
  const slots = getSlots("little_goose");
  assert.equal(slots.length, 49);
  const photos = Object.fromEntries(slots.map((s) => [s.key, cropped(s.key)]));
  const { rows, total } = summarizePrints(bookPrintItems(slots, photos, []));
  assert.equal(total, 49);
  // 1 ultrasound at 4x3; 4x4 = baby photo, arrival, home, 12 months, 5 birthdays, school.
  assert.deepEqual(
    rows.map((r) => [r.size, r.count]),
    [["4x3", 1], ["4x4", 21], ["3x3", 27]]
  );
});

test("an empty slot is not counted; an uploaded-but-uncropped one is", () => {
  const slots = getSlots("little_goose");
  const photos = {
    baby_photo: cropped("baby_photo"),
    ultrasound: { ...cropped("ultrasound"), croppedUrl: null, status: "uploaded" as const },
    baby_bump: { ...cropped("baby_bump"), croppedUrl: null, status: "empty" as const },
  };
  assert.equal(summarizePrints(bookPrintItems(slots, photos, [])).total, 2);
});
