import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import sharp from "sharp";
import type { PrintSnapshot } from "@/lib/print-orders/paid-order";
import { verifyShopifyHmac } from "@/lib/print-orders/webhook-hmac";
import { buildOrder } from "@/lib/print-orders/build-order";
import { buildFromSnapshot, requireReadySnapshot } from "@/lib/print-orders/build-from-snapshot";

const THEME = "little_artist"; // a memory book

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
const fetchImage = async (p: string) => {
  const [w, h] = p.replace("p/", "").split("x").map(Number);
  return img(w, h);
};

// The order-level behaviour (rounds, reprints, quantity checks, retries, emails) lives in print-order-rounds.test.ts.

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

test("manual build: only a ready order, only from its own frozen copies", () => {
  const snap: PrintSnapshot = {
    frozenAt: "x",
    photoRows: [{ slot_key: "a", storage_path: "print-orders/77/a", print_size: "4x4", status: "cropped" }],
    extraRows: [],
  };
  assert.throws(() => requireReadySnapshot("77", null), /no print order recorded/);
  assert.throws(() => requireReadySnapshot("77", { status: "held", snapshot: snap }), /is "held", not ready/);
  assert.throws(() => requireReadySnapshot("77", { status: "refused", snapshot: snap }), /is "refused", not ready/);
  assert.throws(() => requireReadySnapshot("77", { status: "ready", snapshot: null }), /no saved snapshot/);
  const live: PrintSnapshot = { ...snap, photoRows: [{ ...snap.photoRows[0], storage_path: "abc-session/a.jpg" }] };
  assert.throws(() => requireReadySnapshot("77", { status: "ready", snapshot: live }), /outside print-orders\/77\/.*refusing to read live files/);
  assert.equal(requireReadySnapshot("77", { status: "ready", snapshot: snap }), snap);
});

test("a snapshot from before order details were saved cannot be built", async () => {
  await assert.rejects(
    buildFromSnapshot("1", { frozenAt: "x", photoRows: [], extraRows: [] }, async () => Buffer.alloc(0)),
    /no order details/
  );
});

