import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import sharp from "sharp";
import { getRegions, choiceFromPrintLabel, getPrintSizeLabel, regionChoicesFromStoredPhotos } from "@/lib/photo-slots";
import { bookPrintItems, summarizePrints } from "@/lib/print-summary";
import { getBookSlots } from "@/lib/photo-slots";
import { buildOrder, type BuildOrderParams, type SessionExtraRow, type SessionPhotoRow } from "@/lib/print-orders/build-order";
import { LocalFolderDestination, orderToZip, writeOrderFolder } from "@/lib/print-orders/destination";
import type { ExtraPrint, PhotoEntry } from "@/store/photo-store";

// Noise keeps the JPEG above the "broken file" size floor, like a real photo.
async function img(w: number, h: number, opts: { exif?: number } = {}): Promise<Buffer> {
  const noise = Buffer.alloc(w * h * 3);
  for (let i = 0; i < noise.length; i++) noise[i] = (i * 2654435761) >>> 24;
  let s = sharp(noise, { raw: { width: w, height: h, channels: 3 } });
  if (opts.exif) s = s.withMetadata({ orientation: opts.exif });
  return s.jpeg({ quality: 80 }).toBuffer();
}

const THEME = "little_artist";
const SHIP = { fname: "T", lname: "C", address1: "1 St", city: "SLC", state: "UT", zip: "84116", country: "US" };

async function fixture(extra: Partial<BuildOrderParams> = {}, store: Record<string, Buffer> = {}) {
  const files: Record<string, Buffer> = {
    "s/ultrasound.jpg": await img(1200, 900),
    "s/baby_bump.jpg": await img(900, 900), // little_artist baby_bump is a 3x3
    "s/baby_photo.jpg": await img(1200, 1200),
    "s/e1.jpg": await img(1200, 1800),
    "s/e2.jpg": await img(1800, 1200),
    ...store,
  };
  const photoRows: SessionPhotoRow[] = ["ultrasound:4x3", "baby_bump:3x3", "baby_photo:4x4"].map((x) => {
    const [k, size] = x.split(":");
    return { slot_key: k, storage_path: `s/${k}.jpg`, print_size: size, status: "cropped" };
  });
  const extraRows: SessionExtraRow[] = [
    { extra_id: "extra_1_a", print_size: "4x6", orientation: "portrait", storage_path: "s/e1.jpg", quantity: 2 },
    { extra_id: "extra_2_b", print_size: "6x4", orientation: "landscape", storage_path: "s/e2.jpg", quantity: 1 },
    { extra_id: "extra_3_c", print_size: "4x6", orientation: "portrait", storage_path: null, quantity: 5 },
  ];
  const params: BuildOrderParams = {
    bookTheme: THEME, photoRows, extraRows, externalId: "UNITTEST1", shipTo: SHIP,
    customer: { fname: "T", lname: "C" },
    fetchImage: async (p) => { if (!files[p]) throw new Error("not found"); return files[p]; },
    ...extra,
  };
  return { params, files };
}

test("order contents: count matches the review summary, extras honor quantity, sizes are right", async () => {
  const { params } = await fixture();
  const order = await buildOrder(params);

  // Review-page count for the same data (each extra counted by its quantity).
  const slots = getBookSlots(THEME, {});
  const photos: Record<string, PhotoEntry> = Object.fromEntries(
    params.photoRows.map((r) => [r.slot_key, { slotKey: r.slot_key, previewUrl: null, croppedUrl: "x", status: "cropped" as const }])
  );
  const extras: ExtraPrint[] = [];
  for (const e of params.extraRows.filter((e) => e.storage_path)) {
    for (let i = 0; i < e.quantity; i++) {
      extras.push({ id: e.extra_id + i, size: e.print_size === "6x4" ? "4x6" : (e.print_size as "4x6"), orientation: e.orientation as "portrait", previewUrl: null, croppedUrl: "x", quantity: 1 });
    }
  }
  const summary = summarizePrints(bookPrintItems(slots, photos, extras));
  assert.equal(order.printCount, summary.total);
  assert.equal(order.printCount, 3 + 2 + 1);
  assert.equal(order.countBySize["4x6"], 3);
  assert.equal(order.images.length, 5); // one file per image; quantity lives on the order_item
  assert.deepEqual(order.input.items.map((i) => i.quantity), [1, 1, 1, 2, 1]);

  // Every XML image path exists; padded sizes are 1200x1200; others untouched.
  const xml = order.xml.data.toString();
  for (const m of xml.matchAll(/image path="([^"]+)"/g)) {
    assert.ok(order.images.some((f) => f.name === m[1]), `missing ${m[1]}`);
  }
  for (const f of order.images) {
    const meta = await sharp(f.data).metadata();
    assert.equal(meta.format, "jpeg");
    assert.equal(meta.density, 300);
    assert.equal(meta.space, "srgb");
    if (f.name.includes("ultrasound")) assert.deepEqual([meta.width, meta.height], [1200, 1200]);
    if (f.name.includes("_4x6")) assert.deepEqual([meta.width, meta.height], [1200, 1800]);
    if (f.name.includes("_6x4")) assert.deepEqual([meta.width, meta.height], [1800, 1200]);
  }
  assert.match(order.folderName, /^TEST-UNITTEST1$/);
  assert.deepEqual(order.warnings, []);
});

test("a stored print_size that disagrees with the book slot is flagged", async () => {
  const { params } = await fixture();
  params.photoRows.find((r) => r.slot_key === "baby_bump")!.print_size = "4x4";
  const order = await buildOrder(params);
  assert.equal(order.warnings.length, 1);
  assert.match(order.warnings[0], /baby_bump: stored as 4x4 but the book slot prints 3x3/);
});

test("a 4x3 print sits bottom-left on a white 4x4 sheet with no trim guides", async () => {
  const { params } = await fixture();
  const order = await buildOrder(params);
  const f = order.images.find((x) => x.name.includes("ultrasound"))!;
  const { data, info } = await sharp(f.data).raw().toBuffer({ resolveWithObject: true });
  const px = (x: number, y: number) => [0, 1, 2].map((c) => data[(y * info.width + x) * info.channels + c]);
  // Padding is top 300px and right 0 (4x3 is 1200 wide): top strip is pure white.
  for (const [x, y] of [[5, 5], [600, 150], [1195, 295]]) {
    assert.ok(px(x, y).every((v) => v >= 253), `expected white at ${x},${y}: ${px(x, y)}`);
  }
  assert.ok(!px(600, 450).every((v) => v >= 253), "photo area should not be white");
});

test("EXIF orientation is applied before sizing", async () => {
  const sideways = await img(1800, 1200, { exif: 6 }); // displays 1200x1800 once rotated
  const { params } = await fixture({}, { "s/e1.jpg": sideways });
  const order = await buildOrder(params);
  const f = order.images.find((x) => x.name.includes("extra_1"))!;
  const meta = await sharp(f.data).metadata();
  assert.deepEqual([meta.width, meta.height], [1200, 1800]);
});

test("under-300-DPI images are flagged but still built; far-too-small ones refuse", async () => {
  const { params } = await fixture({}, { "s/baby_photo.jpg": await img(1000, 1000) });
  const order = await buildOrder(params);
  assert.equal(order.warnings.length, 1);
  assert.match(order.warnings[0], /baby_photo.*1000x1000px is under the 1200x1200px/);

  const tiny = await fixture({}, { "s/baby_photo.jpg": await img(400, 400) });
  await assert.rejects(buildOrder(tiny.params), /under 50% of the 1200x1200px/);
});

test("a broken or placeholder image refuses the whole order", async () => {
  const stub = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#fff" } }).jpeg().toBuffer();
  assert.ok(stub.length < 5000);
  const a = await fixture({}, { "s/baby_photo.jpg": stub });
  await assert.rejects(buildOrder(a.params), /baby_photo.*broken or placeholder/);

  const b = await fixture({}, { "s/baby_photo.jpg": Buffer.alloc(20000, 7) });
  await assert.rejects(buildOrder(b.params), /baby_photo.*cannot be decoded/);

  const c = await fixture({ fetchImage: async () => { throw new Error("404"); } });
  await assert.rejects(buildOrder(c.params), /could not load image \(404\)/);
});

test("uncropped photos, bad quantities and charge mismatches refuse", async () => {
  const a = await fixture();
  a.params.photoRows[0].status = "uploaded";
  await assert.rejects(buildOrder(a.params), /not cropped/);

  const b = await fixture();
  b.params.extraRows[0].quantity = 0;
  await assert.rejects(buildOrder(b.params), /quantity must be a whole number/);

  const c = await fixture({ expectedPrintCount: 7 });
  await assert.rejects(buildOrder(c.params), /order has 6 prints but 7 were charged for/);
  const d = await fixture({ expectedPrintCount: 6 });
  assert.equal((await buildOrder(d.params)).printCount, 6);

  const e = await fixture({ photoRows: [], extraRows: [] });
  await assert.rejects(buildOrder(e.params), /no printable photos/);
});

test("test mode prefixes external_id; an id too long after the prefix refuses", async () => {
  const a = await fixture({ externalId: "x".repeat(28) });
  await assert.rejects(buildOrder(a.params), /external_id must be 1-32/);
  const b = await fixture({ testMode: false, externalId: "REAL1" });
  assert.equal((await buildOrder(b.params)).folderName, "REAL1");
});

test("local destination writes images first and the XML last; ZIP holds the same files", async () => {
  const { params } = await fixture();
  const order = await buildOrder(params);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "po-"));
  try {
    const { location } = await writeOrderFolder(order, new LocalFolderDestination(root));
    const names = (await fs.readdir(location)).sort();
    assert.deepEqual(names, [...order.images.map((i) => i.name), order.xml.name].sort());
    assert.ok(!names.some((n) => n.startsWith(".") || n.includes("pfrouter")));
    const zip = await JSZip.loadAsync(await orderToZip(order));
    assert.equal(Object.keys(zip.files).filter((n) => !n.endsWith("/")).length, order.images.length + 1);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("regionChoicesFromStoredPhotos matches the per-region choiceFromPrintLabel", () => {
  const theme = "love_grows_desert_sand";
  const region = getRegions(theme)[0];
  const layout = region.layouts[region.layouts.length - 1];
  const label = getPrintSizeLabel(layout.size, layout.orientations[0]);
  const stored = { [`${region.key}_1`]: { printSize: label } };
  assert.deepEqual(regionChoicesFromStoredPhotos(theme, stored)[region.key], choiceFromPrintLabel(region, label));
  assert.deepEqual(regionChoicesFromStoredPhotos(theme, { [`${region.key}_1`]: { printSize: "bogus" } }), {});
});
