import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMagicLinkEmail } from "../email";
import { babyDetailsUpdate, isNewBirthdate, resumedBabyDetails } from "../baby-details";
import { safeZipName, slotFileName } from "../download-zip";
import { BOOK_THEMES, getBookSlots } from "../photo-slots";

// Found by the 2026-10-13 production end-to-end run (audits/photo-lab-e2e-2026-10-13/).

test("saved email quotes no photo count (it is sent before uploads land)", () => {
  for (const babyName of ["Ollie", undefined]) {
    const { html, subject } = buildMagicLinkEmail({ babyName, token: "tok123", appUrl: "https://example.test" });
    const text = html.replace(/<[^>]+>/g, " ");
    assert.doesNotMatch(text, /\d+\s+photos?\b/i);
    assert.doesNotMatch(text, /saved so far/i);
    assert.match(html, /https:\/\/example\.test\/resume\/tok123/);
    assert.match(text, /Your photos are saved as you add them/);
    assert.match(subject, /saved/);
  }
});

test("resume puts the saved baby name + birthdate into the form state", () => {
  assert.deepEqual(resumedBabyDetails({ babyName: "Fred", babyBirthdate: "2026-08-01" }), {
    pendingBabyName: "Fred",
    pendingBabyBirthdate: "2026-08-01",
  });
  // A book saved without them clears what another book left in this browser.
  assert.deepEqual(resumedBabyDetails({ babyName: null, babyBirthdate: null }), {
    pendingBabyName: "",
    pendingBabyBirthdate: "",
  });
});

test("saving an empty form keeps the stored name and birthdate", () => {
  const row = { baby_name: "Fred", baby_birthdate: "2026-08-01" };
  // What the edit form sends when it is saved blank / with "skip reminders".
  for (const sent of [
    { babyName: null, babyBirthdate: null },
    { babyName: "", babyBirthdate: "" },
    { babyName: "   ", babyBirthdate: undefined },
    {},
  ]) {
    const after = { ...row, ...babyDetailsUpdate(sent) };
    assert.deepEqual(after, row, JSON.stringify(sent));
  }
  // Real values still save (trimmed).
  assert.deepEqual({ ...row, ...babyDetailsUpdate({ babyName: " Freddie ", babyBirthdate: "2026-08-02" }) }, {
    baby_name: "Freddie",
    baby_birthdate: "2026-08-02",
  });
});

test("the signup event is for a new or changed birthdate only", () => {
  assert.equal(isNewBirthdate(null, "2026-08-01"), true);
  assert.equal(isNewBirthdate("2026-08-01", "2026-08-02"), true);
  assert.equal(isNewBirthdate("2026-08-01", "2026-08-01"), false); // untouched form re-saved
  assert.equal(isNewBirthdate("2026-08-01", undefined), false);
  assert.equal(isNewBirthdate(null, undefined), false);
});

test("no ZIP file name has a slash (or other unsafe character) inside a slot name, any book", () => {
  for (const theme of BOOK_THEMES) {
    const slots = getBookSlots(theme.id, undefined);
    for (const slot of slots) {
      for (const [baby, label] of [["Fred", undefined], ["A/B\\C", "Trip: \"one\" / two"], [undefined, undefined]] as const) {
        const name = slotFileName(theme.id, slot, slots, baby, label, `4x4"`);
        // Everything before the size label is built from slot/baby/label text.
        const stem = name.slice(0, name.lastIndexOf(" ("));
        assert.doesNotMatch(stem, /[\\/:*?"<>|]/, `${theme.id} ${slot.key}: ${name}`);
      }
    }
  }
  assert.equal(
    slotFileName("little_camper", getBookSlots("little_camper").find((s) => s.key === "birth_arrival")!, getBookSlots("little_camper"), "Fred", undefined, `4x4"`),
    `04 Birth - Arrival Photo (4x4").jpg`
  );
  assert.equal(safeZipName("a/b\\c"), "a-b-c");
});
