/**
 * Client-side image preparation for uploads.
 *
 * Handles the two things that break before a photo ever reaches the cropper:
 *   1. HEIC/HEIF files from iPhones — react-advanced-cropper can't decode them,
 *      so we convert to JPEG in the browser first (via heic2any).
 *   2. Oversized files — enforced against the ORIGINAL file so a huge HEIC
 *      can't sneak through by shrinking during conversion.
 *
 * Returns a discriminated result so callers can show a real error instead of
 * silently handing an undecodable blob to the cropper (which renders black).
 */

import type { PrintOrientation } from "@/lib/photo-slots";

const MAX_BYTES = 15 * 1024 * 1024; // 15 MB

export type PrepareImageResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

/** iPhone HEIC/HEIF files often report an empty MIME type, so check the
 *  extension too. */
function isHeic(file: File): boolean {
  const type = file.type.toLowerCase();
  if (type === "image/heic" || type === "image/heif") return true;
  return /\.(heic|heif)$/i.test(file.name);
}

/**
 * Validate, convert (if HEIC), and produce an object URL ready for the cropper.
 * The 15 MB guard is applied to the original file before any conversion.
 */
export async function prepareImageFile(file: File): Promise<PrepareImageResult> {
  const heic = isHeic(file);

  // Some browsers give HEIC an empty type — allow it through the image gate
  // when the extension says HEIC; otherwise require an image/* type.
  if (!heic && !file.type.startsWith("image/")) {
    return { ok: false, error: "That doesn't look like a photo. Please choose a JPG, PNG, or HEIC file." };
  }

  if (file.size > MAX_BYTES) {
    return { ok: false, error: "Photo is too large (max 15 MB). Please try a smaller file." };
  }

  if (heic) {
    try {
      const { default: heic2any } = await import("heic2any");
      const converted = await heic2any({
        blob: file,
        toType: "image/jpeg",
        quality: 0.92,
      });
      // heic2any returns Blob | Blob[] depending on the source; take the first.
      const blob = Array.isArray(converted) ? converted[0] : converted;
      return { ok: true, url: URL.createObjectURL(blob) };
    } catch {
      return {
        ok: false,
        error: "We couldn't open this photo. Please try a JPG or PNG instead.",
      };
    }
  }

  return { ok: true, url: URL.createObjectURL(file) };
}

/**
 * Read an image's natural dimensions and report which way up it is.
 *
 * Used to default an extra print to the shape of the photo the customer
 * actually chose, so nobody has to guess an orientation before seeing the
 * picture. Resolves to null when the image can't be measured or is square —
 * in both cases the caller keeps whatever orientation it already had.
 */
export function detectImageOrientation(
  url: string
): Promise<PrintOrientation | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const width = img.naturalWidth || img.width;
      const height = img.naturalHeight || img.height;
      if (!width || !height || width === height) return resolve(null);
      resolve(width > height ? "landscape" : "portrait");
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}
