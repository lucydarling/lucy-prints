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

// Layouts for each page come from the measured photo area on the print files
// (Love_grows_book_Page N_CMYK.pdf, inside the 8.5" TrimBox, at least 0.375"
// from the trim), checked so every print in a layout fits with 0.25" between
// them, all the same way up.
//
// RULE (Kevin, 2026-10-13): only PRINTED TEXT (headings, prompts, labels) and
// FILL-IN LINES / boxes must stay uncovered. Illustrations (florals, animals)
// MAY be covered by photos. Do not put the floral constraint back: the
// 2026-10-02 areas avoided the illustrations and were far too small.
// Re-measured 2026-10-13 with PyMuPDF: text ink boxes (+0.05") and fill-in
// lines (+0.04") are blocked, images and vector art are treated as blank.
// The usable area is the union of up to two rectangles per page (it can be
// L-shaped); a layout must fit inside ONE of them. x/y are inches from the
// top-left of the 8.5" trim.
// The printed boxes on p19 (×3) and p26 (×2) are 3.5" squares; p12 slots are 3x3.
export interface JournalArea {
  x: number;
  y: number;
  width: number;
  height: number;
}
/** Usable photo area per page: one or two rectangles, inches. Used by the fit test. */
export const JOURNAL_PAGE_AREAS: Record<number, JournalArea[]> = {
  1: [{ x: 0.375, y: 4.275, width: 7.75, height: 3.85 }, { x: 1.225, y: 3.95, width: 6.9, height: 4.175 }],
  3: [{ x: 0.375, y: 1.15, width: 7.75, height: 3.7 }],
  4: [{ x: 0.375, y: 1.15, width: 7.75, height: 3.95 }, { x: 1.275, y: 1.025, width: 6.85, height: 4.075 }],
  5: [{ x: 0.375, y: 1.2, width: 7.75, height: 4 }],
  6: [{ x: 0.375, y: 1.3, width: 7.75, height: 4.075 }],
  7: [{ x: 0.375, y: 1.1, width: 7.75, height: 4.3 }],
  8: [{ x: 0.375, y: 1.1, width: 7.75, height: 4.3 }],
  9: [{ x: 0.375, y: 1.3, width: 7.75, height: 4.075 }],
  10: [{ x: 0.375, y: 1.1, width: 7.75, height: 4.3 }],
  11: [{ x: 0.375, y: 1.1, width: 7.75, height: 4.3 }],
  16: [{ x: 0.375, y: 0.55, width: 7.75, height: 7.575 }],
  17: [{ x: 0.375, y: 0.55, width: 7.75, height: 7.575 }],
  18: [{ x: 0.375, y: 0.55, width: 7.75, height: 7.575 }],
  21: [{ x: 0.375, y: 2.975, width: 7.75, height: 5.15 }],
  22: [{ x: 0.375, y: 0.55, width: 7.75, height: 7.575 }],
  27: [{ x: 0.375, y: 0.55, width: 7.75, height: 7.575 }],
  28: [{ x: 0.375, y: 0.95, width: 7.75, height: 7.175 }],
  30: [{ x: 0.375, y: 0.675, width: 7.75, height: 7.45 }],
};

const PAGE_LAYOUTS: Record<number, RegionLayout[]> = {
  1: [
    layout(2, "3x3"),
    layout(1, "4x3", EITHER),
    layout(2, "3.5x3.5"),
    layout(2, "4x3"),
    layout(1, "4x4"),
    layout(1, "4x6", L),
  ],
  3: [
    layout(2, "3x3"),
    layout(1, "4x3", L),
    layout(2, "3.5x3.5"),
  ],
  4: [
    layout(1, "4x4"),
    layout(1, "4x3", EITHER),
    layout(1, "3x3"),
    layout(1, "4x6", L),
    layout(1, "3.5x3.5"),
  ],
  5: [
    layout(1, "4x3", EITHER),
    layout(2, "3x3"),
    layout(2, "3.5x3.5"),
    layout(2, "4x3"),
    layout(1, "4x4"),
    layout(1, "4x6", L),
  ],
  6: [
    layout(1, "4x4"),
    layout(1, "4x3", EITHER),
    layout(1, "3x3"),
    layout(1, "3.5x3.5"),
    layout(1, "4x6", L),
  ],
  7: [
    layout(1, "4x4"),
    layout(1, "4x3", EITHER),
    layout(1, "3x3"),
    layout(1, "3.5x3.5"),
    layout(1, "4x6", L),
  ],
  8: [
    layout(1, "4x3", EITHER),
    layout(1, "3x3"),
    layout(1, "3.5x3.5"),
    layout(1, "4x4"),
    layout(1, "4x6", L),
  ],
  9: [
    layout(1, "4x4"),
    layout(1, "4x3", EITHER),
    layout(1, "3x3"),
    layout(1, "3.5x3.5"),
    layout(1, "4x6", L),
  ],
  10: [
    layout(1, "4x4"),
    layout(1, "4x3", EITHER),
    layout(1, "3x3"),
    layout(1, "3.5x3.5"),
    layout(1, "4x6", L),
  ],
  11: [
    layout(1, "4x4"),
    layout(1, "4x3", EITHER),
    layout(1, "3x3"),
    layout(1, "4x6", L),
    layout(1, "3.5x3.5"),
  ],
  16: [
    layout(4, "3x3"),
    layout(2, "4x3", EITHER),
    layout(1, "4x4"),
    layout(1, "4x6", EITHER),
    layout(4, "3.5x3.5"),
  ],
  17: [
    layout(4, "3x3"),
    layout(2, "4x3", EITHER),
    layout(1, "4x4"),
    layout(1, "4x6", EITHER),
    layout(4, "3.5x3.5"),
  ],
  18: [
    layout(4, "3x3"),
    layout(2, "4x3", EITHER),
    layout(1, "4x4"),
    layout(1, "4x6", EITHER),
    layout(4, "3.5x3.5"),
  ],
  21: [
    layout(2, "3x3"),
    layout(2, "4x3"),
    layout(1, "4x4"),
    layout(1, "4x6", L),
    layout(2, "3.5x3.5"),
  ],
  22: [
    layout(4, "3x3"),
    layout(2, "4x3", EITHER),
    layout(1, "4x4"),
    layout(1, "4x6", EITHER),
    layout(4, "3.5x3.5"),
  ],
  27: [
    layout(1, "4x6", EITHER),
    layout(4, "3x3"),
    layout(4, "3.5x3.5"),
    layout(2, "4x3", EITHER),
    layout(1, "4x4"),
  ],
  28: [
    layout(2, "3x3"),
    layout(2, "4x3", EITHER),
    layout(1, "4x4"),
    layout(1, "4x6", EITHER),
    layout(4, "3x3"),
    layout(2, "3.5x3.5"),
  ],
  30: [
    layout(4, "3x3"),
    layout(2, "4x3", EITHER),
    layout(1, "4x4"),
    layout(1, "4x6", EITHER),
    layout(4, "3.5x3.5"),
  ],
};

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
  region("pj_big_news", 1, "Sharing the Big News", "finding_out", "Finding Out", PAGE_LAYOUTS[1]),

  region("pj_first_ultrasound", 3, "The First Ultrasound", "first_trimester", "The First Trimester", PAGE_LAYOUTS[3]),
  region("pj_month_1_2", 4, "Month 1+2", "first_trimester", "The First Trimester", PAGE_LAYOUTS[4]),
  region("pj_month_3", 5, "Month 3", "first_trimester", "The First Trimester", PAGE_LAYOUTS[5]),

  region("pj_month_4", 6, "Month 4", "second_trimester", "The Second Trimester", PAGE_LAYOUTS[6]),
  region(
    "pj_month_5",
    7,
    "Month 5",
    "second_trimester",
    "The Second Trimester",
    PAGE_LAYOUTS[7],
    // DRAFT — pending Haily.
    "This page asks for photos + your 20 week ultrasound. Add your photo here, then place the ultrasound printout from your appointment beside it."
  ),
  region("pj_month_6", 8, "Month 6", "second_trimester", "The Second Trimester", PAGE_LAYOUTS[8]),

  region("pj_month_7", 9, "Month 7", "third_trimester", "The Third Trimester", PAGE_LAYOUTS[9]),
  region("pj_month_8", 10, "Month 8", "third_trimester", "The Third Trimester", PAGE_LAYOUTS[10]),
  region("pj_month_9", 11, "Month 9+", "third_trimester", "The Third Trimester", PAGE_LAYOUTS[11]),

  slot("pj_nursery", 12, 1, "A photo of your nursery", "3x3", "planning", "Planning for You"),
  slot("pj_little_clothes", 12, 2, "A photo of your little clothes", "3x3", "planning", "Planning for You"),

  region("pj_shower_p16", 16, "Baby shower photos", "baby_shower", "The Baby Shower", PAGE_LAYOUTS[16]),
  region("pj_shower_p17", 17, "Baby shower photos", "baby_shower", "The Baby Shower", PAGE_LAYOUTS[17]),
  region("pj_shower_p18", 18, "Baby shower photos", "baby_shower", "The Baby Shower", PAGE_LAYOUTS[18]),

  slot("pj_babymoon_1", 19, 1, "Babymoon + adventures, photo 1", "3.5x3.5", "babymoon", "Babymoon + Adventures Before You Arrived"),
  slot("pj_babymoon_2", 19, 2, "Babymoon + adventures, photo 2", "3.5x3.5", "babymoon", "Babymoon + Adventures Before You Arrived"),
  slot("pj_babymoon_3", 19, 3, "Babymoon + adventures, photo 3", "3.5x3.5", "babymoon", "Babymoon + Adventures Before You Arrived"),

  region("pj_first_photos", 21, "First photos", "born", "The Day You Were Born", PAGE_LAYOUTS[21]),
  region("pj_born_photos", 22, "More photos from the day", "born", "The Day You Were Born", PAGE_LAYOUTS[22]),

  slot("pj_coming_home_1", 26, 1, "Coming home, photo 1", "3.5x3.5", "coming_home", "Coming Home"),
  slot("pj_coming_home_2", 26, 2, "Coming home, photo 2", "3.5x3.5", "coming_home", "Coming Home"),

  region(
    "pj_birth_announcement",
    27,
    "Birth Announcement",
    "birth_announcement",
    "Birth Announcement",
    PAGE_LAYOUTS[27],
    // DRAFT — pending Haily.
    "Add a photo of your birth announcement, or tuck the printed card itself onto this page."
  ),
  region("pj_adjusting", 28, "Adjusting to New Life at Home", "adjusting", "Adjusting to New Life at Home", PAGE_LAYOUTS[28]),
  region("pj_sleepy", 30, "Sleepy Baby Photos", "sleepy", "Sleepy Baby Photos", PAGE_LAYOUTS[30]),
];
