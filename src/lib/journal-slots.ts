import type {
  PhotoRegion,
  PhotoSlot,
  PrintOrientation,
  PrintSize,
  RegionLayout,
} from "@/lib/photo-slots";

// Type-only imports: photo-slots.ts imports this file's data, so importing
// values back from it would be a cycle.

/** A layout id like "2x3x3" — count, then the size. */
function layout(
  count: number,
  size: PrintSize,
  orientations: PrintOrientation[] = ["portrait"]
): RegionLayout {
  return { id: `${count}x${size}`, count, size, orientations };
}

const L = ["landscape"] as PrintOrientation[];
const P = ["portrait"] as PrintOrientation[];
const EITHER = ["portrait", "landscape"] as PrintOrientation[];

// Layouts for each page come from the measured clear photo area on the print
// files (Love_grows_book_Page N_CMYK.pdf, inside the 8.5" TrimBox, at least
// 0.375" from the trim), checked so every print in a layout fits with 0.25"
// between them, all the same way up. Measured 2026-10-02:
//   p1 6.4×3.9 · p3 6.6×3.8 · p4 6.0×4.3 · p5 7.7×3.9 · p6 5.3×4.3 · p7 5.2×4.5
//   p8 5.5×3.6 · p9 5.5×4.5 · p10 5.3×4.3 · p11 6.3×4.5 · p16–18 7.0×6.8
//   p21 7.1×5.2 · p22 6.5×6.9 · p27 7.7×7.0 · p28 7.0×5.7 · p30 7.7×6.8
// The printed boxes on p19 (×3) and p26 (×2) are 3.5" squares.
/** Measured clear photo area per page, inches (width × height). Used by the fit test. */
export const JOURNAL_PAGE_AREAS: Record<number, { width: number; height: number }> = {
  1: { width: 6.4, height: 3.9 },
  3: { width: 6.6, height: 3.8 },
  4: { width: 6.0, height: 4.3 },
  5: { width: 7.7, height: 3.9 },
  6: { width: 5.3, height: 4.3 },
  7: { width: 5.2, height: 4.5 },
  8: { width: 5.5, height: 3.6 },
  9: { width: 5.5, height: 4.5 },
  10: { width: 5.3, height: 4.3 },
  11: { width: 6.3, height: 4.5 },
  16: { width: 7.0, height: 6.8 },
  17: { width: 7.0, height: 6.8 },
  18: { width: 7.0, height: 6.8 },
  21: { width: 7.1, height: 5.2 },
  22: { width: 6.5, height: 6.9 },
  27: { width: 7.7, height: 7.0 },
  28: { width: 7.0, height: 5.7 },
  30: { width: 7.7, height: 6.8 },
};

const ONE_PHOTO_PAGE = [layout(1, "4x4"), layout(1, "4x3", EITHER), layout(1, "3x3")];
const SHOWER_PAGE = [
  layout(4, "3x3"),
  layout(2, "4x3", EITHER),
  layout(1, "4x4"),
  layout(1, "4x6", EITHER),
];

function region(
  key: string,
  page: number,
  prompt: string,
  section: string,
  sectionLabel: string,
  layouts: RegionLayout[],
  guidance?: string
): PhotoRegion {
  return { key, prompt, page, section, sectionLabel, sortOrder: page * 10, layouts, guidance };
}

function slot(
  key: string,
  page: number,
  order: number,
  prompt: string,
  size: PrintSize,
  section: string,
  sectionLabel: string
): PhotoSlot {
  return { key, prompt, size, section, sectionLabel, sortOrder: page * 10 + order, page };
}

/**
 * Love Grows Pregnancy Journal (PJ001PRE Desert Sand, PJ002PRE Moss Green),
 * in book order. Prompts and section names are the book's own headings.
 * Pages 2, 13–15, 20, 23–25, 29 and 31–36 have no photo spaces.
 */
export const JOURNAL_ITEMS: (PhotoSlot | PhotoRegion)[] = [
  region("pj_big_news", 1, "Sharing the Big News", "finding_out", "Finding Out", [
    layout(2, "3x3"),
    layout(1, "4x3", L),
  ]),

  region("pj_first_ultrasound", 3, "The First Ultrasound", "first_trimester", "The First Trimester", [
    layout(2, "3x3"),
    layout(1, "4x3", L),
  ]),
  region("pj_month_1_2", 4, "Month 1+2", "first_trimester", "The First Trimester", [
    ...ONE_PHOTO_PAGE,
    layout(1, "4x6", L),
  ]),
  region("pj_month_3", 5, "Month 3", "first_trimester", "The First Trimester", [
    layout(1, "4x3", L),
    layout(2, "3x3"),
  ]),

  region("pj_month_4", 6, "Month 4", "second_trimester", "The Second Trimester", ONE_PHOTO_PAGE),
  region(
    "pj_month_5",
    7,
    "Month 5",
    "second_trimester",
    "The Second Trimester",
    ONE_PHOTO_PAGE,
    // DRAFT — pending Haily.
    "This page asks for photos + your 20 week ultrasound. Add your photo here, then place the ultrasound printout from your appointment beside it."
  ),
  region("pj_month_6", 8, "Month 6", "second_trimester", "The Second Trimester", [
    layout(1, "4x3", L),
    layout(1, "3x3"),
  ]),

  region("pj_month_7", 9, "Month 7", "third_trimester", "The Third Trimester", ONE_PHOTO_PAGE),
  region("pj_month_8", 10, "Month 8", "third_trimester", "The Third Trimester", ONE_PHOTO_PAGE),
  region("pj_month_9", 11, "Month 9+", "third_trimester", "The Third Trimester", [
    ...ONE_PHOTO_PAGE,
    layout(1, "4x6", L),
  ]),

  slot("pj_nursery", 12, 1, "A photo of your nursery", "3x3", "planning", "Planning for You"),
  slot("pj_little_clothes", 12, 2, "A photo of your little clothes", "3x3", "planning", "Planning for You"),

  region("pj_shower_p16", 16, "Baby shower photos", "baby_shower", "The Baby Shower", SHOWER_PAGE),
  region("pj_shower_p17", 17, "Baby shower photos", "baby_shower", "The Baby Shower", SHOWER_PAGE),
  region("pj_shower_p18", 18, "Baby shower photos", "baby_shower", "The Baby Shower", SHOWER_PAGE),

  slot("pj_babymoon_1", 19, 1, "Babymoon + adventures, photo 1", "3.5x3.5", "babymoon", "Babymoon + Adventures Before You Arrived"),
  slot("pj_babymoon_2", 19, 2, "Babymoon + adventures, photo 2", "3.5x3.5", "babymoon", "Babymoon + Adventures Before You Arrived"),
  slot("pj_babymoon_3", 19, 3, "Babymoon + adventures, photo 3", "3.5x3.5", "babymoon", "Babymoon + Adventures Before You Arrived"),

  region("pj_first_photos", 21, "First photos", "born", "The Day You Were Born", [
    layout(2, "3x3"),
    layout(2, "4x3", P),
    layout(1, "4x4"),
    layout(1, "4x6", L),
  ]),
  region("pj_born_photos", 22, "More photos from the day", "born", "The Day You Were Born", SHOWER_PAGE),

  slot("pj_coming_home_1", 26, 1, "Coming home, photo 1", "3.5x3.5", "coming_home", "Coming Home"),
  slot("pj_coming_home_2", 26, 2, "Coming home, photo 2", "3.5x3.5", "coming_home", "Coming Home"),

  region(
    "pj_birth_announcement",
    27,
    "Birth Announcement",
    "birth_announcement",
    "Birth Announcement",
    [layout(1, "4x6", EITHER)],
    // DRAFT — pending Haily.
    "Add a photo of your birth announcement, or tuck the printed card itself onto this page."
  ),
  region("pj_adjusting", 28, "Adjusting to New Life at Home", "adjusting", "Adjusting to New Life at Home", [
    layout(2, "3x3"),
    layout(2, "4x3", P),
    layout(1, "4x4"),
    layout(1, "4x6", L),
  ]),
  region("pj_sleepy", 30, "Sleepy Baby Photos", "sleepy", "Sleepy Baby Photos", SHOWER_PAGE),
];
