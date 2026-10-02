import { JOURNAL_ITEMS } from "@/lib/journal-slots";
import { LITTLE_YEARS_SLOTS } from "@/lib/little-years-slots";

export type PrintSize = "3x3" | "3.5x3.5" | "4x3" | "4x4" | "4x6" | "5x5";

/** Which way up a rectangular print is cropped and printed. */
export type PrintOrientation = "portrait" | "landscape";

/** Sizes offered in the Extra Prints section, in the order they're shown. */
export const EXTRA_PRINT_SIZES = ["3x3", "4x3", "4x4", "4x6"] as const;

/**
 * Pixel dimensions at 300 DPI, read as the size name does — width first.
 * "4x6" is 4" wide × 6" tall (1200×1800px); "4x3" is 4" wide × 3" tall.
 */
const PRINT_DIMENSIONS: Record<PrintSize, { width: number; height: number }> = {
  "3x3": { width: 900, height: 900 },
  "3.5x3.5": { width: 1050, height: 1050 },
  "4x3": { width: 1200, height: 900 },
  "4x4": { width: 1200, height: 1200 },
  "4x6": { width: 1200, height: 1800 },
  // The Little Years book only — never offered as an extra print.
  "5x5": { width: 1500, height: 1500 },
};

/**
 * Sizes no print service sells, so the ZIP always puts them on a 4x4 sheet
 * with trim guides: 4x3 (either way up) and the journal's 3.5" squares.
 */
export function isAlwaysPaddedTo4x4(size: PrintSize): boolean {
  return size === "4x3" || size === "3.5x3.5";
}

/** Every print size, in no particular order. */
export const ALL_PRINT_SIZES = Object.keys(PRINT_DIMENSIONS) as PrintSize[];

/** True for sizes where portrait and landscape are the same shape. */
export function isSquarePrintSize(size: PrintSize): boolean {
  const { width, height } = PRINT_DIMENSIONS[size];
  return width === height;
}

/**
 * Pixel dimensions at 300 DPI. Pass an orientation to force the print
 * portrait or landscape (rectangular sizes only); omit it to get a book
 * slot's natural shape, which never rotates.
 */
export function getPrintDimensions(
  size: PrintSize,
  orientation?: PrintOrientation
): { width: number; height: number } {
  const base = PRINT_DIMENSIONS[size];
  if (!orientation || base.width === base.height) return base;

  const wantsLandscape = orientation === "landscape";
  const isLandscape = base.width > base.height;
  return wantsLandscape === isLandscape
    ? base
    : { width: base.height, height: base.width };
}

/**
 * The size as it reads on the finished print:
 * 4x6 portrait → "4x6", 4x6 landscape → "6x4", 4x3 portrait → "3x4".
 */
export function getPrintSizeLabel(
  size: PrintSize,
  orientation?: PrintOrientation
): string {
  const { width, height } = getPrintDimensions(size, orientation);
  return `${width / 300}x${height / 300}`;
}

/** Crop aspect ratio (width ÷ height) for a size + orientation. */
export function getPrintAspectRatio(
  size: PrintSize,
  orientation?: PrintOrientation
): number {
  const { width, height } = getPrintDimensions(size, orientation);
  return width / height;
}

/** Which book a theme belongs to. Every theme of a product shares its slots. */
export type ProductType = "memory_book" | "pregnancy_journal" | "little_years";

export interface PhotoSlot {
  key: string;
  prompt: string;
  size: PrintSize;
  section: string;
  sectionLabel: string;
  sortOrder: number;
  /** If true, customer can edit the prompt label (e.g. "My First ___") */
  customLabel?: boolean;
  /** If true, show an optional date field (for personal records, not printed) */
  dateField?: boolean;
  /** Page of the printed book this photo goes on, where that's tracked. */
  page?: number;
  /**
   * Set when the print must be cropped portrait or landscape — a region
   * photo whose layout picks the shape. Book slots without it keep their
   * natural shape (a 4x3 is landscape), exactly as before regions existed.
   */
  orientation?: PrintOrientation;
  /** For a photo inside a region: the region's key and its 1-based position. */
  region?: string;
  regionIndex?: number;
  /** Heading that groups sections on the dashboard ("Age One"…), where a book has one. */
  group?: string;
}

/**
 * One way to fill a region: `count` prints of one size, all the same way up.
 * Every layout is checked against the page's measured clear area (with 0.25"
 * between prints) before it's offered, so whatever the parent picks fits.
 */
export interface RegionLayout {
  id: string;
  count: number;
  size: PrintSize;
  /** Orientations that fit `count` of these on the page; squares list "portrait". */
  orientations: PrintOrientation[];
}

/**
 * Part of a page where the parent arranges several photos by hand (the
 * pregnancy journal's month pages, shower pages…). The app sizes the photos;
 * the parent places them. Each photo gets its own slot key `<key>_<n>`.
 */
export interface PhotoRegion {
  key: string;
  prompt: string;
  page: number;
  section: string;
  sectionLabel: string;
  sortOrder: number;
  /** DRAFT guidance shown on the card — pending Haily's voice pass. */
  guidance?: string;
  /** Layouts offered, the default first. Each size appears at most once. */
  layouts: RegionLayout[];
}

/** The customer's layout + orientation for one region. */
export interface RegionChoice {
  layoutId: string;
  orientation: PrintOrientation;
}

/** The photo slots a region expands to: one per position, up to its largest layout. */
export function expandRegion(region: PhotoRegion): PhotoSlot[] {
  const max = Math.max(...region.layouts.map((l) => l.count));
  return Array.from({ length: max }, (_, i) => ({
    key: `${region.key}_${i + 1}`,
    prompt: region.prompt,
    size: region.layouts[0].size,
    section: region.section,
    sectionLabel: region.sectionLabel,
    sortOrder: region.sortOrder + (i + 1) / 100,
    page: region.page,
    region: region.key,
    regionIndex: i + 1,
  }));
}

/**
 * All 49 required photo slots in a Lucy Darling memory book.
 * Every book theme shares this exact same layout — only the illustrations differ.
 */
export const PHOTO_SLOTS: PhotoSlot[] = [
  // ── Baby's Photo (1 photo, 4x4) ──
  {
    key: "baby_photo",
    prompt: "Baby's Photo",
    size: "4x4",
    section: "baby_photo",
    sectionLabel: "Baby's Photo",
    sortOrder: 1,
  },

  // ── Before Baby (2 photos: 4x3 + 3x3) ──
  {
    key: "ultrasound",
    prompt: "Ultrasound Photo",
    size: "4x3",
    section: "before_baby",
    sectionLabel: "Before Baby",
    sortOrder: 2,
  },
  {
    key: "baby_bump",
    prompt: "Baby Bump Photo",
    size: "3x3",
    section: "before_baby",
    sectionLabel: "Before Baby",
    sortOrder: 3,
  },

  // ── Baby's Arrival (1 photo, 4x4) ──
  {
    key: "birth_arrival",
    prompt: "Birth / Arrival Photo",
    size: "4x4",
    section: "arrival",
    sectionLabel: "Baby's Arrival",
    sortOrder: 4,
  },

  // ── Our Home (1 photo, 4x4) ──
  {
    key: "our_home",
    prompt: "Our Home",
    size: "4x4",
    section: "home",
    sectionLabel: "Our Home",
    sortOrder: 5,
  },

  // ── Monthly Milestones (12 photos, 4x4) ──
  ...Array.from({ length: 12 }, (_, i) => ({
    key: `month_${i + 1}`,
    prompt: `Month ${i + 1}`,
    size: "4x4" as PrintSize,
    section: "monthly_milestones",
    sectionLabel: "Monthly Milestones",
    sortOrder: 6 + i,
  })),

  // ── Firsts (6 photos, 3x3) ──
  {
    key: "first_bath",
    prompt: "First Bath",
    size: "3x3",
    section: "firsts",
    sectionLabel: "Firsts",
    sortOrder: 18,
    dateField: true,
  },
  {
    key: "first_smile",
    prompt: "First Smile",
    size: "3x3",
    section: "firsts",
    sectionLabel: "Firsts",
    sortOrder: 19,
    dateField: true,
  },
  {
    key: "first_car_ride",
    prompt: "First Car Ride",
    size: "3x3",
    section: "firsts",
    sectionLabel: "Firsts",
    sortOrder: 20,
    dateField: true,
  },
  {
    key: "first_doctor_visit",
    prompt: "First Doctor Visit",
    size: "3x3",
    section: "firsts",
    sectionLabel: "Firsts",
    sortOrder: 21,
    dateField: true,
  },
  {
    key: "first_tooth",
    prompt: "First Tooth",
    size: "3x3",
    section: "firsts",
    sectionLabel: "Firsts",
    sortOrder: 22,
    dateField: true,
  },
  {
    key: "first_big_trip",
    prompt: "First Big Trip",
    size: "3x3",
    section: "firsts",
    sectionLabel: "Firsts",
    sortOrder: 23,
    dateField: true,
  },

  // ── Milestones (8 photos, 3x3) ──
  {
    key: "first_sit_up",
    prompt: "First Time Sitting Up",
    size: "3x3",
    section: "milestones",
    sectionLabel: "Milestones",
    sortOrder: 24,
    dateField: true,
  },
  {
    key: "first_crawl",
    prompt: "First Crawl",
    size: "3x3",
    section: "milestones",
    sectionLabel: "Milestones",
    sortOrder: 25,
    dateField: true,
  },
  {
    key: "first_stand",
    prompt: "First Time Standing",
    size: "3x3",
    section: "milestones",
    sectionLabel: "Milestones",
    sortOrder: 26,
    dateField: true,
  },
  {
    key: "first_steps",
    prompt: "First Steps",
    size: "3x3",
    section: "milestones",
    sectionLabel: "Milestones",
    sortOrder: 27,
    dateField: true,
  },
  {
    key: "first_wave",
    prompt: "First Wave",
    size: "3x3",
    section: "milestones",
    sectionLabel: "Milestones",
    sortOrder: 28,
    dateField: true,
  },
  {
    key: "first_laugh",
    prompt: "First Laugh",
    size: "3x3",
    section: "milestones",
    sectionLabel: "Milestones",
    sortOrder: 29,
    dateField: true,
  },
  {
    key: "first_haircut",
    prompt: "First Haircut",
    size: "3x3",
    section: "milestones",
    sectionLabel: "Milestones",
    sortOrder: 30,
    dateField: true,
  },
  {
    key: "first_words",
    prompt: "First Words",
    size: "3x3",
    section: "milestones",
    sectionLabel: "Milestones",
    sortOrder: 31,
    dateField: true,
  },

  // ── First Holidays (12 photos, 3x3 — customer labels each one) ──
  ...Array.from({ length: 12 }, (_, i) => ({
    key: `my_first_${i + 1}`,
    prompt: `My First ___`,
    size: "3x3" as PrintSize,
    section: "holidays",
    sectionLabel: "First Holidays",
    sortOrder: 32 + i,
    customLabel: true,
  })),

  // ── Birthdays (5 photos, 4x4) — before school, matching book order ──
  {
    key: "birthday_1",
    prompt: "1st Birthday",
    size: "4x4",
    section: "birthdays",
    sectionLabel: "Birthdays",
    sortOrder: 44,
  },
  {
    key: "birthday_2",
    prompt: "2nd Birthday",
    size: "4x4",
    section: "birthdays",
    sectionLabel: "Birthdays",
    sortOrder: 45,
  },
  {
    key: "birthday_3",
    prompt: "3rd Birthday",
    size: "4x4",
    section: "birthdays",
    sectionLabel: "Birthdays",
    sortOrder: 46,
  },
  {
    key: "birthday_4",
    prompt: "4th Birthday",
    size: "4x4",
    section: "birthdays",
    sectionLabel: "Birthdays",
    sortOrder: 47,
  },
  {
    key: "birthday_5",
    prompt: "5th Birthday",
    size: "4x4",
    section: "birthdays",
    sectionLabel: "Birthdays",
    sortOrder: 48,
  },

  // ── First Day of School (1 photo, 4x4) — after birthdays, matching book order ──
  {
    key: "first_day_of_school",
    prompt: "First Day of School",
    size: "4x4",
    section: "school",
    sectionLabel: "First Day of School",
    sortOrder: 49,
    dateField: true,
  },
];

/**
 * Book themes. A theme's `product` decides its photo slots — every memory
 * book theme shares PHOTO_SLOTS, only the illustrations differ.
 */
export const BOOK_THEMES = [
  // Darling Memory Books (standard)
  { id: "little_artist", name: "Little Artist", sku: "BB001MEM", tier: "standard", product: "memory_book" },
  { id: "little_animal_lover", name: "Little Animal Lover", sku: "BB002MEM", tier: "standard", product: "memory_book" },
  { id: "little_captain", name: "Little Captain", sku: "BB004MEM", tier: "standard", product: "memory_book" },
  { id: "little_camper", name: "Little Camper", sku: "BB007MEM", tier: "standard", product: "memory_book" },
  { id: "little_beach_babe", name: "Little Beach Babe", sku: "BB008MEM", tier: "standard", product: "memory_book" },
  { id: "little_rainbow", name: "Little Rainbow", sku: "BB010MEM", tier: "standard", product: "memory_book" },
  { id: "flower_child", name: "Flower Child", sku: "BB011MEM", tier: "standard", product: "memory_book" },
  { id: "little_farmer", name: "Little Farmer", sku: "BB016MEM", tier: "standard", product: "memory_book" },
  { id: "little_goose", name: "Little Goose", sku: "BB017MEM", tier: "standard", product: "memory_book" },
  { id: "cottage_garden", name: "Cottage Garden", sku: "BB018MEM", tier: "standard", product: "memory_book" },
  { id: "bowkissed_blush", name: "Bowkissed Blush", sku: "BB019MEM", tier: "standard", product: "memory_book" },
  { id: "my_first_rodeo", name: "My First Rodeo", sku: "BB020MEM", tier: "standard", product: "memory_book" },
  // Luxury Memory Books (gold embossed fabric covers)
  { id: "honey_bee", name: "Honey Bee", sku: "BB012MEM", tier: "luxury", product: "memory_book" },
  { id: "teddy_bears_picnic", name: "Teddy Bear's Picnic", sku: "BB013MEM", tier: "luxury", product: "memory_book" },
  { id: "celestial_skies", name: "Celestial Skies", sku: "BB014MEM", tier: "luxury", product: "memory_book" },
  { id: "wildflower_meadow", name: "Wildflower Meadow", sku: "BB015MEM", tier: "luxury", product: "memory_book" },
  // Retiring — still available while supplies last
  { id: "golden_blossom", name: "Golden Blossom", sku: "BB021MEM", tier: "retiring", product: "memory_book" },
  { id: "golden_stargazer", name: "Golden Stargazer", sku: "BB022MEM", tier: "retiring", product: "memory_book" },
  // Love Grows Pregnancy Journal — hidden behind the preview gate (lib/preview-gate.ts)
  { id: "love_grows_desert_sand", name: "Love Grows Pregnancy Journal (Desert Sand)", sku: "PJ001PRE", tier: "journal", product: "pregnancy_journal" },
  { id: "love_grows_moss_green", name: "Love Grows Pregnancy Journal (Moss Green)", sku: "PJ002PRE", tier: "journal", product: "pregnancy_journal" },
] as const;

export type BookThemeId = (typeof BOOK_THEMES)[number]["id"];

export type BookTheme = (typeof BOOK_THEMES)[number];

/** Regions for each product. Memory books have none. */
export const REGIONS_BY_PRODUCT: Record<ProductType, PhotoRegion[]> = {
  memory_book: [],
  pregnancy_journal: JOURNAL_ITEMS.filter(isRegion),
  little_years: [],
};

/** Photo slots for each product, in book order (region photos expanded). */
export const SLOTS_BY_PRODUCT: Record<ProductType, PhotoSlot[]> = {
  memory_book: PHOTO_SLOTS,
  pregnancy_journal: JOURNAL_ITEMS.flatMap((item) =>
    isRegion(item) ? expandRegion(item) : [item]
  ),
  little_years: LITTLE_YEARS_SLOTS,
};

/** What a product is called, and what its progress bar counts. */
export const PRODUCTS: Record<ProductType, { name: string; progressUnit: string }> = {
  memory_book: { name: "Memory Book", progressUnit: "photos" },
  // DRAFT copy — pending Haily.
  pregnancy_journal: { name: "Love Grows Pregnancy Journal", progressUnit: "photo spots" },
  little_years: { name: "The Little Years", progressUnit: "photos" },
};

function isRegion(item: PhotoSlot | PhotoRegion): item is PhotoRegion {
  return "layouts" in item;
}

export function getTheme(themeId: string | null | undefined): BookTheme | undefined {
  return BOOK_THEMES.find((t) => t.id === themeId);
}

/** The product a theme belongs to, or null for an unknown theme id. */
export function getProductForTheme(
  themeId: string | null | undefined
): ProductType | null {
  return getTheme(themeId)?.product ?? null;
}

/**
 * The photo slots for a theme's book. An unknown or missing theme gets the
 * memory book's slots, which is what every session had before books other
 * than memory books existed.
 */
export function getSlots(themeId: string | null | undefined): PhotoSlot[] {
  return SLOTS_BY_PRODUCT[getProductForTheme(themeId) ?? "memory_book"];
}

export function getRegions(themeId: string | null | undefined): PhotoRegion[] {
  return REGIONS_BY_PRODUCT[getProductForTheme(themeId) ?? "memory_book"];
}

export function getRegion(
  themeId: string | null | undefined,
  regionKey: string
): PhotoRegion | undefined {
  return getRegions(themeId).find((r) => r.key === regionKey);
}

/**
 * The layout and orientation a region is using: the customer's choice when
 * it's still valid, otherwise the region's default (first layout, first
 * orientation that fits).
 */
export function resolveRegionChoice(
  region: PhotoRegion,
  choice: RegionChoice | undefined
): { layout: RegionLayout; orientation: PrintOrientation } {
  const layout =
    region.layouts.find((l) => l.id === choice?.layoutId) ?? region.layouts[0];
  const orientation =
    choice && layout.orientations.includes(choice.orientation)
      ? choice.orientation
      : layout.orientations[0];
  return { layout, orientation };
}

/**
 * The slots the customer is actually filling: every book slot, plus the
 * region photos the chosen layouts use, each carrying the size and
 * orientation it will print at. For a memory book this is PHOTO_SLOTS,
 * untouched.
 */
export function getBookSlots(
  themeId: string | null | undefined,
  regionChoices: Record<string, RegionChoice> = {}
): PhotoSlot[] {
  const regions = getRegions(themeId);
  const slots = getSlots(themeId);
  if (regions.length === 0) return slots;

  const byKey = new Map(regions.map((r) => [r.key, r]));
  const out: PhotoSlot[] = [];
  for (const slot of slots) {
    const region = slot.region ? byKey.get(slot.region) : undefined;
    if (!region) {
      out.push(slot);
      continue;
    }
    const { layout, orientation } = resolveRegionChoice(region, regionChoices[region.key]);
    if ((slot.regionIndex ?? 1) > layout.count) continue;
    out.push({
      ...slot,
      size: layout.size,
      orientation: isSquarePrintSize(layout.size) ? undefined : orientation,
    });
  }
  return out;
}

/**
 * Progress for the progress bar: each book slot counts once, and each
 * region counts once — done when any photo in it has been added.
 */
export function getBookProgress(
  themeId: string | null | undefined,
  photos: Record<string, { status: string } | undefined>,
  regionChoices: Record<string, RegionChoice> = {}
): { done: number; total: number } {
  const filled = (key: string) => {
    const p = photos[key];
    return Boolean(p && (p.status === "cropped" || p.status === "uploaded"));
  };
  const slots = getBookSlots(themeId, regionChoices);
  const plain = slots.filter((s) => !s.region);
  const regionKeys = new Set(slots.filter((s) => s.region).map((s) => s.region!));
  const regionsDone = [...regionKeys].filter((rk) =>
    slots.some((s) => s.region === rk && filled(s.key))
  ).length;
  return {
    done: plain.filter((s) => filled(s.key)).length + regionsDone,
    total: plain.length + regionKeys.size,
  };
}

/**
 * Read a stored print size back — `session_photos.print_size` holds the size
 * as the print reads ("3x4", "6x4", "3.5x3.5"), which for a region photo is
 * also how its orientation is remembered.
 */
export function parsePrintLabel(
  label: string | null | undefined
): { size: PrintSize; orientation?: PrintOrientation } | null {
  if (!label) return null;
  for (const size of ALL_PRINT_SIZES) {
    if (isSquarePrintSize(size)) {
      if (getPrintSizeLabel(size) === label) return { size };
      continue;
    }
    for (const orientation of ["portrait", "landscape"] as const) {
      if (getPrintSizeLabel(size, orientation) === label) return { size, orientation };
    }
  }
  return null;
}

/** The region choice a stored print size implies, if it matches one of the region's layouts. */
export function choiceFromPrintLabel(
  region: PhotoRegion,
  label: string | null | undefined
): RegionChoice | null {
  const parsed = parsePrintLabel(label);
  if (!parsed) return null;
  const layout = region.layouts.find((l) => l.size === parsed.size);
  if (!layout) return null;
  const orientation = parsed.orientation ?? "portrait";
  if (!isSquarePrintSize(layout.size) && !layout.orientations.includes(orientation)) return null;
  return { layoutId: layout.id, orientation: isSquarePrintSize(layout.size) ? layout.orientations[0] : orientation };
}

/** Group a theme's photo slots by section for the dashboard */
export function getSlotsBySection(themeId: string | null | undefined): {
  section: string;
  label: string;
  slots: PhotoSlot[];
}[] {
  const sections: Map<string, { label: string; slots: PhotoSlot[] }> =
    new Map();

  for (const slot of getSlots(themeId)) {
    if (!sections.has(slot.section)) {
      sections.set(slot.section, { label: slot.sectionLabel, slots: [] });
    }
    sections.get(slot.section)!.slots.push(slot);
  }

  return Array.from(sections.entries()).map(([section, data]) => ({
    section,
    ...data,
  }));
}
