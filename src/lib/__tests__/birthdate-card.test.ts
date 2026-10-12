import test from "node:test";
import assert from "node:assert/strict";
import {
  NOT_NOW_DAYS,
  parseBirthdateChoice,
  serializeBirthdateChoice,
  shouldShowBirthdateCard,
  type BirthdateCardInput,
} from "../birthdate-card";

const base: BirthdateCardInput = {
  hasToken: true,
  isMemoryBook: true,
  babyBirthdate: null,
  optedOutOfReminders: false,
  choice: null,
  now: 1_000_000_000_000,
};

test("shows for a saved memory book with no birthdate", () => {
  assert.equal(shouldShowBirthdateCard(base), true);
});

test("hidden without a session, for other books, with a birthdate, or after the reminders opt-out", () => {
  assert.equal(shouldShowBirthdateCard({ ...base, hasToken: false }), false);
  assert.equal(shouldShowBirthdateCard({ ...base, isMemoryBook: false }), false);
  assert.equal(shouldShowBirthdateCard({ ...base, babyBirthdate: "2025-01-02" }), false);
  assert.equal(shouldShowBirthdateCard({ ...base, optedOutOfReminders: true }), false);
});

test("'rather not say' is permanent; 'not now' returns after a week", () => {
  assert.equal(shouldShowBirthdateCard({ ...base, choice: { kind: "never" } }), false);
  const at = base.now - 86_400_000;
  assert.equal(shouldShowBirthdateCard({ ...base, choice: { kind: "not_now", at } }), false);
  const old = base.now - (NOT_NOW_DAYS * 86_400_000 + 1);
  assert.equal(shouldShowBirthdateCard({ ...base, choice: { kind: "not_now", at: old } }), true);
});

test("choice round-trips through storage and junk is ignored", () => {
  for (const c of [{ kind: "never" as const }, { kind: "not_now" as const, at: 123 }]) {
    assert.deepEqual(parseBirthdateChoice(serializeBirthdateChoice(c)), c);
  }
  assert.equal(parseBirthdateChoice(null), null);
  assert.equal(parseBirthdateChoice("garbage"), null);
});
