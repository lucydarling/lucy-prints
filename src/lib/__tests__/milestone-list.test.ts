import { test } from "node:test";
import assert from "node:assert/strict";
import { joinsMilestoneList, subscribeToMilestoneList } from "../klaviyo";
import { BOOK_THEMES } from "../photo-slots";

// Only memory books join "LD | Milestone Reminder Opt-in" (the baby milestone emails).

test("only memory-book themes join the milestone list", () => {
  for (const t of BOOK_THEMES as readonly { id: string; product: string }[]) {
    assert.equal(joinsMilestoneList(t.id), t.product === "memory_book", t.id);
  }
  assert.equal(joinsMilestoneList(undefined), false);
  assert.equal(joinsMilestoneList("not-a-theme"), false);
});

test("a journal or Little Years save sends nothing to Klaviyo's subscription API", async () => {
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    throw new Error("should not be called");
  }) as typeof fetch;
  try {
    for (const theme of ["love_grows_moss_green", "love_grows_desert_sand", "little_years_girl", "little_years_boy"]) {
      const r = await subscribeToMilestoneList("kevin+test@lucydarling.com", theme);
      assert.deepEqual(r, { success: false, consentStatus: "NOT_ATTEMPTED" }, theme);
    }
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = realFetch;
  }
});
