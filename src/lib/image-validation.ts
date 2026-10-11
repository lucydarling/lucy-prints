import sharp from "sharp";
import { getPrintDimensions, parsePrintLabel, type PrintSize } from "@/lib/photo-slots";

/** An upload must be at least this fraction of the print's pixel size. Real crops are exactly 100%. */
export const MIN_UPLOAD_FRACTION = 0.5;

export type UploadCheck = { ok: true } | { ok: false; message: string };

/**
 * Decode an uploaded image and make sure it is big enough to print at the
 * given size (`printLabel` as stored, e.g. "4x3", "6x4"; unknown labels fall
 * back to `fallbackSize`). The app always crops to the exact print size, so
 * anything under half of it is a broken or placeholder file.
 */
export async function checkUploadSize(
  bytes: Buffer,
  printLabel: string | null | undefined,
  fallbackSize: PrintSize = "4x4"
): Promise<UploadCheck> {
  const parsed = parsePrintLabel(printLabel) ?? { size: fallbackSize };
  const { width: needW, height: needH } = getPrintDimensions(parsed.size, "orientation" in parsed ? parsed.orientation : undefined);
  const tooSmall = {
    ok: false as const,
    message:
      "This photo is too small or damaged to print. Please choose a different photo — it should be at least " +
      `${Math.round(needW * MIN_UPLOAD_FRACTION)}×${Math.round(needH * MIN_UPLOAD_FRACTION)} pixels.`,
  };
  try {
    // Full decode, so a truncated or corrupt file fails here, not at the print lab.
    const { info } = await sharp(bytes).raw().toBuffer({ resolveWithObject: true });
    const fits = (w: number, h: number) => w >= needW * MIN_UPLOAD_FRACTION && h >= needH * MIN_UPLOAD_FRACTION;
    // Accept the print turned on its side too (EXIF-rotated files).
    return fits(info.width, info.height) || fits(info.height, info.width) ? { ok: true } : tooSmall;
  } catch {
    return {
      ok: false,
      message: "This photo could not be read — it may be damaged. Please choose a different photo.",
    };
  }
}
