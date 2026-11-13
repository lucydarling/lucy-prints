import { test } from "node:test";
import assert from "node:assert/strict";
import { ALL_PRINT_SIZES } from "@/lib/photo-slots";
import { DEALERS, PRINT_PRODUCTS, PRODUCT_CODES, productEntry, resolveDestination } from "@/lib/print-orders/config";

/** Step 9 (Kevin, 2026-11-13): demo vs live is ONE setting, PRINT_LAB_ENV. */

test("PRINT_LAB_ENV: unset or demo is the demo lab (dealer 3404, demo/ tree); live is dealer 4013 and the live/ tree", () => {
  for (const v of [undefined, "", "  ", "demo"]) {
    assert.deepEqual(resolveDestination(v, true, undefined), { kind: "demo", dealer: "dealer 3404", hotfolder: "demo" });
  }
  for (const testMode of [true, false]) {
    assert.deepEqual(resolveDestination("live", testMode, undefined), { kind: "live", dealer: "dealer 4013", hotfolder: "live" });
  }
  assert.deepEqual(DEALERS, { demo: "dealer 3404", live: "dealer 4013" });
});

test("PRINT_LAB_ENV: real ids never go to the demo lab; anything but demo|live is refused", () => {
  assert.throws(() => resolveDestination(undefined, false, undefined), /TEST_MODE is off/);
  assert.throws(() => resolveDestination("demo", false, undefined), /TEST_MODE is off/);
  for (const bad of ["LIVE", "prod", "production", "4013"]) {
    assert.throws(() => resolveDestination(bad, true, undefined), /PRINT_LAB_ENV must be "demo" or "live"/);
  }
});

test("PRINT_LAB_ENV: the old PRINT_DESTINATION may agree but never silently disagree", () => {
  assert.equal(resolveDestination("live", true, "live").kind, "live");
  assert.equal(resolveDestination(undefined, true, "demo").kind, "demo");
  assert.throws(() => resolveDestination(undefined, true, "live"), /disagrees with PRINT_LAB_ENV="demo"/);
  assert.throws(() => resolveDestination("live", true, "demo"), /disagrees/);
});

test("PRINT_LAB_ENV: read from the environment by default (what the cron checks and delivery call)", () => {
  const saved = { lab: process.env.PRINT_LAB_ENV, old: process.env.PRINT_DESTINATION };
  try {
    delete process.env.PRINT_DESTINATION;
    delete process.env.PRINT_LAB_ENV;
    assert.equal(resolveDestination().kind, "demo");
    process.env.PRINT_LAB_ENV = "live";
    assert.equal(resolveDestination().hotfolder, "live");
  } finally {
    if (saved.lab === undefined) delete process.env.PRINT_LAB_ENV; else process.env.PRINT_LAB_ENV = saved.lab;
    if (saved.old === undefined) delete process.env.PRINT_DESTINATION; else process.env.PRINT_DESTINATION = saved.old;
  }
});

test("live product codes (Kevin's brief 2026-11-13): 4x4 7963, 4x6 7965, 5x5 7969; every size under 4x4 orders as the 4x4 sheet", () => {
  const live = (size: (typeof ALL_PRINT_SIZES)[number]) => PRINT_PRODUCTS.live[size].productCode;
  assert.equal(live("4x4"), "7963");
  assert.equal(live("4x6"), "7965");
  assert.equal(live("5x5"), "7969");
  for (const s of ["3x3", "3.5x3.5", "4x3"] as const) {
    assert.equal(PRINT_PRODUCTS.live[s].printedAs, "sheet", s);
    assert.equal(live(s), "7963", s);
  }
  // No size we actually order resolves to a placeholder on the live lab.
  for (const s of ALL_PRINT_SIZES) assert.doesNotMatch(live(s), /^TBD-/, s);
  // Shapes are identical on both labs; only the codes may differ.
  for (const s of ALL_PRINT_SIZES) {
    const { productCode: _d, ...demo } = PRINT_PRODUCTS.demo[s];
    const { productCode: _l, ...lv } = PRINT_PRODUCTS.live[s];
    void _d; void _l;
    assert.deepEqual(lv, demo, s);
  }
  // The only unconfirmed live code is native 3x4, which nothing uses (4x3 prints on the sheet).
  assert.match(PRODUCT_CODES.live["4x3"], /^TBD-/);
  assert.match(productEntry("4x3", { printedAs: "native" }, PRODUCT_CODES.live).productCode, /^TBD-/);
});
