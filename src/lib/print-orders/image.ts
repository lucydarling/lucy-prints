import sharp, { type OutputInfo } from "sharp";
import { ASPECT_TOLERANCE, HARD_MIN_FRACTION, MIN_VALID_IMAGE_BYTES, TRIM_MARK, type PrintProductConfig } from "./config";

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
 * a sheet) placed bottom-left on a white sheet with padding top/right and gray
 * trim marks in the padding (see trimMarkRects).
 * A native print is never resized (the lab scales the file to its paper; a short
 * image is flagged, not stretched). A sheet print IS scaled to exactly its print
 * size, because the customer cuts it out at that size: a 3x3 that came in at
 * 800px would otherwise come out 2.67" wide.
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
    if (expected.width > sw || expected.height > sh) {
      throw new ImageProblem(`${label}: a ${expected.width}x${expected.height}px print does not fit on the ${sw}x${sh}px sheet`);
    }
    if (w !== expected.width || h !== expected.height) {
      const shape = (a: number, b: number) => a / b;
      if (Math.abs(shape(w, h) / shape(expected.width, expected.height) - 1) > ASPECT_TOLERANCE) {
        throw new ImageProblem(
          `${label}: ${w}x${h}px is not the shape of a ${expected.width}x${expected.height}px print — it would be trimmed to the wrong size`
        );
      }
      const fitted = await sharp(rotated, raw)
        .resize(expected.width, expected.height, { kernel: "lanczos3", fit: "fill" })
        .raw()
        .toBuffer({ resolveWithObject: true });
      rotated = fitted.data;
      raw = { raw: { width: fitted.info.width, height: fitted.info.height, channels: fitted.info.channels as 1 | 2 | 3 | 4 } };
      warnings.push(`${label}: scaled from ${w}x${h}px to ${expected.width}x${expected.height}px so it trims to its true size`);
      w = expected.width;
      h = expected.height;
    }
    const flat = await sharp(rotated, raw).removeAlpha().raw().toBuffer();
    pipeline = sharp(await composeSheet(flat, w, h, sw, sh), { raw: { width: sw, height: sh, channels: 3 } });
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

/**
 * The sheet as raw RGB: white, the `w`×`h` RGB photo bottom-left (padding on top and to the right,
 * as the customer ZIP does), then the trim marks. The photo's pixels are copied unchanged.
 */
export async function composeSheet(photoRgb: Buffer, w: number, h: number, sw: number, sh: number): Promise<Buffer> {
  const { r, g, b } = TRIM_MARK.COLOR;
  return sharp({ create: { width: sw, height: sh, channels: 3, background: "#FFFFFF" } })
    .composite([
      { input: photoRgb, raw: { width: w, height: h, channels: 3 }, left: 0, top: sh - h },
      ...trimMarkRects(w, h, sw, sh).map((m) => ({
        input: { create: { width: m.width, height: m.height, channels: 3 as const, background: { r, g, b } } },
        left: m.x,
        top: m.y,
      })),
    ])
    .removeAlpha()
    .raw()
    .toBuffer();
}

export interface MarkRect {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Which cut it marks and how: "h" = the cut along the photo's top edge, "v" = along its right edge. */
  cut: "h" | "v";
  kind: "extension" | "flush";
}

/**
 * The trim marks for a `w`×`h` photo placed bottom-left on a `sw`×`sh` sheet (see TRIM_MARK).
 * Cut lines: y = sh − h (the photo's top edge, if there is padding above it) and x = w (its right
 * edge, if there is padding to its right). Every mark lies in the padding with its photo-side edge
 * exactly on its cut line, so no mark ever covers a photo pixel. Pure, so tests can check it.
 */
export function trimMarkRects(w: number, h: number, sw: number, sh: number): MarkRect[] {
  const { THICKNESS: T, GAP: G, EDGE_MARGIN: M, FLUSH_LENGTH: F, MIN_EXTENSION } = TRIM_MARK;
  const top = sh - h;
  const right = sw - w;
  if ((top > 0 && top < T) || (right > 0 && right < T)) {
    throw new Error(`${w}x${h} on ${sw}x${sh}: padding too thin for a ${T}px trim mark`);
  }
  const marks: MarkRect[] = [];
  if (top > 0) {
    // Horizontal cut at y = top; marks occupy rows top−T … top−1.
    const y = top - T;
    marks.push({ x: M, y, width: F, height: T, cut: "h", kind: "flush" }); // left end: the photo meets the sheet's left edge
    const ext = sw - M - (w + G);
    if (right > 0 && ext >= MIN_EXTENSION) marks.push({ x: w + G, y, width: ext, height: T, cut: "h", kind: "extension" });
    else marks.push({ x: sw - M - F, y, width: F, height: T, cut: "h", kind: "flush" });
  }
  if (right > 0) {
    // Vertical cut at x = w; marks occupy columns w … w+T−1.
    const ext = top - G - M;
    if (top > 0 && ext >= MIN_EXTENSION) marks.push({ x: w, y: M, width: T, height: ext, cut: "v", kind: "extension" });
    else marks.push({ x: w, y: M, width: T, height: F, cut: "v", kind: "flush" });
    marks.push({ x: w, y: sh - M - F, width: T, height: F, cut: "v", kind: "flush" }); // bottom end: the photo meets the sheet's bottom edge
  }
  return marks;
}
