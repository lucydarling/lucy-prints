import JSZip from "jszip";
import {
  getBookSlots,
  getProductForTheme,
  type RegionChoice,
  getBookWord,
  getPrintDimensions,
  getPrintSizeLabel,
  isAlwaysPaddedTo4x4,
  type PrintOrientation,
  type PrintSize,
  type PhotoSlot,
} from "@/lib/photo-slots";
import {
  getBookPrompts,
  repeatItemsWithContent,
  repeatNoteKey,
  type SlotPrompts,
} from "@/lib/book-prompts";
import type { PhotoEntry, ExtraPrint } from "@/store/photo-store";
import { LITTLE_YEARS_AGES, extraPagesFor, isExtraPage } from "@/lib/extra-pages";

export interface DownloadOptions {
  /** When true, 3x3 images are placed on a 4x4 canvas with white padding
   *  (1 inch top, 1 inch right at 300 DPI) so they can be printed as 4x4
   *  and trimmed to 3x3. */
  pad3x3to4x4?: boolean;
  /** When true, ALL images are placed on a 4x6" canvas (1200×1800px @ 300 DPI)
   *  with white padding and trim guides. Allows ordering everything as one
   *  standard size. Overrides pad3x3to4x4 when set. */
  padAllTo4x6?: boolean;
  /** Baby's name for personalized filenames. Defaults to "Baby" if not set. */
  babyName?: string | null;
  /** Book detail notes (slotKey → promptKey → value). If any notes exist,
   *  a book-details.txt reference sheet is included in the ZIP. */
  notes?: Record<string, Record<string, string>>;
  /** Layouts chosen for the book's regions (books with regions only). */
  regionLayouts?: Record<string, RegionChoice>;
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
  let addedImages = 0;

  // Only the photos the book is using, each at the size it will print.
  const slots = getBookSlots(bookTheme, options.regionLayouts);
  const isLittleYears = getProductForTheme(bookTheme) === "little_years";

  // Add regular slot photos — flat, numbered, personalized
  for (const slot of slots) {
    const photo = photos[slot.key];
    const imageData = photo?.croppedUrl;
    if (!imageData) continue;

    // Memory book slots print in their natural shape (no orientation); a
    // region photo carries the shape its layout picked.
    const { sizeLabel, blob } = await preparePrint(
      imageData,
      slot.size,
      slot.orientation,
      options
    );

    root.file(slotFileName(bookTheme, slot, slots, options.babyName, photo.customLabel, sizeLabel), blob);
    addedImages++;
  }

  // The Little Years' extra pages sit right after their age's photos:
  //   030 Ollie Age One Snapshot 16 (4x4").jpg
  //   030-01 Ollie Age One Extra Page 1 (4x4").jpg
  //   031 Ollie Age Two Birthday 1 (4x4").jpg
  const extraPageSummary: ExtraPageSummary[] = [];
  if (isLittleYears) {
    for (const age of LITTLE_YEARS_AGES) {
      const pages = extraPagesFor(extras, age.age).filter((e) => e.croppedUrl);
      const prefixes: string[] = [];
      for (let i = 0; i < pages.length; i++) {
        const { sizeLabel, blob } = await preparePrint(pages[i].croppedUrl!, pages[i].size, pages[i].orientation, options);
        const prefix = `${String(age.lastSortOrder).padStart(3, "0")}-${String(i + 1).padStart(2, "0")}`;
        const parts = [prefix, options.babyName?.trim() || "", age.label, `Extra Page ${i + 1}`];
        root.file(`${safeZipName(parts.filter(Boolean).join(" "))} (${sizeLabel}).jpg`, blob);
        prefixes.push(prefix);
        addedImages++;
      }
      if (prefixes.length > 0) extraPageSummary.push({ label: age.label, prefixes });
    }
  }

  // Add extras — no number prefix, just "Extra" label
  const croppedExtras = extras.filter(
    (e) => e.croppedUrl && !(isLittleYears && isExtraPage(e))
  );
  if (croppedExtras.length > 0) {
    for (let i = 0; i < croppedExtras.length; i++) {
      const extra = croppedExtras[i];

      const { sizeLabel, blob } = await preparePrint(
        extra.croppedUrl!,
        extra.size,
        extra.orientation,
        options
      );

      const fileName = `Extra ${sizeLabel} Print ${i + 1}.jpg`;
      root.file(fileName, blob);
      addedImages++;
    }
  }

  // Never produce a ZIP with no photos in it — surface the failure to the
  // caller (review page shows an alert) instead of downloading an empty folder.
  if (addedImages === 0) {
    throw new Error("No cropped photos to download");
  }

  // Add book details reference sheet if notes (or Little Years extra pages) exist
  if (options.notes || extraPageSummary.length > 0) {
    const detailsText = generateBookDetailsText(
      options.notes ?? {},
      name,
      slots,
      getBookPrompts(bookTheme),
      extraPageSummary,
      getBookWord(bookTheme)
    );
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

/** The file name for one book photo (no folder), for any book. */
export function slotFileName(
  bookTheme: string,
  slot: PhotoSlot,
  slots: PhotoSlot[],
  babyName: string | null | undefined,
  customLabel: string | undefined,
  sizeLabel: string
): string {
  const product = getProductForTheme(bookTheme);
  if (product === "pregnancy_journal") return journalFileName(slot, slots, sizeLabel);
  if (product === "little_years") return littleYearsFileName(slot, babyName?.trim() || "", customLabel, sizeLabel);
  const name = babyName?.trim() || "Baby";
  return `${String(slot.sortOrder).padStart(2, "0")} ${safeZipName(personalizeSlotName(slot, name, customLabel))} (${sizeLabel}).jpg`;
}

/**
 * One path segment of a ZIP entry: a "/" or "\\" would make a folder (the
 * memory book's "Birth / Arrival Photo" did), and the rest aren't allowed in
 * Windows filenames. Every name built from a slot, section, baby name or
 * customer label goes through this.
 */
export function safeZipName(segment: string): string {
  return segment.replace(/[\\/:*?"<>|]/g, "-");
}

/**
 * Pregnancy journal filenames start with the page so the parent can find
 * where each print goes, and sort in book order:
 *   p05 Month 3 (4x3 on 4x4 trim sheet).jpg
 *   p16 Baby shower photos 2 of 4 (3x3").jpg
 *   p19 Babymoon + adventures, photo 1 (3.5x3.5 on 4x4 trim sheet).jpg
 */
function journalFileName(slot: PhotoSlot, slots: PhotoSlot[], sizeLabel: string): string {
  const page = `p${String(slot.page ?? 0).padStart(2, "0")}`;
  let label = slot.prompt;
  if (slot.region) {
    const inRegion = slots.filter((s) => s.region === slot.region).length;
    if (inRegion > 1) label = `${label} ${slot.regionIndex} of ${inRegion}`;
  }
  return `${page} ${safeZipName(label)} (${sizeLabel}).jpg`;
}

/**
 * The Little Years filenames: a 3-digit number (146 photos, so 001–146 sort
 * in book order), the child's name if given, the age, then where it goes:
 *   001 Ollie This Is the Story Of (5x5").jpg
 *   002 Ollie Age One Birthday 1 (4x4").jpg
 *   012 Ollie Age One Holiday 4 Halloween (4x4").jpg
 *   030 Age One Snapshot 16 (4x4").jpg        (no name given)
 */
function littleYearsFileName(
  slot: PhotoSlot,
  childName: string,
  customLabel: string | undefined,
  sizeLabel: string
): string {
  const n = slot.key.match(/_(\d+)$/)?.[1];
  const kind = slot.key.replace(/^ly_(a\d_)?/, "").replace(/_\d+$/, "");
  const label =
    kind === "story"
      ? slot.prompt
      : kind === "birthday"
      ? `Birthday ${n}`
      : kind === "grown"
      ? `Grown ${n}`
      : kind === "family"
      ? "Our Family"
      : kind === "holiday"
      ? `Holiday ${n}${customLabel?.trim() ? ` ${customLabel.trim()}` : ""}`
      : kind === "snapshot"
      ? `Snapshot ${n}`
      : slot.prompt;
  const parts = [String(slot.sortOrder).padStart(3, "0"), childName, slot.group ?? "", label];
  const name = safeZipName(parts.filter(Boolean).join(" "));
  return `${name} (${sizeLabel}).jpg`;
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

function getSizeLabel(size: PrintSize, orientation?: PrintOrientation): string {
  return `${getPrintSizeLabel(size, orientation)}"`;
}

/**
 * Turn one cropped image into the blob that goes in the ZIP, applying whatever
 * white padding and trim guides the chosen print options call for, and the
 * size label that ends up in the filename.
 *
 * `orientation` is only passed for extra prints — book slots always keep
 * their natural shape.
 */
async function preparePrint(
  imageData: string,
  size: PrintSize,
  orientation: PrintOrientation | undefined,
  options: DownloadOptions
): Promise<{ sizeLabel: string; blob: Blob }> {
  const { width, height } = getPrintDimensions(size, orientation);
  const label = getSizeLabel(size, orientation);

  // A 5x5 (The Little Years) is bigger than a 4x6 sheet's width, so it's
  // always handed back as a plain 5x5 file, whatever the sheet options.
  if (size === "5x5") {
    return { sizeLabel: label, blob: await dataUrlToBlob(imageData) };
  }

  if (options.padAllTo4x6) {
    // Everything goes on a 4x6 sheet — turned landscape when the print is
    // too wide to sit upright on it (a 6x4 extra).
    const sheet =
      width > 1200
        ? { width: 1800, height: 1200 }
        : { width: 1200, height: 1800 };

    // Already exactly a 4x6 sheet, either way up — nothing to trim.
    if (width === sheet.width && height === sheet.height) {
      return { sizeLabel: label, blob: await dataUrlToBlob(imageData) };
    }

    return {
      sizeLabel: `${label} on 4x6 trim sheet`,
      blob: await padOntoSheet(imageData, sheet.width, sheet.height),
    };
  }

  // 4x3 / 3x4 and 3.5x3.5 are never printed as-is — most printers don't
  // offer them — so they always go on a 4x4 sheet. 3x3 does too when the
  // option is on.
  const padTo4x4 =
    isAlwaysPaddedTo4x4(size) || (options.pad3x3to4x4 && size === "3x3");
  if (padTo4x4) {
    return {
      // No inch mark here — matches the trim-sheet filenames customers and
      // print labs have been getting all along.
      sizeLabel: `${getPrintSizeLabel(size, orientation)} on 4x4 trim sheet`,
      blob: await padOntoSheet(imageData, 1200, 1200),
    };
  }

  return { sizeLabel: label, blob: await dataUrlToBlob(imageData) };
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl);
  return res.blob();
}

/**
 * Place a print on a larger sheet (1200×1200px = 4x4", 1200×1800px = 4x6",
 * or 1800×1200px = 6x4", all at 300 DPI) with white padding and dashed trim
 * guides. The image sits in the bottom-left corner and a guide runs along
 * each edge that has padding, so the customer orders a standard size and
 * trims along the dashes.
 *
 * Examples: 3x3 (900×900) on a 4x4 sheet gets 1" on top and 1" on the right;
 * 3x4 (900×1200) on a 4x4 sheet gets 1" on the right only; 6x4 (1800×1200)
 * on a 6x4 sheet needs nothing.
 */
async function padOntoSheet(
  dataUrl: string,
  sheetWidth: number,
  sheetHeight: number
): Promise<Blob> {
  const img = await loadImage(dataUrl);
  const width = img.naturalWidth || img.width;
  const height = img.naturalHeight || img.height;

  // Nothing to pad, or the print is bigger than the sheet — hand back the
  // image untouched rather than silently cropping someone's photo.
  if (
    (width === sheetWidth && height === sheetHeight) ||
    width > sheetWidth ||
    height > sheetHeight
  ) {
    return dataUrlToBlob(dataUrl);
  }

  const canvas = document.createElement("canvas");
  canvas.width = sheetWidth;
  canvas.height = sheetHeight;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, sheetWidth, sheetHeight);

  // Image sits at the bottom-left; padding goes on top and to the right.
  const yOffset = sheetHeight - height;
  const hasTopPadding = yOffset > 0;
  const hasRightPadding = width < sheetWidth;

  ctx.strokeStyle = "#DDDDDD";
  ctx.lineWidth = 1;
  ctx.setLineDash([8, 4]);

  if (hasTopPadding) {
    ctx.beginPath();
    ctx.moveTo(0, yOffset);
    ctx.lineTo(sheetWidth, yOffset);
    ctx.stroke();
  }
  if (hasRightPadding) {
    ctx.beginPath();
    ctx.moveTo(width, 0);
    ctx.lineTo(width, sheetHeight);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  ctx.fillStyle = "#CCCCCC";
  ctx.font = "20px sans-serif";
  if (hasTopPadding) {
    ctx.fillText("\u2702 trim", sheetWidth / 2 - 70, yOffset - 20);
  }
  if (hasRightPadding) {
    ctx.fillText("\u2702 trim", width + 20, yOffset + height / 2);
  }

  ctx.drawImage(img, 0, yOffset, width, height);

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
/** One age's extra pages in the ZIP, for the Book Details sheet. */
interface ExtraPageSummary {
  /** "Age One" — the same heading the age's notes print under. */
  label: string;
  /** File-name prefixes in order ("030-01", "030-02"…). */
  prefixes: string[];
}

export function generateBookDetailsText(
  notes: Record<string, Record<string, string>>,
  babyName: string,
  slots: PhotoSlot[],
  prompts: SlotPrompts[],
  extraPages: ExtraPageSummary[] = [],
  bookWord = "memory book"
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

  // Books whose sections sit under a heading ("Age One"…) group their notes
  // by that heading instead. The memory book has none, so it reads as before.
  const groupOf = new Map<string, string | undefined>();
  const labelOf = new Map<string, string>();
  for (const s of slots) {
    if (!groupOf.has(s.section)) groupOf.set(s.section, s.group);
    if (!labelOf.has(s.section)) labelOf.set(s.section, s.sectionLabel);
  }
  const grouped = slots.some((s) => s.group);
  const headerKey = (section: string) =>
    grouped ? groupOf.get(section) ?? section : section;

  for (const entry of prompts) {
    const slotNotes = notes[entry.slotKey];
    if (!slotNotes) continue;

    const repeatItems = entry.repeat ? repeatItemsWithContent(entry, slotNotes) : [];
    const filledPrompts = entry.repeat
      ? []
      : entry.prompts.filter(
          (p) => slotNotes[p.key] && slotNotes[p.key].trim().length > 0
        );
    if (filledPrompts.length === 0 && repeatItems.length === 0) continue;

    hasAnyContent = true;

    // Print section header if we haven't yet
    const header = headerKey(entry.section);
    if (!printedSections.has(header)) {
      if (lines.length > 0) lines.push(""); // blank line before new section
      const sectionLabel = grouped
        ? groupOf.get(entry.section) ?? labelOf.get(entry.section) ?? entry.section
        : sectionLabels[entry.section] || entry.section;
      lines.push(`═══ ${sectionLabel} ═══`);
      lines.push("");
      printedSections.add(header);
    }

    // Slot sub-header
    const slotLabel = entry.standaloneLabel || getSlotDisplayName(entry.slotKey, babyName, slots);
    lines.push(`── ${slotLabel} ──`);

    for (const prompt of filledPrompts) {
      const value = slotNotes[prompt.key].trim();
      lines.push(`  ${prompt.label}: ${value}`);
    }
    repeatItems.forEach((n, i) => {
      const parts = entry.prompts
        .map((p) => ({ label: p.label, value: slotNotes[repeatNoteKey(p.key, n)]?.trim() }))
        .filter((x) => x.value);
      lines.push(`  ${i + 1}. ${parts.map((x) => `${x.label}: ${x.value}`).join(" · ")}`);
    });
    lines.push("");
  }

  if (extraPages.length > 0) {
    addExtraPagesToDetails(lines, extraPages);
    hasAnyContent = true;
  }

  if (!hasAnyContent) return null;

  // Header
  const header = [
    `${babyName}'s Book Details`,
    `Reference sheet for your Lucy Darling ${bookWord}`,
    `Generated ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}`,
    "",
    "─".repeat(50),
    "",
  ];

  return [...header, ...lines].join("\n");
}

/**
 * List each age's extra pages at the end of that age's notes, adding the
 * age's heading when it has no notes (ages stay in book order).
 */
function addExtraPagesToDetails(lines: string[], extraPages: ExtraPageSummary[]): void {
  const isHeader = (l: string) => l.startsWith("═══ ");
  const ageOrder = LITTLE_YEARS_AGES.map((a) => a.label);
  for (const { label, prefixes } of extraPages) {
    const n = prefixes.length;
    const range = n === 1 ? `file ${prefixes[0]}` : `files ${prefixes[0]} to ${prefixes[n - 1]}`;
    const entry = ["── Extra pages ──", `  ${n} ${n === 1 ? "photo" : "photos"} (4x4"), ${range}`, ""];
    const at = lines.indexOf(`═══ ${label} ═══`);
    if (at !== -1) {
      const next = lines.findIndex((l, i) => i > at && isHeader(l));
      // Before the blank line that separates this age from the next heading.
      lines.splice(next === -1 ? lines.length : next - 1, 0, ...entry);
      continue;
    }
    const block = [`═══ ${label} ═══`, "", ...entry];
    const mine = ageOrder.indexOf(label);
    // The intro's heading (not an age) always comes first, so only a later age can follow.
    const nextHeader = lines.findIndex((l) => isHeader(l) && ageOrder.indexOf(l.slice(4, -4)) > mine);
    if (nextHeader === -1) {
      if (lines.length > 0) lines.push("");
      lines.push(...block);
    } else {
      lines.splice(nextHeader, 0, ...block, "");
    }
  }
}

/** Get a friendly display name for a slot key */
function getSlotDisplayName(slotKey: string, babyName: string, slots: PhotoSlot[]): string {
  const slot = slots.find((s) => s.key === slotKey);
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
