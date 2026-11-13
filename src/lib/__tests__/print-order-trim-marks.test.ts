import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { getPrintDimensions, type PrintSize } from "@/lib/photo-slots";
import { PRINT_PRODUCTS, TRIM_MARK } from "@/lib/print-orders/config";
import { composeSheet, photoOrigin, prepareImage, trimMarkRects, type MarkRect } from "@/lib/print-orders/image";

const S = 1200;
const { THICKNESS: T, GAP: G, EDGE_MARGIN: E, TICK_LENGTH: L } = TRIM_MARK;

type Box = [x: number, y: number, w: number, h: number];
const box = (m: MarkRect): Box => [m.x, m.y, m.width, m.height];
const sortBoxes = (b: Box[]) => [...b].sort((p, q) => p[1] - q[1] || p[0] - q[0]);

/**
 * Step 8 (layout A, Kevin + Haily 2026-11-12): every sheet print, with the photo's position and
 * the exact crop marks from the brief. 3x4 is the 4x3 slot turned upright.
 */
const SHEET_PRINTS: Array<{ name: string; w: number; h: number; size: PrintSize; at: [number, number]; marks: Box[] }> = [
  {
    name: "3x3", w: 900, h: 900, size: "3x3", at: [150, 150],
    marks: [
      // corner marks: 19px past the photo's corner to 19px before the sheet edge, in the 4px outside each cut edge
      [19, 146, 112, 4], [1069, 146, 112, 4], // top edge
      [19, 1050, 112, 4], [1069, 1050, 112, 4], // bottom edge
      [146, 19, 4, 112], [146, 1069, 4, 112], // left edge
      [1050, 19, 4, 112], [1050, 1069, 4, 112], // right edge
    ],
  },
  {
    name: "3.5x3.5", w: 1050, h: 1050, size: "3.5x3.5", at: [75, 75],
    marks: [
      [19, 71, 37, 4], [1144, 71, 37, 4],
      [19, 1125, 37, 4], [1144, 1125, 37, 4],
      [71, 19, 4, 37], [71, 1144, 4, 37],
      [1125, 19, 4, 37], [1125, 1144, 4, 37],
    ],
  },
  {
    name: "3x4", w: 900, h: 1200, size: "4x3", at: [150, 0],
    // full height: a 112px tick at each end of the left and right edges, 19px in from the sheet edge
    marks: [[146, 19, 4, 112], [146, 1069, 4, 112], [1050, 19, 4, 112], [1050, 1069, 4, 112]],
  },
  {
    name: "4x3", w: 1200, h: 900, size: "4x3", at: [0, 150],
    marks: [[19, 146, 112, 4], [1069, 146, 112, 4], [19, 1050, 112, 4], [1069, 1050, 112, 4]],
  },
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

const inRect = (x: number, y: number, r: Box) => x >= r[0] && x < r[0] + r[2] && y >= r[1] && y < r[1] + r[3];

test("crop-mark constants are the approved ones (4px #808080, 1/16\" gap, 1/16\" edge, 112px ticks)", () => {
  assert.deepEqual([T, G, E, L], [4, 19, 19, 112]);
  assert.deepEqual(TRIM_MARK.COLOR, { r: 128, g: 128, b: 128 });
});

for (const p of SHEET_PRINTS) {
  test(`crop marks (${p.name}): photo centered at ${p.at}, marks at the exact approved coordinates`, () => {
    assert.deepEqual(photoOrigin(p.w, p.h, S, S), { x: p.at[0], y: p.at[1] });
    const marks = trimMarkRects(p.w, p.h, S, S);
    assert.deepEqual(sortBoxes(marks.map(box)), sortBoxes(p.marks));
    const photoBox: Box = [p.at[0], p.at[1], p.w, p.h];
    for (const m of marks) {
      // Never on the photo, and never touching it except along the cut edge it marks.
      for (const [x, y] of [[m.x, m.y], [m.x + m.width - 1, m.y], [m.x, m.y + m.height - 1], [m.x + m.width - 1, m.y + m.height - 1]]) {
        assert.ok(!inRect(x, y, photoBox), `${JSON.stringify(m)} covers the photo at ${x},${y}`);
      }
      // Never touching the sheet edge: at least 19px of white to every edge.
      assert.ok(m.x >= E && m.y >= E && m.x + m.width <= S - E && m.y + m.height <= S - E, `${JSON.stringify(m)} too close to the sheet edge`);
      // In the 4px just outside its cut edge.
      if (m.edge === "top") assert.equal(m.y + m.height, p.at[1]);
      if (m.edge === "bottom") assert.equal(m.y, p.at[1] + p.h);
      if (m.edge === "left") assert.equal(m.x + m.width, p.at[0]);
      if (m.edge === "right") assert.equal(m.x, p.at[0] + p.w);
    }
    assert.equal(marks.filter((m) => m.kind === "tick").length, p.w === S || p.h === S ? 4 : 0);
  });

  test(`sheet pixels (${p.name}): photo copied unchanged, gray exactly at the marks, pure white everywhere else`, async () => {
    const src = photo(p.w, p.h);
    const sheet = await composeSheet(src, p.w, p.h, S, S);
    assert.equal(sheet.length, S * S * 3);
    const { r, g, b } = TRIM_MARK.COLOR;
    const photoBox: Box = [p.at[0], p.at[1], p.w, p.h];
    let photoDiffs = 0;
    let markPixels = 0;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const o = (y * S + x) * 3;
        const got = [sheet[o], sheet[o + 1], sheet[o + 2]];
        if (inRect(x, y, photoBox)) {
          const i = ((y - p.at[1]) * p.w + (x - p.at[0])) * 3;
          if (got[0] !== src[i] || got[1] !== src[i + 1] || got[2] !== src[i + 2]) photoDiffs++;
        } else if (p.marks.some((m) => inRect(x, y, m))) {
          assert.deepEqual(got, [r, g, b], `mark pixel ${x},${y}`);
          markPixels++;
          assert.ok(x >= E && y >= E && x < S - E && y < S - E, `mark pixel ${x},${y} near the sheet edge`);
        } else if (got[0] !== 255 || got[1] !== 255 || got[2] !== 255) {
          assert.fail(`pixel ${x},${y} is ${got}, expected white`);
        }
      }
    }
    assert.equal(photoDiffs, 0, "every photo pixel is untouched");
    assert.equal(markPixels, p.marks.reduce((n, m) => n + m[2] * m[3], 0));
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

test("prepareImage: a sheet print that came in small is scaled to its true size (so it trims right) and keeps its DPI warning; a wrong shape is refused", async () => {
  const product = PRINT_PRODUCTS.demo["3x3"];
  const small = await sharp(photo(800, 800), { raw: { width: 800, height: 800, channels: 3 } }).jpeg().toBuffer();
  const out = await prepareImage(small, getPrintDimensions("3x3"), product, "small");
  assert.deepEqual([out.width, out.height], [S, S]);
  assert.ok(out.warnings.some((w) => /scaled from 800x800px to 900x900px/.test(w)), out.warnings.join("; "));
  // Scaling up does not hide the resolution problem: the under-300-DPI warning is still in the report.
  assert.ok(out.warnings.some((w) => /800x800px is under the 900x900px needed at 300 DPI/.test(w)), out.warnings.join("; "));
  // The photo now fills exactly 150..1049 on both axes: the 3" cut lines.
  const { data } = await sharp(out.jpeg).raw().toBuffer({ resolveWithObject: true });
  const px = (x: number, y: number) => [0, 1, 2].map((c) => data[(y * S + x) * 3 + c]);
  for (const [x, y] of [[160, 600], [1040, 600], [600, 160], [600, 1040]]) assert.ok(!px(x, y).every((v) => v >= 250), `photo at ${x},${y}`);
  for (const [x, y] of [[100, 600], [1100, 600], [600, 100], [600, 1100]]) assert.ok(px(x, y).every((v) => v >= 250), `white at ${x},${y}`);

  const wrong = await sharp(photo(900, 700), { raw: { width: 900, height: 700, channels: 3 } }).jpeg().toBuffer();
  await assert.rejects(prepareImage(wrong, getPrintDimensions("3x3"), product, "wrong"), /not the shape of a 900x900px print/);
});

test("crop marks refuse a photo that can't be centered on whole pixels or leaves too thin a margin", () => {
  assert.throws(() => trimMarkRects(901, 901, S, S), /cannot be centered/);
  assert.throws(() => trimMarkRects(1196, 1196, S, S), /margin too thin/);
  assert.throws(() => trimMarkRects(1150, 1150, S, S), /no room for a crop mark/);
  assert.deepEqual(trimMarkRects(S, S, S, S), [], "a full-sheet print has nothing to cut");
});
