import { test } from "node:test";
import assert from "node:assert/strict";
import { ALL_PRINT_SIZES, getPrintDimensions, isAlwaysPaddedTo4x4 } from "@/lib/photo-slots";
import { PRINT_PRODUCTS, productEntry, resolveDestination } from "@/lib/print-orders/config";
import { buildOrderXml, escapeXmlAttr, validateOrder, type PrintOrderInput } from "@/lib/print-orders/order-xml";

const valid = (): PrintOrderInput => ({
  externalId: "TEST-ABC123",
  vendor: "Lucy Darling Photo Lab",
  customer: { fname: "Pat", lname: "Smith" },
  shipTo: { fname: "Pat", lname: "Smith", address1: "12 Main St", city: "Springfield", state: "IL", zip: "62701", country: "US" },
  deliveryType: "standard",
  items: [{ product: "TBD-4X4", quantity: 2, image: "0001_a.jpg" }],
});
const FILES = ["0001_a.jpg"];

test("every PrintSize has a product mapping, and sheets exist only for always-padded sizes", () => {
  for (const size of ALL_PRINT_SIZES) {
    const cfg = PRINT_PRODUCTS[size];
    assert.ok(cfg && cfg.productCode, `${size} has no mapping`);
    assert.equal(cfg.printedAs === "sheet", isAlwaysPaddedTo4x4(size), size);
    if (cfg.printedAs === "sheet") assert.deepEqual([cfg.sheetWidth, cfg.sheetHeight], [1200, 1200]);
  }
});

test("a valid mail order passes and matches the spec's mail shape", () => {
  assert.deepEqual(validateOrder(valid(), FILES), []);
  const xml = buildOrderXml(valid(), FILES);
  assert.match(xml, /<apm_order external_id="TEST-ABC123" vendor="Lucy Darling Photo Lab">/);
  assert.match(xml, /<customer fname="Pat" lname="Smith"\/>/);
  assert.match(
    xml,
    /<shipment fulfillment_type="mail" delivery_type="standard" fname="Pat" lname="Smith" address1="12 Main St" city="Springfield" state="IL" zip="62701" country="US">/
  );
  assert.match(xml, /<order_item product="TBD-4X4" quantity="2">\s*<image path="0001_a.jpg"\/>\s*<\/order_item>/);
  assert.ok(!xml.includes("email"), "customer email must never be written");
  assert.ok(!xml.includes("<retailer"), "mail orders have no retailer element");
  assert.ok(!xml.includes("price"), "no pricing in this step");
});

const mutate = (f: (o: PrintOrderInput) => void) => {
  const o = valid();
  f(o);
  return validateOrder(o, FILES).join(" | ");
};

test("each spec violation is rejected with a clear message", () => {
  assert.match(mutate((o) => (o.externalId = "x".repeat(33))), /external_id must be 1-32 characters \(got 33/);
  assert.match(mutate((o) => (o.externalId = "")), /external_id must be 1-32/);
  assert.match(mutate((o) => (o.shipTo.address1 = "")), /shipment address1 is required/);
  assert.match(mutate((o) => (o.shipTo.zip = "  ")), /shipment zip is required/);
  assert.match(mutate((o) => (o.items[0].quantity = 0)), /quantity must be a whole number of 1 or more/);
  assert.match(mutate((o) => (o.items[0].quantity = 1.5)), /quantity must be a whole number/);
  assert.match(mutate((o) => (o.items[0].image = "missing.jpg")), /"missing.jpg" is not in the order folder/);
  assert.match(mutate((o) => (o.items[0].image = "../x.jpg")), /relative to the order folder/);
  assert.match(mutate((o) => (o.items[0].image = "a.gif")), /jpeg or png/);
  assert.match(mutate((o) => (o.vendor = "")), /vendor is required/);
  assert.match(mutate((o) => (o.customer = {})), /at least a first or last name/);
  assert.match(mutate((o) => (o.items = [])), /at least one order_item/);
  assert.match(mutate((o) => (o.items[0].product = "")), /product is required/);
  assert.match(mutate((o) => ((o as { deliveryType: string }).deliveryType = "overnight")), /delivery_type must be one of/);
  assert.throws(() => buildOrderXml({ ...valid(), vendor: "" }, FILES), /Invalid print order/);
});

test("special characters are escaped", () => {
  const o = valid();
  o.shipTo.lname = "O'Brien";
  o.shipTo.address1 = 'Smith & Sons <"Unit 5">';
  o.shipTo.city = "Zürich";
  const xml = buildOrderXml(o, FILES);
  assert.match(xml, /lname="O&apos;Brien"/);
  assert.match(xml, /address1="Smith &amp; Sons &lt;&quot;Unit 5&quot;&gt;"/);
  assert.match(xml, /city="Zürich"/);
  assert.equal(escapeXmlAttr("a\u0000b\nc"), "ab c");
});

test("each product's aspect matches the shape of the file it receives (sheet if padded, else the print)", () => {
  for (const size of ALL_PRINT_SIZES) {
    const cfg = PRINT_PRODUCTS[size];
    const d = cfg.printedAs === "sheet" ? { width: cfg.sheetWidth!, height: cfg.sheetHeight! } : getPrintDimensions(size);
    assert.equal(cfg.aspect, Math.max(d.width, d.height) / Math.min(d.width, d.height), size);
  }
});

test("a padded size's aspect follows its print method: sheet → the sheet's shape, native → the print's own", () => {
  assert.equal(PRINT_PRODUCTS["4x3"].printedAs, "sheet");
  assert.equal(PRINT_PRODUCTS["4x3"].aspect, 1);
  assert.equal(PRINT_PRODUCTS["3.5x3.5"].aspect, 1);
  // Flip 4x3 to native and it becomes a 4:3 product.
  assert.equal(productEntry("4x3", { productCode: "X", printedAs: "native" }).aspect, 4 / 3);
  assert.equal(productEntry("4x6", { productCode: "X", printedAs: "native" }).aspect, 1.5);
  assert.throws(() => productEntry("4x3", { productCode: "X", printedAs: "sheet" }), /needs sheetWidth/);
});

test("destination: demo by default with test mode on; live only with the env var and test mode off", () => {
  assert.equal(resolveDestination(undefined, true).kind, "demo");
  assert.equal(resolveDestination("", true).hotfolder, "demo");
  assert.equal(resolveDestination("demo", true).kind, "demo");
  assert.equal(resolveDestination("live", false).kind, "live");
  assert.throws(() => resolveDestination("live", true), /TEST_MODE is on/);
  assert.throws(() => resolveDestination(undefined, false), /TEST_MODE is off/);
  assert.throws(() => resolveDestination("demo", false), /TEST_MODE is off/);
  assert.throws(() => resolveDestination("LIVE", false), /must be "demo" or "live"/);
  assert.throws(() => resolveDestination("prod", true), /must be "demo" or "live"/);
});
