import JSZip from "jszip";
import { PHOTO_SLOTS, type PrintSize, type PhotoSlot } from "@/lib/photo-slots";
import type { PhotoEntry, ExtraPrint } from "@/store/photo-store";

export interface DownloadOptions {
  /** When true, 3x3 images are placed on a 4x4 canvas with white padding
   *  (1 inch top, 1 inch right at 300 DPI) so they can be printed as 4x4
   *  and trimmed to 3x3. */
  pad3x3to4x4?: boolean;
  /** Baby's name for personalized filenames. Defaults to "Baby" if not set. */
  babyName?: string | null;
}

/**
 * Build and trigger download of a ZIP file containing all cropped photos.
 *
 * All images are flat in a single folder, numbered for book order, with
 * personalized filenames using the baby's name:
 *
 *   Lucy Darling Prints/
 *   ├── 01 Fred's Photo (4x4).jpg
 *   ├── 02 Ultrasound Photo (4x6).jpg
 *   ├── 03 Baby Bump Photo (4x4).jpg
 *   ├── 06 Fred's Month 1 (4x4).jpg
 *   ├── 18 Fred's First Bath (3x3).jpg
 *   ├── 34 Fred's First Christmas (3x3).jpg
 *   ├── 44 Fred's 1st Birthday (4x4).jpg
 *   ├── Extra 4x4 Print 1.jpg
 *   └── Extra 4x6 Print 2.jpg
 */
export async function downloadPhotosZip(
  photos: Record<string, PhotoEntry>,
  extras: ExtraPrint[],
  bookTheme: string,
  options: DownloadOptions = {}
): Promise<void> {
  const zip = new JSZip();
  const root = zip.folder("Lucy Darling Prints")!;
  const name = options.babyName?.trim() || "Baby";

  // Add regular slot photos — flat, numbered, personalized
  for (const slot of PHOTO_SLOTS) {
    const photo = photos[slot.key];
    const imageData = photo?.croppedUrl;
    if (!imageData) continue;

    const shouldPad = options.pad3x3to4x4 && slot.size === "3x3";
    const sizeLabel = shouldPad ? '3x3 on 4x4 trim sheet' : getSizeLabel(slot.size);
    const label = personalizeSlotName(slot, name, photo.customLabel);
    const orderNum = String(slot.sortOrder).padStart(2, "0");
    const fileName = `${orderNum} ${label} (${sizeLabel}).jpg`;

    const blob = shouldPad
      ? await padImageTo4x4(imageData)
      : await dataUrlToBlob(imageData);
    root.file(fileName, blob);
  }

  // Add extras — no number prefix, just "Extra" label
  const croppedExtras = extras.filter((e) => e.croppedUrl);
  if (croppedExtras.length > 0) {
    for (let i = 0; i < croppedExtras.length; i++) {
      const extra = croppedExtras[i];
      const shouldPad = options.pad3x3to4x4 && extra.size === "3x3";
      const sizeLabel = shouldPad ? '3x3 on 4x4 trim sheet' : getSizeLabel(extra.size);
      const fileName = `Extra ${sizeLabel} Print ${i + 1}.jpg`;
      const blob = shouldPad
        ? await padImageTo4x4(extra.croppedUrl!)
        : await dataUrlToBlob(extra.croppedUrl!);
      root.file(fileName, blob);
    }
  }

  // Generate ZIP and trigger download
  const content = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(content);
  const a = document.createElement("a");
  a.href = url;
  a.download = `lucy-darling-prints-${bookTheme}.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Generate a personalized filename label for a photo slot.
 *
 * Examples with babyName="Fred":
 *   "Baby's Photo"       → "Fred's Photo"
 *   "Month 3"            → "Fred's Month 3"
 *   "First Bath"         → "Fred's First Bath"
 *   "1st Birthday"       → "Fred's 1st Birthday"
 *   "First Day of School"→ "Fred's First Day of School"
 *   "First Holiday #1" (customLabel="Christmas") → "Fred's First Christmas"
 *   "My First ___" (customLabel="Camping Trip")  → "Fred's First Camping Trip"
 *   "Ultrasound Photo"   → "Ultrasound Photo" (unchanged)
 *   "Our Home"           → "Our Home" (unchanged)
 */
function personalizeSlotName(
  slot: PhotoSlot,
  babyName: string,
  customLabel?: string
): string {
  const possessive = `${babyName}'s`;

  // Custom-labeled slots: "My First ___" or "First Holiday #1/#2"
  if (slot.customLabel && customLabel) {
    return `${possessive} First ${customLabel}`;
  }

  // "Baby's Photo" → "Fred's Photo"
  if (slot.prompt.startsWith("Baby's")) {
    return slot.prompt.replace("Baby's", possessive);
  }

  // Sections where we prepend the baby's name
  const personalizedSections = [
    "monthly_milestones", // "Month 1" → "Fred's Month 1"
    "firsts",             // "First Bath" → "Fred's First Bath"
    "milestones",         // "First Crawl" → "Fred's First Crawl"
    "birthdays",          // "1st Birthday" → "Fred's 1st Birthday"
    "school",             // "First Day of School" → "Fred's First Day of School"
    "holidays",           // "First Holiday #1" (no custom label) → "Fred's First Holiday #1"
  ];

  if (personalizedSections.includes(slot.section)) {
    return `${possessive} ${slot.prompt}`;
  }

  // Everything else stays as-is: "Ultrasound Photo", "Baby Bump Photo",
  // "Birth / Arrival Photo", "Our Home"
  return slot.prompt;
}

function getSizeLabel(size: PrintSize): string {
  switch (size) {
    case "3x3":
      return '3x3"';
    case "4x3":
      return '4x3"';
    case "4x4":
      return '4x4"';
    case "4x6":
      return '4x6"';
  }
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl);
  return res.blob();
}

/**
 * Place a 3x3" image (900×900px @ 300 DPI) onto a 4x4" canvas (1200×1200px)
 * with white padding: 1 inch (300px) on top, 1 inch (300px) on the right.
 * The image sits at bottom-left. Customer prints at 4x4 and trims the
 * white top and right edges to get a perfect 3x3.
 */
async function padImageTo4x4(dataUrl: string): Promise<Blob> {
  const img = await loadImage(dataUrl);
  const canvas = document.createElement("canvas");
  // 4x4" at 300 DPI
  canvas.width = 1200;
  canvas.height = 1200;
  const ctx = canvas.getContext("2d")!;

  // Fill white background
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, 1200, 1200);

  // Draw thin trim guides (light gray dashed lines)
  ctx.strokeStyle = "#DDDDDD";
  ctx.lineWidth = 1;
  ctx.setLineDash([8, 4]);
  // Horizontal guide at y=300 (top of image area)
  ctx.beginPath();
  ctx.moveTo(0, 300);
  ctx.lineTo(1200, 300);
  ctx.stroke();
  // Vertical guide at x=900 (right edge of image area)
  ctx.beginPath();
  ctx.moveTo(900, 0);
  ctx.lineTo(900, 1200);
  ctx.stroke();
  ctx.setLineDash([]);

  // Add small "trim here" labels
  ctx.fillStyle = "#CCCCCC";
  ctx.font = "20px sans-serif";
  ctx.fillText("✂ trim", 920, 620);
  ctx.save();
  ctx.translate(450, 280);
  ctx.rotate(0);
  ctx.fillText("✂ trim", 0, 0);
  ctx.restore();

  // Place image at bottom-left: x=0, y=300
  ctx.drawImage(img, 0, 300, 900, 900);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Canvas toBlob failed"))),
      "image/jpeg",
      0.95
    );
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
