import { test } from "node:test";
import assert from "node:assert/strict";
import { joinsMilestoneList, subscribeToMilestoneList, profileProperties } from "../klaviyo";
import { milestoneOptOutUpdate, resumedBabyDetails, babyDetailsUpdate } from "../baby-details";
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

// "I don't want milestone reminders" (2026-10-13)

test("an opted-out parent never joins the milestone list, and nothing is sent", async () => {
  assert.equal(joinsMilestoneList("little_camper", true), false);
  assert.equal(joinsMilestoneList("little_camper", false), true);
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    throw new Error("should not be called");
  }) as typeof fetch;
  try {
    assert.deepEqual(await subscribeToMilestoneList("kevin+test@lucydarling.com", "little_camper", true), {
      success: false,
      consentStatus: "NOT_ATTEMPTED",
    });
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("opt-out columns: only an explicit boolean is written, and never the birthdate", () => {
  assert.deepEqual(milestoneOptOutUpdate(true), { milestone_opt_out: true });
  assert.deepEqual(milestoneOptOutUpdate(false), { milestone_opt_out: false });
  for (const v of [undefined, null, "true", 1]) assert.deepEqual(milestoneOptOutUpdate(v), {});
  // What the edit form sends when the box is ticked: the birthdate stays.
  const row = { baby_birthdate: "2026-08-01", milestone_opt_out: false };
  const after = { ...row, ...babyDetailsUpdate({ babyBirthdate: null }), ...milestoneOptOutUpdate(true) };
  assert.equal(after.baby_birthdate, "2026-08-01");
  assert.equal(after.milestone_opt_out, true);
});

test("Klaviyo property milestone_reminders_opt_out follows the session; absent when unknown", () => {
  assert.equal(profileProperties({ email: "a@b.c", milestoneOptOut: true }).milestone_reminders_opt_out, true);
  assert.equal(profileProperties({ email: "a@b.c", milestoneOptOut: false }).milestone_reminders_opt_out, false);
  assert.ok(!("milestone_reminders_opt_out" in profileProperties({ email: "a@b.c" })));
});

test("resume restores the opt-out into the form", () => {
  assert.equal(resumedBabyDetails({ babyName: "F", babyBirthdate: "2026-08-01", milestoneOptOut: true }).birthdateOptOut, true);
});
