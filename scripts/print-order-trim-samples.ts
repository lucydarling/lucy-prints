/**
 * Build one finished 4x4 crop-mark sheet per small print size (3x3, 3.5x3.5, 4x3, 3x4) from test
 * photos, through the same prepareImage() a real order uses, so the files are exactly what
 * pfRouter receives (1200x1200px, 300 DPI, sRGB JPEG q95, photo centered, corner crop marks).
 * For the lab to test the crop marks.
 *
 *   npm run print-order:trim-samples -- <photo.jpg> <out-dir> [--portrait <photo.jpg>]
 *
 * <photo> is used for 3x3, 3.5x3.5 and 4x3; --portrait (default <photo>) for 3x4. Each photo is
 * center-cropped to the print's shape and saved as a q95 JPEG first, the way the app's crop tool
 * delivers it. Also writes a 3x3 white-edge test: the same crop faded to pure white on all four
 * edges (the hard case: only the marks show where to cut).
 * Writes only to <out-dir>. Touches no database, storage or Dropbox.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { getPrintDimensions, type PrintOrientation, type PrintSize } from "@/lib/photo-slots";
import { PRINT_PRODUCTS } from "@/lib/print-orders/config";
import { prepareImage } from "@/lib/print-orders/image";

const SAMPLES: Array<{ file: string; size: PrintSize; orientation?: PrintOrientation; portrait?: boolean; whiteEdges?: boolean }> = [
  { file: "3x3_cropmarks_on_4x4.jpg", size: "3x3" },
  { file: "3x3_cropmarks_on_4x4_white-edge-test.jpg", size: "3x3", whiteEdges: true },
  { file: "3.5x3.5_cropmarks_on_4x4.jpg", size: "3.5x3.5" },
  { file: "4x3_cropmarks_on_4x4.jpg", size: "4x3", orientation: "landscape" },
  { file: "3x4_cropmarks_on_4x4.jpg", size: "4x3", orientation: "portrait", portrait: true },
];

/** White overlay fading in from all four edges: pure white for the outer 15% of the band, clear at 22% of the short side. */
function whiteEdgeSvg(w: number, h: number): Buffer {
  const f = Math.round(Math.min(w, h) * 0.22);
  const stops = '<stop offset="0" stop-color="#fff"/><stop offset="0.15" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>';
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs>
    <linearGradient id="t" x1="0" y1="0" x2="0" y2="1">${stops}</linearGradient>
    <linearGradient id="b" x1="0" y1="1" x2="0" y2="0">${stops}</linearGradient>
    <linearGradient id="l" x1="0" y1="0" x2="1" y2="0">${stops}</linearGradient>
    <linearGradient id="r" x1="1" y1="0" x2="0" y2="0">${stops}</linearGradient></defs>
    <rect width="${w}" height="${f}" fill="url(#t)"/><rect y="${h - f}" width="${w}" height="${f}" fill="url(#b)"/>
    <rect width="${f}" height="${h}" fill="url(#l)"/><rect x="${w - f}" width="${f}" height="${h}" fill="url(#r)"/></svg>`);
}

async function main() {
  const args = process.argv.slice(2);
  const pi = args.indexOf("--portrait");
  const portraitSrc = pi >= 0 ? args.splice(pi, 2)[1] : undefined;
  const [src, out] = args;
  if (!src || !out) throw new Error("usage: npm run print-order:trim-samples -- <photo.jpg> <out-dir> [--portrait <photo.jpg>]");
  const photos = { main: await fs.readFile(src), portrait: await fs.readFile(portraitSrc ?? src) };
  await fs.mkdir(out, { recursive: true });
  for (const s of SAMPLES) {
    const dims = getPrintDimensions(s.size, s.orientation);
    const product = PRINT_PRODUCTS.demo[s.size];
    if (product.printedAs !== "sheet") throw new Error(`${s.size} is not printed on a sheet`);
    let crop = sharp(s.portrait ? photos.portrait : photos.main).rotate().resize(dims.width, dims.height, { fit: "cover", position: "centre" });
    if (s.whiteEdges) crop = sharp(await crop.jpeg({ quality: 95 }).toBuffer()).composite([{ input: whiteEdgeSvg(dims.width, dims.height) }]);
    const cropped = await crop.jpeg({ quality: 95 }).toBuffer();
    const prepared = await prepareImage(cropped, dims, product, s.file);
    if (prepared.warnings.length) throw new Error(prepared.warnings.join("; "));
    await fs.writeFile(path.join(out, s.file), prepared.jpeg);
    console.log(`${s.file}: ${prepared.width}x${prepared.height}px, photo ${dims.width}x${dims.height}px centered, ordered as product ${product.productCode} (4x4)`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
