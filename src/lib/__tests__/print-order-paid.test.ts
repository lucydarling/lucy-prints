import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import sharp from "sharp";
import { getPrintDimensions, getPrintSizeLabel, getSlots } from "@/lib/photo-slots";
import { EXTRAS_FREE_CAP } from "@/lib/print-orders/config";
import { handlePaidOrder, type PaidOrderDeps, type PaidOrderResult, type ShopifyPaidOrder } from "@/lib/print-orders/paid-order";
import { verifyShopifyHmac } from "@/lib/print-orders/webhook-hmac";
import { buildOrder } from "@/lib/print-orders/build-order";

const STD = "111";
const LUX = "222";
const EXTRA = "333";
const THEME = "little_artist"; // standard memory book

const cache = new Map<string, Buffer>();
async function img(w: number, h: number): Promise<Buffer> {
  const k = `${w}x${h}`;
  if (!cache.has(k)) {
    const noise = Buffer.alloc(w * h * 3);
    for (let i = 0; i < noise.length; i++) noise[i] = (i * 2654435761) >>> 24;
    cache.set(k, await sharp(noise, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 70 }).toBuffer());
  }
  return cache.get(k)!;
}

/** A session with every slot of the book filled at its exact size. */
function sessionRows(skip: string[] = []) {
  return getSlots(THEME)
    .filter((s) => !skip.includes(s.key))
    .map((s) => {
      const d = getPrintDimensions(s.size, s.orientation);
      return { slot_key: s.key, storage_path: `p/${d.width}x${d.height}`, print_size: getPrintSizeLabel(s.size, s.orientation), status: "cropped" };
    });
}
const fetchImage = async (p: string) => {
  const [w, h] = p.replace("p/", "").split("x").map(Number);
  return img(w, h);
};

const orderJson = (over: Partial<ShopifyPaidOrder> = {}): ShopifyPaidOrder => ({
  id: 5550001,
  name: "#1001",
  line_items: [{ variant_id: Number(STD), quantity: 1 }],
  note_attributes: [
    { name: "session_token", value: "tok" },
    { name: "book_theme", value: THEME },
    { name: "photo_count", value: "999" }, // must be ignored: never an entitlement source
  ],
  shipping_address: { first_name: "Pat", last_name: "Smith", address1: "12 Main St", city: "Springfield", province_code: "IL", zip: "62701", country_code: "US" },
  customer: { first_name: "Pat", last_name: "Smith" },
  ...over,
});

function deps(over: { skip?: string[]; extras?: number; otherReady?: boolean; rows?: ReturnType<typeof sessionRows> } = {}) {
  const recorded: Array<PaidOrderResult & { shopifyOrderId: string }> = [];
  const d: PaidOrderDeps = {
    variants: { standardVariantId: STD, luxuryVariantId: LUX, extraVariantIds: [EXTRA] },
    loadSession: async (token) => {
      if (token !== "tok") throw new Error("Session not found");
      return {
        session: { id: "sess-1", book_theme: THEME },
        photoRows: over.rows ?? sessionRows(over.skip),
        extraRows: Array.from({ length: over.extras ?? 0 }, (_, i) => ({
          extra_id: `extra_${i}`, print_size: "4x4", orientation: "portrait", storage_path: "p/1200x1200", quantity: 1,
        })),
        fetchImage,
      };
    },
    otherReadyOrderForSession: async () => over.otherReady ?? false,
    record: async (r) => { recorded.push(r); },
  };
  return { d, recorded };
}

test("a fully paid, fully filled memory book is ready (test-mode id)", async () => {
  const { d, recorded } = deps();
  const r = await handlePaidOrder(orderJson(), d);
  assert.equal(r.status, "ready", r.reasons.join(";"));
  assert.equal(r.externalId, "TEST-5550001");
  assert.equal(r.printCount, getSlots(THEME).length);
  assert.equal(recorded.length, 1);
});

test("an order with no print line item is ignored and not recorded", async () => {
  const { d, recorded } = deps();
  const r = await handlePaidOrder(orderJson({ line_items: [{ variant_id: 999, quantity: 1 }] }), d);
  assert.equal(r.status, "ignored");
  assert.equal(recorded.length, 0);
});

test("any empty paid slot holds the order (nothing built)", async () => {
  const { d, recorded } = deps({ skip: ["month_3", "baby_bump"] });
  const r = await handlePaidOrder(orderJson(), d);
  assert.equal(r.status, "held");
  assert.match(r.reasons[0], /2 paid slot\(s\) have no photo yet \(.*(month_3|baby_bump)/);
  assert.equal(recorded[0].status, "held");
});

test("extras beyond the free cap are refused unless paid for; paid units raise the cap", async () => {
  const over = EXTRAS_FREE_CAP + 1;
  const a = await handlePaidOrder(orderJson(), deps({ extras: over }).d);
  assert.equal(a.status, "refused");
  assert.match(a.reasons[0], new RegExp(`${over} extra prints but only ${EXTRAS_FREE_CAP}`));

  const paid = orderJson({ line_items: [{ variant_id: Number(STD), quantity: 1 }, { variant_id: Number(EXTRA), quantity: 1 }] });
  assert.equal((await handlePaidOrder(paid, deps({ extras: over }).d)).status, "ready");
});

test("a photo in a slot that was not paid for refuses the order", async () => {
  const rows = [...sessionRows(), { slot_key: "not_a_slot", storage_path: "p/1200x1200", print_size: "4x4", status: "cropped" }];
  const r = await handlePaidOrder(orderJson(), deps({ rows }).d);
  assert.equal(r.status, "refused");
  assert.match(r.reasons[0], /did not pay for: not_a_slot/);
});

test("the photo_count attribute never changes what was paid for", async () => {
  const { d } = deps({ skip: ["month_3"] });
  const r = await handlePaidOrder(orderJson(), d); // photo_count says 999
  assert.equal(r.status, "held");
});

test("tier, theme, token and quantity problems refuse with a clear reason", async () => {
  const lux = await handlePaidOrder(orderJson({ line_items: [{ variant_id: Number(LUX), quantity: 1 }] }), deps().d);
  assert.match(lux.reasons[0], /paid for the luxury print product but little_artist is a standard book/);

  const two = await handlePaidOrder(orderJson({ line_items: [{ variant_id: Number(STD), quantity: 2 }] }), deps().d);
  assert.match(two.reasons[0], /quantity 1/);

  const noTok = await handlePaidOrder(orderJson({ note_attributes: [{ name: "book_theme", value: THEME }] }), deps().d);
  assert.match(noTok.reasons[0], /no session_token/);

  const wrongTheme = await handlePaidOrder(orderJson({ note_attributes: [{ name: "session_token", value: "tok" }, { name: "book_theme", value: "honey_bee" }] }), deps().d);
  assert.match(wrongTheme.reasons[0], /paid for the standard print product but honey_bee is a luxury book/);

  const journal = await handlePaidOrder(orderJson({ note_attributes: [{ name: "session_token", value: "tok" }, { name: "book_theme", value: "love_grows_desert_sand" }] }), deps().d);
  assert.match(journal.reasons[0], /not supported for printing yet/);

  const sessionMismatch = await handlePaidOrder(orderJson({ note_attributes: [{ name: "session_token", value: "tok" }, { name: "book_theme", value: "little_camper" }] }), deps().d);
  assert.match(sessionMismatch.reasons[0], /order says little_camper but the session is little_artist/);

  const missingSession = await handlePaidOrder(orderJson({ note_attributes: [{ name: "session_token", value: "nope" }, { name: "book_theme", value: THEME }] }), deps().d);
  assert.match(missingSession.reasons[0], /Session not found/);
});

test("a second paid order for a session that already has a ready print order is refused", async () => {
  const r = await handlePaidOrder(orderJson(), deps({ otherReady: true }).d);
  assert.equal(r.status, "refused");
  assert.match(r.reasons[0], /already has a ready print order/);
});

test("a missing shipping address refuses through the XML rules", async () => {
  const r = await handlePaidOrder(orderJson({ shipping_address: null }), deps().d);
  assert.equal(r.status, "refused");
  assert.match(r.reasons[0], /shipment address1 is required/);
});

test("Shopify HMAC: valid passes; tampered body, wrong secret, missing header fail", () => {
  const body = JSON.stringify({ id: 1 });
  const sig = createHmac("sha256", "s3cret").update(body).digest("base64");
  assert.equal(verifyShopifyHmac(body, sig, "s3cret"), true);
  assert.equal(verifyShopifyHmac(body + " ", sig, "s3cret"), false);
  assert.equal(verifyShopifyHmac(body, sig, "other"), false);
  assert.equal(verifyShopifyHmac(body, null, "s3cret"), false);
  assert.equal(verifyShopifyHmac(body, sig, ""), false);
  assert.equal(verifyShopifyHmac(body, "not-base64!!", "s3cret"), false);
});

test("a square source larger than a square slot is scaled down, never up", async () => {
  const base = {
    bookTheme: THEME, extraRows: [], externalId: "DS1",
    shipTo: { fname: "T", lname: "C", address1: "1 St", city: "SLC", state: "UT", zip: "84116", country: "US" },
    customer: { fname: "T", lname: "C" },
  };
  const big = await buildOrder({
    ...base, photoRows: [{ slot_key: "baby_bump", storage_path: "p/1200x1200", print_size: "4x4", status: "cropped" }],
    fetchImage,
  });
  const meta = await sharp(big.images[0].data).metadata();
  assert.deepEqual([meta.width, meta.height], [900, 900]); // baby_bump slot is 3x3
  assert.ok(big.warnings.some((w) => /downscaled from 1200x1200px to 900x900px/.test(w)));
  assert.ok(big.warnings.some((w) => /stored as 4x4 but the book slot prints 3x3/.test(w)));

  const small = await buildOrder({
    ...base, photoRows: [{ slot_key: "baby_photo", storage_path: "p/1000x1000", print_size: "4x4", status: "cropped" }],
    fetchImage,
  });
  const m2 = await sharp(small.images[0].data).metadata();
  assert.deepEqual([m2.width, m2.height], [1000, 1000]); // under size: flagged, not upscaled
  assert.ok(small.warnings.some((w) => /under the 1200x1200px/.test(w)));
});
