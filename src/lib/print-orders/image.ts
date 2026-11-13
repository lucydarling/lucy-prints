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
 * a sheet) centered on a white sheet with gray corner crop marks in the margin
 * (see trimMarkRects).
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
 * The sheet as raw RGB: white, the `w`×`h` RGB photo centered (see photoOrigin), then the crop
 * marks. The photo's pixels are copied unchanged.
 */
export async function composeSheet(photoRgb: Buffer, w: number, h: number, sw: number, sh: number): Promise<Buffer> {
  const { r, g, b } = TRIM_MARK.COLOR;
  const { x, y } = photoOrigin(w, h, sw, sh);
  return sharp({ create: { width: sw, height: sh, channels: 3, background: "#FFFFFF" } })
    .composite([
      { input: photoRgb, raw: { width: w, height: h, channels: 3 }, left: x, top: y },
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

/** Where a `w`×`h` photo sits on a `sw`×`sh` sheet: centered. Refuses a half-pixel offset. */
export function photoOrigin(w: number, h: number, sw: number, sh: number): { x: number; y: number } {
  const x = (sw - w) / 2;
  const y = (sh - h) / 2;
  if (x < 0 || y < 0 || !Number.isInteger(x) || !Number.isInteger(y)) {
    throw new Error(`${w}x${h} cannot be centered on ${sw}x${sh} on whole pixels`);
  }
  return { x, y };
}

export interface MarkRect {
  x: number;
  y: number;
  width: number;
  height: number;
  /** The cut edge it marks. */
  edge: "top" | "bottom" | "left" | "right";
  /** "corner": in the margin beyond the end of the edge. "tick": beside a photo edge that runs to the sheet edge. */
  kind: "corner" | "tick";
}

/**
 * The crop marks for a `w`×`h` photo centered on a `sw`×`sh` sheet (see TRIM_MARK). A cut edge is a
 * photo edge with white margin outside it. Each of its two ends gets one mark lying in the
 * THICKNESS px just outside the edge: a corner mark (GAP past the photo's corner to EDGE_MARGIN
 * before the sheet edge) where there is margin beyond that end, else a TICK_LENGTH tick EDGE_MARGIN
 * in from the sheet edge. No mark ever covers a photo pixel. Pure, so tests can check it.
 */
export function trimMarkRects(w: number, h: number, sw: number, sh: number): MarkRect[] {
  const { THICKNESS: T, GAP: G, EDGE_MARGIN: E, TICK_LENGTH: L } = TRIM_MARK;
  const { x: x0, y: y0 } = photoOrigin(w, h, sw, sh);
  const x1 = x0 + w; // first column right of the photo
  const y1 = y0 + h; // first row below the photo
  if ((y0 > 0 && y0 < T) || (x0 > 0 && x0 < T)) throw new Error(`${w}x${h} on ${sw}x${sh}: margin too thin for a ${T}px crop mark`);

  /** The two marks along one edge, as [start, end) spans on the axis the edge runs along. */
  const spans = (lo: number, hi: number, size: number): Array<[number, number, MarkRect["kind"]]> => {
    const out: Array<[number, number, MarkRect["kind"]]> = [];
    out.push(lo > 0 ? [E, lo - G, "corner"] : [E, E + L, "tick"]);
    out.push(hi < size ? [hi + G, size - E, "corner"] : [size - E - L, size - E, "tick"]);
    for (const [a, b] of out) if (b - a < 1) throw new Error(`${w}x${h} on ${sw}x${sh}: no room for a crop mark`);
    return out;
  };
  const marks: MarkRect[] = [];
  if (y0 > 0) {
    for (const [a, b, kind] of spans(x0, x1, sw)) {
      marks.push({ x: a, y: y0 - T, width: b - a, height: T, edge: "top", kind });
      marks.push({ x: a, y: y1, width: b - a, height: T, edge: "bottom", kind });
    }
  }
  if (x0 > 0) {
    for (const [a, b, kind] of spans(y0, y1, sh)) {
      marks.push({ x: x0 - T, y: a, width: T, height: b - a, edge: "left", kind });
      marks.push({ x: x1, y: a, width: T, height: b - a, edge: "right", kind });
    }
  }
  return marks;
}
