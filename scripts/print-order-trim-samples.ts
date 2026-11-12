/**
 * Build one finished 4x4 trim-mark sheet per small print size (3x3, 3.5x3.5, 4x3, 3x4) from a
 * test photo, through the same prepareImage() a real order uses, so the files are exactly what
 * pfRouter receives (1200x1200px, 300 DPI, sRGB JPEG q95). For the lab to test the trim marks.
 *
 *   npm run print-order:trim-samples -- <photo.jpg> <out-dir>
 *
 * The photo is center-cropped to each print's shape first, the way the app's crop tool delivers it.
 * Writes only to <out-dir>. Touches no database, storage or Dropbox.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { getPrintDimensions, type PrintOrientation, type PrintSize } from "@/lib/photo-slots";
import { PRINT_PRODUCTS } from "@/lib/print-orders/config";
import { prepareImage } from "@/lib/print-orders/image";

const SAMPLES: Array<{ file: string; size: PrintSize; orientation?: PrintOrientation }> = [
  { file: "3x3_on_4x4.jpg", size: "3x3" },
  { file: "3.5x3.5_on_4x4.jpg", size: "3.5x3.5" },
  { file: "4x3_on_4x4.jpg", size: "4x3", orientation: "landscape" },
  { file: "3x4_on_4x4.jpg", size: "4x3", orientation: "portrait" },
];

async function main() {
  const [src, out] = process.argv.slice(2);
  if (!src || !out) throw new Error("usage: npm run print-order:trim-samples -- <photo.jpg> <out-dir>");
  const photo = await fs.readFile(src);
  await fs.mkdir(out, { recursive: true });
  for (const s of SAMPLES) {
    const dims = getPrintDimensions(s.size, s.orientation);
    const product = PRINT_PRODUCTS.demo[s.size];
    if (product.printedAs !== "sheet") throw new Error(`${s.size} is not printed on a sheet`);
    const cropped = await sharp(photo).rotate().resize(dims.width, dims.height, { fit: "cover", position: "centre" }).jpeg({ quality: 95 }).toBuffer();
    const prepared = await prepareImage(cropped, dims, product, s.file);
    if (prepared.warnings.length) throw new Error(prepared.warnings.join("; "));
    await fs.writeFile(path.join(out, s.file), prepared.jpeg);
    console.log(`${s.file}: ${prepared.width}x${prepared.height}px, photo ${dims.width}x${dims.height}px, ordered as product ${product.productCode} (4x4)`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
