import { test } from "node:test";
import assert from "node:assert/strict";
import { diffCrops } from "@/lib/crop-sync";

const m = (o: Record<string, string | null>) => new Map(Object.entries(o));

test("first pass after mount: everything cropped is new, nothing is recropped or cleared", () => {
  assert.deepEqual(diffCrops(m({}), m({ a: "u1", b: null })), { newlyCropped: ["a"], recropped: [], cleared: [] });
});

test("a different crop replacing one we had is a re-crop", () => {
  assert.deepEqual(diffCrops(m({ a: "u1" }), m({ a: "u2" })), { newlyCropped: [], recropped: ["a"], cleared: [] });
});

test("the bug: orientation change clears the crop, then a new crop must still upload", () => {
  // 1. uploaded portrait crop; 2. orientation changed -> crop cleared
  const step2 = diffCrops(m({ extra_1: "portrait" }), m({ extra_1: null }));
  assert.deepEqual(step2.cleared, ["extra_1"]);
  // 3. re-cropped landscape: shows as newly cropped — only uploads if step 2
  //    removed it from uploadedSlots (the hook's forgetUploaded does)
  const step3 = diffCrops(m({ extra_1: null }), m({ extra_1: "landscape" }));
  assert.deepEqual(step3.newlyCropped, ["extra_1"]);
});

test("removing a slot photo clears it; a deleted extra is cleared too", () => {
  assert.deepEqual(diffCrops(m({ baby_photo: "u1", extra_9: "u9" }), m({ baby_photo: null })).cleared, ["baby_photo", "extra_9"]);
});

test("unchanged crops produce nothing", () => {
  assert.deepEqual(diffCrops(m({ a: "u1", b: null }), m({ a: "u1", b: null })), { newlyCropped: [], recropped: [], cleared: [] });
});
