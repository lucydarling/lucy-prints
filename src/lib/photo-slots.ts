export type PrintSize = "3x3" | "4x3" | "4x4" | "4x6";

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
}

/**
 * All 48 required photo slots in a Lucy Darling memory book.
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

  // ── Before Baby (2 photos, 4x4) ──
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
    size: "4x4",
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

  // ── First Holidays (2 photos, 4x4) ──
  {
    key: "first_holiday_1",
    prompt: "First Holiday #1",
    size: "4x4",
    section: "holidays",
    sectionLabel: "First Holidays",
    sortOrder: 32,
    customLabel: true,
  },
  {
    key: "first_holiday_2",
    prompt: "First Holiday #2",
    size: "4x4",
    section: "holidays",
    sectionLabel: "First Holidays",
    sortOrder: 33,
    customLabel: true,
  },

  // ── My Firsts (9 photos, 3x3 — customer labels them, part of First Holidays) ──
  ...Array.from({ length: 9 }, (_, i) => ({
    key: `my_first_${i + 1}`,
    prompt: `My First ___`,
    size: "3x3" as PrintSize,
    section: "holidays",
    sectionLabel: "First Holidays",
    sortOrder: 34 + i,
    customLabel: true,
  })),

  // ── First Day of School (1 photo, 4x4) ──
  {
    key: "first_day_of_school",
    prompt: "First Day of School",
    size: "4x4",
    section: "school",
    sectionLabel: "First Day of School",
    sortOrder: 43,
    dateField: true,
  },

  // ── Birthdays (5 photos, 4x4) ──
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
];

/** Book themes — all share the same PHOTO_SLOTS layout */
export const BOOK_THEMES = [
  // Darling Memory Books (standard)
  { id: "little_artist", name: "Little Artist", sku: "BB001MEM", tier: "standard" },
  { id: "little_animal_lover", name: "Little Animal Lover", sku: "BB002MEM", tier: "standard" },
  { id: "little_captain", name: "Little Captain", sku: "BB004MEM", tier: "standard" },
  { id: "little_camper", name: "Little Camper", sku: "BB007MEM", tier: "standard" },
  { id: "little_beach_babe", name: "Little Beach Babe", sku: "BB008MEM", tier: "standard" },
  { id: "little_rainbow", name: "Little Rainbow", sku: "BB010MEM", tier: "standard" },
  { id: "flower_child", name: "Flower Child", sku: "BB011MEM", tier: "standard" },
  { id: "little_farmer", name: "Little Farmer", sku: "BB016MEM", tier: "standard" },
  { id: "little_goose", name: "Little Goose", sku: "BB017MEM", tier: "standard" },
  { id: "cottage_garden", name: "Cottage Garden", sku: "BB018MEM", tier: "standard" },
  { id: "bowkissed_blush", name: "Bowkissed Blush", sku: "BB019MEM", tier: "standard" },
  { id: "my_first_rodeo", name: "My First Rodeo", sku: "BB020MEM", tier: "standard" },
  // Luxury Memory Books (gold embossed fabric covers)
  { id: "honey_bee", name: "Honey Bee", sku: "BB012MEM", tier: "luxury" },
  { id: "teddy_bears_picnic", name: "Teddy Bear's Picnic", sku: "BB013MEM", tier: "luxury" },
  { id: "celestial_skies", name: "Celestial Skies", sku: "BB014MEM", tier: "luxury" },
  { id: "wildflower_meadow", name: "Wildflower Meadow", sku: "BB015MEM", tier: "luxury" },
] as const;

export type BookThemeId = (typeof BOOK_THEMES)[number]["id"];

/** Group photo slots by section for the dashboard */
export function getSlotsBySection(): {
  section: string;
  label: string;
  slots: PhotoSlot[];
}[] {
  const sections: Map<string, { label: string; slots: PhotoSlot[] }> =
    new Map();

  for (const slot of PHOTO_SLOTS) {
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
