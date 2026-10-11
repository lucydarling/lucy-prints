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

// ---------- fail open when sharp itself is broken ----------
import { setSharpLoaderForTests } from "@/lib/image-validation";
import { reportUploadCheckSkipped } from "@/lib/upload-check-alert";
import { claimOnce } from "@/lib/rate-limit";
import { UPLOAD_FAILED_MESSAGE, uploadErrorMessage, uploadPhoto } from "@/hooks/useAutoUpload";

async function stub835() {
  const tiny = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#fff" } }).jpeg().toBuffer();
  return Buffer.concat([tiny, Buffer.alloc(835 - tiny.length)]);
}

test("sharp failing to LOAD: the upload is accepted (fail open) with the reason, never rejected", async () => {
  setSharpLoaderForTests(async () => {
    throw new Error('Could not load the "sharp" module using the linux-x64 runtime: ERR_DLOPEN_FAILED libvips-cpp.so.8.18.7');
  });
  try {
    const r = await checkUploadSize(await stub835(), "4x4");
    assert.equal(r.ok, true);
    assert.match((r as { skipped?: string }).skipped ?? "", /sharp failed to load: .*ERR_DLOPEN_FAILED/);
  } finally {
    setSharpLoaderForTests(null);
  }
  // Restored: the same stub is rejected again.
  assert.equal((await checkUploadSize(await stub835(), "4x4")).ok, false);
});

test("sharp loads but can't decode anything (even a known-good image): fail open; a bad photo with a working sharp is still rejected", async () => {
  const broken = (() => ({ raw: () => ({ toBuffer: async () => { throw new Error("vips_init failed"); } }) })) as unknown as typeof sharp;
  setSharpLoaderForTests(async () => broken);
  try {
    const r = await checkUploadSize(await stub835(), "4x4");
    assert.equal(r.ok, true);
    assert.match((r as { skipped?: string }).skipped ?? "", /known-good image: vips_init failed/);
  } finally {
    setSharpLoaderForTests(null);
  }
  const corrupt = (await jpeg(1200, 1200)).subarray(0, 2000);
  const r = await checkUploadSize(corrupt, "4x4");
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.message, /could not be read/);
});

test("skipped check: logged every time, Kevin alerted at most once per hour, alert failure never throws", async () => {
  const claimed = new Set<string>();
  const sent: unknown[] = [];
  const deps = {
    claim: async (k: string) => (claimed.has(k) ? false : (claimed.add(k), true)),
    send: (async (i: unknown) => { sent.push(i); }) as never,
  };
  const ctx = { sessionId: "s1", slotKey: "baby_photo" };
  assert.equal(await reportUploadCheckSkipped("sharp failed to load: x", ctx, deps), "alerted");
  assert.equal(await reportUploadCheckSkipped("sharp failed to load: x", ctx, deps), "throttled");
  assert.equal(await reportUploadCheckSkipped("sharp failed to load: x", ctx, deps), "throttled");
  assert.equal(sent.length, 1);
  assert.equal((sent[0] as { status: string }).status, "upload-check");

  const failing = { claim: async () => true, send: (async () => { throw new Error("resend down"); }) as never };
  assert.equal(await reportUploadCheckSkipped("x", ctx, failing), "alert-failed");
});

test("claimOnce without Redis: first claim wins, repeats within the hour are refused", async () => {
  const key = `test:claim:${Date.now()}`;
  assert.equal(await claimOnce(key, 3600), true);
  assert.equal(await claimOnce(key, 3600), false);
});

// ---------- client: no retries on a 4xx, the server's message is shown ----------
test("upload client: a 4xx is not retried and keeps the server's message; a 5xx still retries", async () => {
  const realFetch = globalThis.fetch;
  let uploads = 0;
  let status = 400;
  globalThis.fetch = (async (url: string) => {
    if (String(url).startsWith("data:")) return new Response(new Blob([new Uint8Array([0xff, 0xd8, 0xff])]));
    uploads += 1;
    return new Response(JSON.stringify({ error: "This photo is too small or damaged to print." }), { status });
  }) as typeof fetch;
  const args = { sessionToken: "t", slotKey: "baby_photo", croppedUrl: "data:image/jpeg;base64,/9j/", isExtra: false };
  try {
    const t0 = Date.now();
    const err = await uploadPhoto(args).catch((e) => e);
    assert.equal(uploads, 1, "a 400 is sent once");
    assert.ok(Date.now() - t0 < 500, "no backoff wait");
    assert.equal(uploadErrorMessage(err), "This photo is too small or damaged to print.");

    uploads = 0;
    status = 409;
    await uploadPhoto(args).catch(() => undefined);
    assert.equal(uploads, 1);

    uploads = 0;
    status = 502;
    const err5 = await uploadPhoto(args).catch((e) => e);
    assert.equal(uploads, 3, "a 5xx is retried");
    assert.equal(uploadErrorMessage(err5), UPLOAD_FAILED_MESSAGE);
    assert.equal(uploadErrorMessage(new TypeError("Failed to fetch")), UPLOAD_FAILED_MESSAGE);
  } finally {
    globalThis.fetch = realFetch;
  }
});
