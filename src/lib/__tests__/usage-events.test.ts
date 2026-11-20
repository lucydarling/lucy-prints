import { test } from "node:test";
import assert from "node:assert/strict";
import { isUsageEvent, sanitizeProps, PRINT_FUNNEL_EVENTS } from "@/lib/usage-events";

test("only allow-listed event names are accepted", () => {
  for (const e of ["zip_downloaded", "session_started", "print_price_shown", "print_confirm_cancelled"]) {
    assert.equal(isUsageEvent(e), true);
  }
  for (const e of ["", "drop table", "ZIP_DOWNLOADED", null, 5, undefined]) assert.equal(isUsageEvent(e), false);
});

test("zip_downloaded keeps known props and drops the rest (no personal data)", () => {
  const out = sanitizeProps("zip_downloaded", {
    photo_count: 40, extras_count: 2, print_option: "as-is", book_product: "memory_book", download_number: 1,
    email: "a@b.com", name: "Sam", user_agent: "x",
  });
  assert.deepEqual(out, { photo_count: 40, extras_count: 2, print_option: "as-is", book_product: "memory_book", download_number: 1 });
});

test("bad types and unknown enum values are dropped", () => {
  const out = sanitizeProps("zip_downloaded", { photo_count: "40", extras_count: -1, print_option: "weird", book_product: 3, download_number: 1.5 });
  assert.deepEqual(out, {});
  assert.deepEqual(sanitizeProps("zip_downloaded", null), {});
  assert.deepEqual(sanitizeProps("zip_downloaded", [1, 2]), {});
});

test("session_started keeps only utm + referrer host, trimmed to 100 chars", () => {
  const out = sanitizeProps("session_started", { utm_source: "test", referrer_host: "x".repeat(300), path: "/secret?e=a@b.com" });
  assert.equal(out.utm_source, "test");
  assert.equal((out.referrer_host as string).length, 100);
  assert.equal("path" in out, false);
});

test("print events are the gated ones", () => {
  assert.deepEqual([...PRINT_FUNNEL_EVENTS].sort(), ["print_confirm_cancelled", "print_price_shown"]);
  assert.deepEqual(sanitizeProps("print_confirm_cancelled", { anything: 1 }), {});
});
