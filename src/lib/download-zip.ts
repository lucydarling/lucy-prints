import JSZip from "jszip";
import { PHOTO_SLOTS, type PrintSize } from "@/lib/photo-slots";
import type { PhotoEntry, ExtraPrint } from "@/store/photo-store";

export interface DownloadOptions {
  /** When true, 3x3 images are placed on a 4x4 canvas with white padding
   *  (1 inch top, 1 inch right at 300 DPI) so they can be printed as 4x4
   *  and trimmed to 3x3. */
  pad3x3to4x4?: boolean;
}

/**
 * Build and trigger download of a ZIP file containing all cropped photos,
 * organized by section folder.
 *
 * Folder structure:
 *   Lucy Darling Prints/
 *   ├── 01 - Baby's Photo/
 *   │   └── Baby's Photo (4x4).jpg
 *   ├── 02 - Before Baby/
 *   │   ├── Ultrasound Photo (4x6).jpg
 *   │   └── Baby Bump Photo (4x4).jpg
 *   ├── ...
 *   └── Extra Prints/
 *       ├── Extra 4x4 Print 1.jpg
 *       └── Extra 4x6 Print 2.jpg
 */
export async function downloadPhotosZip(
  photos: Record<string, PhotoEntry>,
  extras: ExtraPrint[],
  bookTheme: string,
  options: DownloadOptions = {}
): Promise<void> {
  const zip = new JSZip();
  const root = zip.folder("Lucy Darling Prints")!;

  // Group photo slots by section, in order
  const sectionOrder: Map<string, { label: string; index: number }> = new Map();
  let sectionIdx = 1;

  for (const slot of PHOTO_SLOTS) {
    if (!sectionOrder.has(slot.section)) {
      sectionOrder.set(slot.section, {
        label: slot.sectionLabel,
        index: sectionIdx++,
      });
    }
  }

  // Add regular slot photos
  for (const slot of PHOTO_SLOTS) {
    const photo = photos[slot.key];
    const imageData = photo?.croppedUrl;
    if (!imageData) continue;

    const sectionInfo = sectionOrder.get(slot.section)!;
    const folderName = `${String(sectionInfo.index).padStart(2, "0")} - ${sectionInfo.label}`;
    const folder = root.folder(folderName)!;

    const shouldPad = options.pad3x3to4x4 && slot.size === "3x3";
    const sizeLabel = shouldPad ? '3x3" on 4x4 trim sheet' : getSizeLabel(slot.size);
    const fileName = `${slot.prompt} (${sizeLabel}).jpg`;

    const blob = shouldPad
      ? await padImageTo4x4(imageData)
      : await dataUrlToBlob(imageData);
    folder.file(fileName, blob);
  }

  // Add extras
  const croppedExtras = extras.filter((e) => e.croppedUrl);
  if (croppedExtras.length > 0) {
    const extrasFolder = root.folder("Extra Prints")!;
    for (let i = 0; i < croppedExtras.length; i++) {
      const extra = croppedExtras[i];
      const shouldPad = options.pad3x3to4x4 && extra.size === "3x3";
      const sizeLabel = shouldPad ? '3x3" on 4x4 trim sheet' : getSizeLabel(extra.size);
      const fileName = `Extra ${sizeLabel} Print ${i + 1}.jpg`;
      const blob = shouldPad
        ? await padImageTo4x4(extra.croppedUrl!)
        : await dataUrlToBlob(extra.croppedUrl!);
      extrasFolder.file(fileName, blob);
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

function getSizeLabel(size: PrintSize): string {
  switch (size) {
    case "3x3":
      return '3x3"';
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
