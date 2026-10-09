import sharp, { type OutputInfo } from "sharp";
import { HARD_MIN_FRACTION, MIN_VALID_IMAGE_BYTES, type PrintProductConfig } from "./config";

export interface PreparedImage {
  jpeg: Buffer;
  /** Pixel size of the output file. */
  width: number;
  height: number;
  /** Pixel size of the source after EXIF rotation. */
  sourceWidth: number;
  sourceHeight: number;
  /** Non-fatal findings, e.g. fewer pixels than 300 DPI needs. */
  warnings: string[];
}

export class ImageProblem extends Error {}

/**
 * Validate one stored cropped image and turn it into the print file:
 * EXIF-rotated, sRGB, JPEG q95, 300 DPI, and (when the product is printed on
 * a sheet) placed bottom-left on a white sheet with padding top/right and no
 * trim guides. Never resizes: a short image is flagged, not stretched.
 *
 * Throws ImageProblem if the file is broken or far too small to print.
 */
export async function prepareImage(
  source: Buffer,
  expected: { width: number; height: number },
  product: PrintProductConfig,
  label: string
): Promise<PreparedImage> {
  if (source.length < MIN_VALID_IMAGE_BYTES) {
    throw new ImageProblem(`${label}: file is only ${source.length} bytes — broken or placeholder image`);
  }
  let rotated: Buffer;
  let info: OutputInfo;
  try {
    // Fully decodes, so a truncated/corrupt file fails here.
    const out = await sharp(source).rotate().toColourspace("srgb").raw().toBuffer({ resolveWithObject: true });
    rotated = out.data;
    info = out.info;
  } catch (err) {
    throw new ImageProblem(`${label}: cannot be decoded (${(err as Error).message})`);
  }
  const warnings: string[] = [];
  let { width: w, height: h } = info;
  if (w < expected.width * HARD_MIN_FRACTION || h < expected.height * HARD_MIN_FRACTION) {
    throw new ImageProblem(
      `${label}: ${w}x${h}px is under ${HARD_MIN_FRACTION * 100}% of the ${expected.width}x${expected.height}px needed at 300 DPI`
    );
  }
  if (w < expected.width || h < expected.height) {
    warnings.push(`${label}: ${w}x${h}px is under the ${expected.width}x${expected.height}px needed at 300 DPI`);
  } else if (w !== expected.width || h !== expected.height) {
    warnings.push(`${label}: ${w}x${h}px is not the expected ${expected.width}x${expected.height}px`);
  }
  let raw = { raw: { width: w, height: h, channels: info.channels as 1 | 2 | 3 | 4 } };

  // A square source that is larger than a square slot (legacy rows saved when
  // the slot was bigger) is scaled DOWN to the exact print size. Never up.
  if (expected.width === expected.height && w === h && w > expected.width) {
    const small = await sharp(rotated, raw)
      .resize(expected.width, expected.height, { kernel: "lanczos3", fit: "fill" })
      .raw()
      .toBuffer({ resolveWithObject: true });
    rotated = small.data;
    raw = { raw: { width: small.info.width, height: small.info.height, channels: small.info.channels as 1 | 2 | 3 | 4 } };
    warnings.push(`${label}: downscaled from ${w}x${h}px to ${expected.width}x${expected.height}px`);
    w = small.info.width;
    h = small.info.height;
  }

  let pipeline = sharp(rotated, raw).removeAlpha();
  let outW = w;
  let outH = h;
  if (product.printedAs === "sheet") {
    const sw = product.sheetWidth!;
    const sh = product.sheetHeight!;
    if (w > sw || h > sh) {
      throw new ImageProblem(`${label}: ${w}x${h}px does not fit on the ${sw}x${sh}px sheet`);
    }
    // Bottom-left: padding on top and to the right, as the customer ZIP does.
    const flat = await pipeline.toBuffer();
    pipeline = sharp({ create: { width: sw, height: sh, channels: 3, background: "#FFFFFF" } }).composite([
      { input: flat, raw: { width: w, height: h, channels: 3 }, left: 0, top: sh - h },
    ]);
    outW = sw;
    outH = sh;
  }
  const jpeg = await pipeline
    .toColourspace("srgb")
    .jpeg({ quality: 95, chromaSubsampling: "4:4:4" })
    .withMetadata({ density: 300 })
    .toBuffer();
  return { jpeg, width: outW, height: outH, sourceWidth: info.width, sourceHeight: info.height, warnings };
}
