import JSZip from "jszip";
import { PHOTO_SLOTS, type PrintSize, type PhotoSlot } from "@/lib/photo-slots";
import { BOOK_PROMPTS, getPromptsForSlot } from "@/lib/book-prompts";
import type { PhotoEntry, ExtraPrint } from "@/store/photo-store";

export interface DownloadOptions {
  /** When true, 3x3 images are placed on a 4x4 canvas with white padding
   *  (1 inch top, 1 inch right at 300 DPI) so they can be printed as 4x4
   *  and trimmed to 3x3. */
  pad3x3to4x4?: boolean;
  /** Baby's name for personalized filenames. Defaults to "Baby" if not set. */
  babyName?: string | null;
  /** Book detail notes (slotKey → promptKey → value). If any notes exist,
   *  a book-details.txt reference sheet is included in the ZIP. */
  notes?: Record<string, Record<string, string>>;
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

  // Add book details reference sheet if notes exist
  if (options.notes) {
    const detailsText = generateBookDetailsText(options.notes, name);
    if (detailsText) {
      root.file("book-details.txt", detailsText);
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

/**
 * Generate a formatted text reference sheet from book detail notes.
 * Returns null if no notes have been filled in.
 */
function generateBookDetailsText(
  notes: Record<string, Record<string, string>>,
  babyName: string
): string | null {
  const lines: string[] = [];
  let hasAnyContent = false;

  // Track which sections we've already printed a header for
  const printedSections = new Set<string>();

  // Section labels for nice headers
  const sectionLabels: Record<string, string> = {
    before_baby: "Before Baby",
    arrival: "Baby's Arrival",
    home: "Our Home",
    time_capsule: "When You Were Born",
    monthly_milestones: "Monthly Milestones",
    favorite_things: "Favorite Things",
    birthdays: "Birthdays",
    school: "First Day of School",
  };

  for (const entry of BOOK_PROMPTS) {
    const slotNotes = notes[entry.slotKey];
    if (!slotNotes) continue;

    const filledPrompts = entry.prompts.filter(
      (p) => slotNotes[p.key] && slotNotes[p.key].trim().length > 0
    );
    if (filledPrompts.length === 0) continue;

    hasAnyContent = true;

    // Print section header if we haven't yet
    if (!printedSections.has(entry.section)) {
      if (lines.length > 0) lines.push(""); // blank line before new section
      const sectionLabel =
        sectionLabels[entry.section] || entry.section;
      lines.push(`═══ ${sectionLabel} ═══`);
      lines.push("");
      printedSections.add(entry.section);
    }

    // Slot sub-header
    const slotLabel = entry.standaloneLabel || getSlotDisplayName(entry.slotKey, babyName);
    lines.push(`── ${slotLabel} ──`);

    for (const prompt of filledPrompts) {
      const value = slotNotes[prompt.key].trim();
      lines.push(`  ${prompt.label}: ${value}`);
    }
    lines.push("");
  }

  if (!hasAnyContent) return null;

  // Header
  const header = [
    `${babyName}'s Book Details`,
    `Reference sheet for your Lucy Darling memory book`,
    `Generated ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}`,
    "",
    "─".repeat(50),
    "",
  ];

  return [...header, ...lines].join("\n");
}

/** Get a friendly display name for a slot key */
function getSlotDisplayName(slotKey: string, babyName: string): string {
  const slot = PHOTO_SLOTS.find((s) => s.key === slotKey);
  if (!slot) return slotKey;

  // Monthly milestones
  const monthMatch = slotKey.match(/^month_(\d+)$/);
  if (monthMatch) return `${babyName}'s Month ${monthMatch[1]}`;

  // Birthdays
  const bdayMatch = slotKey.match(/^birthday_(\d+)$/);
  if (bdayMatch) {
    const n = parseInt(bdayMatch[1]);
    const suffix = n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th";
    return `${babyName}'s ${n}${suffix} Birthday`;
  }

  return slot.prompt;
}
