import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { checkUploadSize } from "@/lib/image-validation";

async function jpeg(w: number, h: number, orientation?: number) {
  const noise = Buffer.alloc(w * h * 3);
  for (let i = 0; i < noise.length; i++) noise[i] = (i * 2654435761) >>> 24;
  let s = sharp(noise, { raw: { width: w, height: h, channels: 3 } });
  if (orientation) s = s.withMetadata({ orientation });
  return s.jpeg({ quality: 85 }).toBuffer();
}

test("an 835-byte stub (like the broken baby_photo) is rejected", async () => {
  const tiny = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#fff" } }).jpeg().toBuffer();
  // Pad to 835 bytes after the JPEG end marker, as the real stub's size.
  const stub = Buffer.concat([tiny, Buffer.alloc(835 - tiny.length)]);
  assert.equal(stub.length, 835);
  const r = await checkUploadSize(stub, "4x4");
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.message, /too small or damaged.*at least 600×600 pixels/);
});

test("exact-size crops pass, including rectangular and turned ones", async () => {
  assert.deepEqual(await checkUploadSize(await jpeg(1200, 1200), "4x4"), { ok: true });
  assert.deepEqual(await checkUploadSize(await jpeg(900, 900), "3x3"), { ok: true });
  assert.deepEqual(await checkUploadSize(await jpeg(1200, 900), "4x3"), { ok: true });
  assert.deepEqual(await checkUploadSize(await jpeg(1800, 1200), "6x4"), { ok: true });
  assert.deepEqual(await checkUploadSize(await jpeg(1800, 1200), "4x6"), { ok: true }); // sideways file still fits
});

test("under half the print size is rejected, just over half passes", async () => {
  assert.equal((await checkUploadSize(await jpeg(500, 500), "4x4")).ok, false);
  assert.equal((await checkUploadSize(await jpeg(1200, 500), "4x6")).ok, false);
  assert.equal((await checkUploadSize(await jpeg(620, 620), "4x4")).ok, true);
});

test("corrupt or truncated files are rejected as unreadable", async () => {
  const good = await jpeg(1200, 1200);
  const cut = await checkUploadSize(good.subarray(0, 4000), "4x4");
  assert.equal(cut.ok, false);
  const junk = await checkUploadSize(Buffer.alloc(20000, 7), "4x4");
  assert.equal(junk.ok, false);
  if (!junk.ok) assert.match(junk.message, /could not be read/);
});

test("an unknown label falls back to the slot's size", async () => {
  assert.equal((await checkUploadSize(await jpeg(500, 500), null, "4x4")).ok, false);
  assert.equal((await checkUploadSize(await jpeg(900, 900), "bogus", "3x3")).ok, true);
});
