import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { ageInMonths, buildPrintRoundProperties, computePrintRoundDue } from "@/lib/print-orders/round-reminders";
import { syncPrintRoundReminders } from "@/lib/print-orders/round-reminder-sync";
import { printedStateFromItems } from "@/lib/print-orders/printed";
import { getBookSlots } from "@/lib/photo-slots";
import { MIN_PRINTS_PER_ORDER, ROUND_REMINDER } from "@/lib/print-orders/config";
import type { SessionPhotoRow } from "@/lib/print-orders/build-order";

const NOW = new Date("2026-10-11T12:00:00Z");
const DAY = 86_400_000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);
const due = (birthdate: string | null, unprintedCount: number, lastOrderAt: Date | null = null) =>
  computePrintRoundDue({ birthdate, now: NOW, unprintedCount, lastOrderAt });

test("age in whole months", () => {
  assert.equal(ageInMonths("2026-07-11", NOW), 3);
  assert.equal(ageInMonths("2026-07-12", NOW), 2); // day not reached yet
  assert.equal(ageInMonths("2025-09-11", NOW), 13);
  assert.equal(ageInMonths("2021-10-11", NOW), 60);
  assert.equal(ageInMonths("2026-12-01", NOW)! < 0, true);
  assert.equal(ageInMonths("not a date", NOW), null);
});

test("no birthdate: property left unset", () => {
  assert.equal(due(null, 40), null);
});

test("welcome_baby: 3-12 months, no order yet, 10+ unprinted", () => {
  assert.equal(due("2026-07-11", 10), "welcome_baby"); // 3 months
  assert.equal(due("2025-10-12", 10), "welcome_baby"); // 11 months 29 days = 11
  assert.equal(due("2025-10-11", 10), "welcome_baby"); // 12 months
  assert.equal(due("2026-07-12", 10), ""); // 2 months
  assert.equal(due("2026-07-11", 9), ""); // too few photos
  assert.equal(due("2026-07-11", 20, ago(1)), ""); // already ordered
});

test("first_year: 13+ months, 10+ unprinted, no order in 60 days", () => {
  assert.equal(due("2025-09-11", 10), "first_year"); // 13 months
  assert.equal(due("2025-09-11", 9), "");
  assert.equal(due("2025-09-11", 30, ago(30)), ""); // ordered 30 days ago
  assert.equal(due("2025-09-11", 30, ago(59)), "");
  assert.equal(due("2025-09-11", 30, ago(60)), "first_year");
  assert.equal(due("2025-09-11", 30, ago(400)), "first_year");
});

test("growing_up: 5+ years, MIN_PRINTS_PER_ORDER+ unprinted, no quiet period", () => {
  assert.equal(due("2021-10-11", MIN_PRINTS_PER_ORDER), "growing_up");
  assert.equal(due("2021-10-11", MIN_PRINTS_PER_ORDER - 1), "");
  assert.equal(due("2021-10-11", MIN_PRINTS_PER_ORDER, ago(2)), "growing_up");
  assert.equal(due("2021-10-12", MIN_PRINTS_PER_ORDER), ""); // 59 months, too few for first_year
  assert.equal(due("2021-10-12", 10), "first_year"); // 59 months, enough for first_year
});

test("future birthdate gives an empty value, not a reminder", () => {
  assert.equal(due("2027-01-01", 40), "");
});

test("thresholds are tied to MIN_PRINTS_PER_ORDER where specified", () => {
  assert.equal(ROUND_REMINDER.GROWING_UP_MIN_UNPRINTED, MIN_PRINTS_PER_ORDER);
});

const slots = getBookSlots("little_camper", undefined);
const photo = (slot_key: string): SessionPhotoRow => ({ slot_key, storage_path: `p/${slot_key}`, print_size: "4x4", status: "uploaded" } as SessionPhotoRow);

test("properties: counts follow the lock; extras by quantity; reprints not counted", () => {
  const rows = slots.slice(0, 14).map((s) => photo(s.key));
  const printed = printedStateFromItems([
    { kind: "slot", item_key: slots[0].key, generation: 1 },
    { kind: "slot", item_key: slots[0].key, generation: 2 }, // a paid reprint of the same slot: still 1 slot
    { kind: "slot", item_key: slots[1].key, generation: 1 },
  ]);
  const p = buildPrintRoundProperties({
    bookTheme: "little_camper",
    birthdate: "2025-09-11",
    now: NOW,
    photoRows: rows,
    extraRows: [{ extra_id: "e1", print_size: "4x6", orientation: "portrait", storage_path: "x", quantity: 3 }] as never,
    printed,
    lastOrderAt: ago(90),
  });
  assert.equal(p.printed_count, 2);
  assert.equal(p.unprinted_count, 12 + 3);
  assert.equal(p.last_print_order_at, ago(90).toISOString());
  assert.equal(p.print_round_due, "first_year");
});

test("properties: no order and no birthdate leave those keys out", () => {
  const p = buildPrintRoundProperties({
    bookTheme: "little_camper", birthdate: null, now: NOW,
    photoRows: [], extraRows: [], printed: printedStateFromItems([]), lastOrderAt: null,
  });
  assert.deepEqual(p, { printed_count: 0, unprinted_count: 0 });
});

let fetchCalls: number;
beforeEach(() => {
  fetchCalls = 0;
  delete process.env.PRINT_ORDERS_ENABLED;
  delete process.env.PRINT_PREVIEW_SECRET;
  process.env.KLAVIYO_API_KEY = "test-key";
  globalThis.fetch = (async () => {
    fetchCalls++;
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
});

test("gate: flag off and no preview cookie → nothing is read or sent", async () => {
  await syncPrintRoundReminders("session-id", { jar: { get: () => undefined } });
  await syncPrintRoundReminders("session-id", { flagOnly: true });
  assert.equal(fetchCalls, 0);
});
