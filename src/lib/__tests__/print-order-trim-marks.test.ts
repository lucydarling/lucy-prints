import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { getPrintDimensions, type PrintSize } from "@/lib/photo-slots";
import { PRINT_PRODUCTS, TRIM_MARK } from "@/lib/print-orders/config";
import { composeSheet, prepareImage, trimMarkRects, type MarkRect } from "@/lib/print-orders/image";

const S = 1200;
const { THICKNESS: T, GAP: G, EDGE_MARGIN: M, FLUSH_LENGTH: F } = TRIM_MARK;

/** Every sheet print the lab gets: the four sizes under 4x4, with 3x4 as 4x3 turned upright. */
const SHEET_PRINTS: Array<{ name: string; w: number; h: number; size: PrintSize }> = [
  { name: "3x3", w: 900, h: 900, size: "3x3" },
  { name: "3.5x3.5", w: 1050, h: 1050, size: "3.5x3.5" },
  { name: "4x3", w: 1200, h: 900, size: "4x3" },
  { name: "3x4", w: 900, h: 1200, size: "4x3" },
];

/** A distinctive photo: every pixel differs from its neighbours, none is white or mark-gray. */
function photo(w: number, h: number): Buffer {
  const b = Buffer.alloc(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    b[i * 3] = 20 + (i % 97);
    b[i * 3 + 1] = 10 + ((i * 7) % 89);
    b[i * 3 + 2] = 30 + ((i * 13) % 83);
  }
  return b;
}

const inPhoto = (x: number, y: number, w: number, h: number) => x < w && y >= S - h;
const inMark = (x: number, y: number, marks: MarkRect[]) =>
  marks.some((m) => x >= m.x && x < m.x + m.width && y >= m.y && y < m.y + m.height);

test("trim marks: design pinned for 3x3 (the approved 2026-11-12 layout)", () => {
  assert.deepEqual(trimMarkRects(900, 900, S, S), [
    { x: M, y: 300 - T, width: F, height: T, cut: "h", kind: "flush" },
    { x: 900 + G, y: 300 - T, width: S - M - (900 + G), height: T, cut: "h", kind: "extension" },
    { x: 900, y: M, width: T, height: 300 - G - M, cut: "v", kind: "extension" },
    { x: 900, y: S - M - F, width: T, height: F, cut: "v", kind: "flush" },
  ]);
  assert.deepEqual([T, G, M, F], [4, 19, 38, 75]);
});

for (const p of SHEET_PRINTS) {
  test(`trim marks (${p.name}): on the cut lines, both ends of every cut, off the photo, away from the sheet edge`, () => {
    const marks = trimMarkRects(p.w, p.h, S, S);
    const top = S - p.h;
    const cuts = [...(top > 0 ? ["h"] : []), ...(p.w < S ? ["v"] : [])];
    assert.equal(marks.length, cuts.length * 2, "two marks per cut line");
    for (const cut of cuts) assert.equal(marks.filter((m) => m.cut === cut).length, 2, `cut ${cut}`);
    for (const m of marks) {
      // Photo-side edge exactly on the cut line.
      if (m.cut === "h") {
        assert.equal(m.height, T);
        assert.equal(m.y + m.height, top, "horizontal mark's bottom edge is the photo's top edge");
      } else {
        assert.equal(m.width, T);
        assert.equal(m.x, p.w, "vertical mark's left edge is the photo's right edge");
      }
      // Nothing within the edge margin.
      assert.ok(m.x >= M && m.y >= M && m.x + m.width <= S - M && m.y + m.height <= S - M, `${JSON.stringify(m)} too close to the edge`);
      // Never on the photo (corners checked; marks are rectangles and the photo is a rectangle).
      for (const [x, y] of [[m.x, m.y], [m.x + m.width - 1, m.y], [m.x, m.y + m.height - 1], [m.x + m.width - 1, m.y + m.height - 1]]) {
        assert.ok(!inPhoto(x, y, p.w, p.h), `${JSON.stringify(m)} covers the photo at ${x},${y}`);
      }
      // An extension mark starts a gap past the photo's corner.
      if (m.kind === "extension") {
        if (m.cut === "h") assert.ok(m.x >= p.w + G);
        else assert.ok(m.y + m.height <= top - G);
      }
    }
  });

  test(`sheet pixels (${p.name}): photo copied unchanged, gray exactly where the marks are, white everywhere else`, async () => {
    const src = photo(p.w, p.h);
    const sheet = await composeSheet(src, p.w, p.h, S, S);
    assert.equal(sheet.length, S * S * 3);
    const marks = trimMarkRects(p.w, p.h, S, S);
    const { r, g, b } = TRIM_MARK.COLOR;
    const top = S - p.h;
    let photoDiffs = 0;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const o = (y * S + x) * 3;
        const got = [sheet[o], sheet[o + 1], sheet[o + 2]];
        if (inPhoto(x, y, p.w, p.h)) {
          const i = ((y - top) * p.w + x) * 3;
          if (got[0] !== src[i] || got[1] !== src[i + 1] || got[2] !== src[i + 2]) photoDiffs++;
        } else if (inMark(x, y, marks)) {
          assert.deepEqual(got, [r, g, b], `mark pixel ${x},${y}`);
        } else if (got[0] !== 255 || got[1] !== 255 || got[2] !== 255) {
          assert.fail(`padding pixel ${x},${y} is ${got}, expected white`);
        }
      }
    }
    assert.equal(photoDiffs, 0, "every photo pixel is untouched");
  });
}

test("prepareImage: each sheet size becomes a 1200px square JPEG that passes the 4x4 product's shape", async () => {
  for (const p of SHEET_PRINTS) {
    const product = PRINT_PRODUCTS.demo[p.size];
    assert.equal(product.printedAs, "sheet", p.name);
    const jpeg = await sharp(photo(p.w, p.h), { raw: { width: p.w, height: p.h, channels: 3 } }).jpeg({ quality: 90 }).toBuffer();
    const out = await prepareImage(jpeg, { width: p.w, height: p.h }, product, p.name);
    assert.deepEqual([out.width, out.height], [S, S], p.name);
    assert.equal(Math.max(out.width, out.height) / Math.min(out.width, out.height), product.aspect);
    const meta = await sharp(out.jpeg).metadata();
    assert.deepEqual([meta.width, meta.height, meta.density], [S, S, 300], p.name);
    assert.deepEqual(out.warnings, [], p.name);
  }
});

test("prepareImage: a sheet print that came in small is scaled to its true size (so it trims right); a wrong shape is refused", async () => {
  const product = PRINT_PRODUCTS.demo["3x3"];
  const small = await sharp(photo(800, 800), { raw: { width: 800, height: 800, channels: 3 } }).jpeg().toBuffer();
  const out = await prepareImage(small, getPrintDimensions("3x3"), product, "small");
  assert.deepEqual([out.width, out.height], [S, S]);
  assert.ok(out.warnings.some((w) => /scaled from 800x800px to 900x900px/.test(w)), out.warnings.join("; "));
  // Scaling up does not hide the resolution problem: the under-300-DPI warning is still in the report.
  assert.ok(out.warnings.some((w) => /800x800px is under the 900x900px needed at 300 DPI/.test(w)), out.warnings.join("; "));
  // The photo now ends exactly at the 3" cut line: column 899 is photo, the marks start at 900.
  const { data } = await sharp(out.jpeg).raw().toBuffer({ resolveWithObject: true });
  const px = (x: number, y: number) => [0, 1, 2].map((c) => data[(y * S + x) * 3 + c]);
  assert.ok(!px(880, 600).every((v) => v >= 250), "photo reaches the cut line");
  assert.ok(px(1000, 600).every((v) => v >= 250), "white right of the cut line");

  const wrong = await sharp(photo(900, 700), { raw: { width: 900, height: 700, channels: 3 } }).jpeg().toBuffer();
  await assert.rejects(prepareImage(wrong, getPrintDimensions("3x3"), product, "wrong"), /not the shape of a 900x900px print/);
});

test("trim marks refuse padding too thin to hold a mark", () => {
  assert.throws(() => trimMarkRects(1198, 1198, S, S), /padding too thin/);
  assert.deepEqual(trimMarkRects(S, S, S, S), [], "a full-sheet print has nothing to cut");
});
