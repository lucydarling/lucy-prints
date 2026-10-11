import { getPrintDimensions, parsePrintLabel, type PrintSize } from "@/lib/photo-slots";

type Sharp = typeof import("sharp");

/** An upload must be at least this fraction of the print's pixel size. Real crops are exactly 100%. */
export const MIN_UPLOAD_FRACTION = 0.5;

/**
 * ok: true with `skipped` means the check could not run (sharp is broken, not
 * the photo) and the upload was let through — fail open, so a library outage
 * never blocks every customer's uploads.
 */
export type UploadCheck = { ok: true; skipped?: string } | { ok: false; message: string };

// sharp is loaded lazily, never at module load: a sharp that cannot load
// (e.g. a missing libvips on the server) must not take the whole route down.
let loadSharpImpl: () => Promise<Sharp> = async () => {
  const m = await import("sharp");
  return ((m as { default?: Sharp }).default ?? m) as Sharp;
};
let sharpPromise: Promise<Sharp> | null = null;

function loadSharp(): Promise<Sharp> {
  if (!sharpPromise) {
    sharpPromise = loadSharpImpl();
    // A failed load is retried on the next upload rather than cached forever.
    sharpPromise.catch(() => {
      sharpPromise = null;
    });
  }
  return sharpPromise;
}

/** Tests only: replace how sharp is loaded (e.g. simulate it failing to load). Pass null to restore. */
export function setSharpLoaderForTests(loader: (() => Promise<Sharp>) | null) {
  loadSharpImpl = loader ?? (async () => {
    const m = await import("sharp");
    return ((m as { default?: Sharp }).default ?? m) as Sharp;
  });
  sharpPromise = null;
}

// An 8×8 JPEG that always decodes. If it doesn't, sharp itself is broken.
const KNOWN_GOOD_JPEG = Buffer.from(
  "/9j/2wBDABALDA4MChAODQ4SERATGCgaGBYWGDEjJR0oOjM9PDkzODdASFxOQERXRTc4UG1RV19iZ2hnPk1xeXBkeFxlZ2P/2wBDARESEhgVGC8aGi9jQjhCY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2P/wAARCAAIAAgDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAT/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAwT/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCoAS9//9k=",
  "base64"
);

async function sharpWorks(sharp: Sharp): Promise<boolean> {
  try {
    await sharp(KNOWN_GOOD_JPEG).raw().toBuffer();
    return true;
  } catch {
    return false;
  }
}

const errText = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 300);

/**
 * Decode an uploaded image and make sure it is big enough to print at the
 * given size (`printLabel` as stored, e.g. "4x3", "6x4"; unknown labels fall
 * back to `fallbackSize`). The app always crops to the exact print size, so
 * anything under half of it is a broken or placeholder file.
 *
 * Fails OPEN: if sharp can't load, or can't even decode a known-good image,
 * the upload is accepted with `skipped` set — the caller logs and alerts.
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

  let sharp: Sharp;
  try {
    sharp = await loadSharp();
  } catch (err) {
    return { ok: true, skipped: `sharp failed to load: ${errText(err)}` };
  }

  try {
    // Full decode, so a truncated or corrupt file fails here, not at the print lab.
    const { info } = await sharp(bytes).raw().toBuffer({ resolveWithObject: true });
    const fits = (w: number, h: number) => w >= needW * MIN_UPLOAD_FRACTION && h >= needH * MIN_UPLOAD_FRACTION;
    // Accept the print turned on its side too (EXIF-rotated files).
    return fits(info.width, info.height) || fits(info.height, info.width) ? { ok: true } : tooSmall;
  } catch (err) {
    // The photo, or sharp? A known-good image tells them apart.
    if (!(await sharpWorks(sharp))) {
      return { ok: true, skipped: `sharp cannot decode a known-good image: ${errText(err)}` };
    }
    return {
      ok: false,
      message: "This photo could not be read — it may be damaged. Please choose a different photo.",
    };
  }
}
