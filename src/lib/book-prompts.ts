import { getProductForTheme, type ProductType } from "@/lib/photo-slots";
import { LITTLE_YEARS_GIRL_PROMPTS, LITTLE_YEARS_PROMPTS } from "@/lib/little-years-prompts";

/**
 * All text prompts from the Lucy Darling memory book.
 * These are the fill-in-the-blank fields across ~49 book pages.
 * Used by the "Book Details" mode to help moms capture info digitally.
 */

export interface BookPrompt {
  key: string;
  label: string;
  type: "short" | "long";
  placeholder?: string;
}

export interface SlotPrompts {
  /** Maps to a PHOTO_SLOTS key, or a standalone section key */
  slotKey: string;
  /** Which section this belongs to (matches PHOTO_SLOTS section or standalone) */
  section: string;
  /** Text prompts for this slot */
  prompts: BookPrompt[];
  /** True = no photo, this is a detail-only card */
  standalone?: boolean;
  /** Display label for standalone cards */
  standaloneLabel?: string;
  /** Hint text shown below the label */
  standaloneHint?: string;
  /** Path to a static resource image (e.g. Family Tree example) */
  resourceImage?: string;
  /**
   * Standalone cards are inserted after this photo section.
   * Only used for standalone entries.
   */
  afterSection?: string;
  /**
   * Repeatable entry (e.g. quotes): `prompts` make up one item, which the
   * parent can add up to `repeat` times. Each item's note keys are
   * `<promptKey>_<n>`, n from 1.
   */
  repeat?: number;
}

// ── Prompts for photo-attached slots ──

const ULTRASOUND_PROMPTS: BookPrompt[] = [
  { key: "due_date", label: "Due date", type: "short", placeholder: "e.g. March 15, 2024" },
  { key: "weeks", label: "Weeks", type: "short", placeholder: "e.g. 20 weeks" },
  { key: "who_told_first", label: "Who we told first", type: "short", placeholder: "e.g. Grandma & Grandpa" },
  { key: "pregnancy_cravings", label: "Pregnancy cravings", type: "short", placeholder: "e.g. Pickles and ice cream" },
];

const BIRTH_ARRIVAL_PROMPTS: BookPrompt[] = [
  { key: "birth_date", label: "Date", type: "short", placeholder: "e.g. June 1, 2024" },
  { key: "birth_time", label: "Time", type: "short", placeholder: "e.g. 3:42 AM" },
  { key: "birth_weight", label: "Weight", type: "short", placeholder: "e.g. 7 lbs 4 oz" },
  { key: "birth_length", label: "Length", type: "short", placeholder: "e.g. 20 inches" },
  { key: "birth_eyes", label: "Eyes", type: "short", placeholder: "e.g. Blue" },
  { key: "birth_hair", label: "Hair", type: "short", placeholder: "e.g. Dark brown peach fuzz" },
  { key: "birth_hospital", label: "Hospital / Place", type: "short", placeholder: "e.g. St. Mary's Hospital" },
  { key: "birth_delivered_by", label: "Who delivered", type: "short", placeholder: "e.g. Dr. Johnson" },
];

const OUR_HOME_PROMPTS: BookPrompt[] = [
  { key: "address", label: "Address", type: "short", placeholder: "e.g. 123 Maple St, Austin, TX" },
];

const MONTHLY_PROMPT_TEMPLATES: Omit<BookPrompt, "key">[] = [
  { label: "We'll never forget", type: "short", placeholder: "A special memory from this month..." },
  { label: "You love", type: "short", placeholder: "e.g. Bath time, peek-a-boo" },
  { label: "You can", type: "short", placeholder: "e.g. Roll over, grab your toes" },
  { label: "You don't like", type: "short", placeholder: "e.g. Getting dressed, loud noises" },
];

const BIRTHDAY_PROMPT_TEMPLATES: Omit<BookPrompt, "key">[] = [
  { label: "Who was there", type: "short", placeholder: "e.g. Grandma, Uncle Joe, cousins" },
  { label: "Theme", type: "short", placeholder: "e.g. Safari animals" },
  { label: "You loved", type: "short", placeholder: "e.g. Eating the cake with your hands" },
  { label: "Your cake", type: "short", placeholder: "e.g. Rainbow layered cake from Sweet Treats" },
];

const SCHOOL_PROMPTS: BookPrompt[] = [
  { key: "teacher", label: "Your Teacher", type: "short", placeholder: "e.g. Mrs. Thompson" },
];

// ── Standalone sections (no photo) ──

const LETTER_TO_BABY_PROMPTS: BookPrompt[] = [
  {
    key: "letter",
    label: "Your letter",
    type: "long",
    placeholder: "Dear baby, before you arrived...",
  },
];

const TIME_CAPSULE_PROMPTS: BookPrompt[] = [
  { key: "bread_cost", label: "A loaf of bread cost", type: "short", placeholder: "e.g. $3.50" },
  { key: "fuel_cost", label: "A gallon of fuel cost", type: "short", placeholder: "e.g. $3.25" },
  { key: "popular_song", label: "A popular song was", type: "short", placeholder: "e.g. Flowers — Miley Cyrus" },
  { key: "nations_leader", label: "Our nation's leader was", type: "short", placeholder: "e.g. Joe Biden" },
];

const FAVORITE_THINGS_PROMPTS: BookPrompt[] = [
  { key: "fav_song", label: "Song", type: "short", placeholder: "e.g. Baby Shark" },
  { key: "fav_cartoon", label: "Cartoon", type: "short", placeholder: "e.g. Bluey" },
  { key: "fav_color", label: "Color", type: "short", placeholder: "e.g. Yellow" },
  { key: "fav_sound", label: "Sound", type: "short", placeholder: "e.g. Daddy's voice" },
  { key: "fav_friends", label: "Friends", type: "short", placeholder: "e.g. Emma, Liam" },
  { key: "fav_foods", label: "Foods", type: "short", placeholder: "e.g. Avocado, bananas" },
  { key: "fav_game", label: "Game", type: "short", placeholder: "e.g. Peek-a-boo" },
  { key: "fav_toys", label: "Toys", type: "short", placeholder: "e.g. Stuffed bunny, stacking rings" },
  { key: "fav_book", label: "Book", type: "short", placeholder: "e.g. Goodnight Moon" },
];

// ── Build the full catalog ──

export const BOOK_PROMPTS: SlotPrompts[] = [
  // Photo-attached: Before Baby
  {
    slotKey: "ultrasound",
    section: "before_baby",
    prompts: ULTRASOUND_PROMPTS,
  },

  // Standalone: Letter to Baby (appears after Before Baby section)
  {
    slotKey: "letter_to_baby",
    section: "before_baby",
    prompts: LETTER_TO_BABY_PROMPTS,
    standalone: true,
    standaloneLabel: "A Letter to Baby",
    standaloneHint: "Write a letter to your baby — something for them to read someday.",
    afterSection: "before_baby",
  },

  // Photo-attached: Baby's Arrival
  {
    slotKey: "birth_arrival",
    section: "arrival",
    prompts: BIRTH_ARRIVAL_PROMPTS,
  },

  // Photo-attached: Our Home
  {
    slotKey: "our_home",
    section: "home",
    prompts: OUR_HOME_PROMPTS,
  },

  // Standalone: Time Capsule (appears after Our Home section)
  {
    slotKey: "time_capsule",
    section: "time_capsule",
    prompts: TIME_CAPSULE_PROMPTS,
    standalone: true,
    standaloneLabel: "When You Were Born...",
    standaloneHint: "A little time capsule of the world when your baby arrived.",
    afterSection: "home",
  },

  // Photo-attached: Monthly Milestones (12 months × 4 prompts each)
  ...Array.from({ length: 12 }, (_, i) => ({
    slotKey: `month_${i + 1}`,
    section: "monthly_milestones",
    prompts: MONTHLY_PROMPT_TEMPLATES.map((t) => ({
      ...t,
      key: `month_${i + 1}_${t.label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/_+$/, "")}`,
    })),
  })),

  // Standalone: Favorite Things (appears after Monthly Milestones section)
  {
    slotKey: "favorite_things",
    section: "favorite_things",
    prompts: FAVORITE_THINGS_PROMPTS,
    standalone: true,
    standaloneLabel: "These Were a Few of Your Favorite Things",
    standaloneHint: "From your first year — all the little things you loved.",
    afterSection: "monthly_milestones",
  },

  // Standalone: Family Tree — resource image only, no form fields
  {
    slotKey: "family_tree",
    section: "family_tree",
    prompts: [],
    standalone: true,
    standaloneLabel: "Your Family Tree",
    standaloneHint:
      "Your book includes a family tree page — here\u2019s an example for how you might fill it out.",
    resourceImage: "/family-tree-example.svg",
    afterSection: "monthly_milestones",
  },

  // Photo-attached: Birthdays 1–5 (each × 4 prompts)
  ...Array.from({ length: 5 }, (_, i) => ({
    slotKey: `birthday_${i + 1}`,
    section: "birthdays",
    prompts: BIRTHDAY_PROMPT_TEMPLATES.map((t) => ({
      ...t,
      key: `birthday_${i + 1}_${t.label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/_+$/, "")}`,
    })),
  })),

  // Photo-attached: First Day of School
  {
    slotKey: "first_day_of_school",
    section: "school",
    prompts: SCHOOL_PROMPTS,
  },
];

/** Text prompts for each product. The pregnancy journal has no Book Details mode. */
export const PROMPTS_BY_PRODUCT: Record<ProductType, SlotPrompts[]> = {
  memory_book: BOOK_PROMPTS,
  pregnancy_journal: [],
  little_years: LITTLE_YEARS_PROMPTS,
};

/** Themes whose printed book words a prompt differently from the rest of its product. */
const PROMPTS_BY_THEME: Record<string, SlotPrompts[]> = {
  little_years_girl: LITTLE_YEARS_GIRL_PROMPTS,
};

/** A theme's prompts, in book order. Unknown themes get the memory book's. */
export function getBookPrompts(themeId: string | null | undefined): SlotPrompts[] {
  return (
    (themeId && PROMPTS_BY_THEME[themeId]) ||
    PROMPTS_BY_PRODUCT[getProductForTheme(themeId) ?? "memory_book"]
  );
}

// ── Lookup helpers ──
// Slot keys and section keys never repeat across products, so without a
// theme the lookups below search every product's prompts at once. Pass the
// open theme wherever its wording can differ (The Little Years Girl).

const ALL_PROMPTS: SlotPrompts[] = Object.values(PROMPTS_BY_PRODUCT).flat();

/** Map from slotKey → SlotPrompts for quick lookup */
const _promptsBySlot = new Map<string, SlotPrompts>();
for (const sp of ALL_PROMPTS) {
  _promptsBySlot.set(sp.slotKey, sp);
}

/** Get prompts for a specific photo slot key */
export function getPromptsForSlot(
  slotKey: string,
  themeId?: string | null
): SlotPrompts | undefined {
  if (themeId) return getBookPrompts(themeId).find((sp) => sp.slotKey === slotKey);
  return _promptsBySlot.get(slotKey);
}

/** Get all standalone entries that should appear after a given photo section */
export function getStandaloneAfterSection(
  sectionKey: string,
  themeId?: string | null
): SlotPrompts[] {
  return (themeId ? getBookPrompts(themeId) : ALL_PROMPTS).filter(
    (sp) => sp.standalone && sp.afterSection === sectionKey
  );
}

/** Get all standalone entries */
export function getAllStandalone(): SlotPrompts[] {
  return ALL_PROMPTS.filter((sp) => sp.standalone);
}

/** Count how many prompts are filled for a given slot */
export function countFilledPrompts(
  slotKey: string,
  notes: Record<string, Record<string, string>>,
  themeId?: string | null
): { filled: number; total: number } {
  const sp = getPromptsForSlot(slotKey, themeId);
  if (!sp) return { filled: 0, total: 0 };
  const slotNotes = notes[slotKey] || {};
  if (sp.repeat) {
    // A repeatable entry has no fixed total: count the items started.
    const started = repeatItemsWithContent(sp, slotNotes).length;
    return { filled: started, total: started };
  }
  const filled = sp.prompts.filter(
    (p) => slotNotes[p.key] && slotNotes[p.key].trim().length > 0
  ).length;
  return { filled, total: sp.prompts.length };
}

/** Count total detail prompts filled across all slots in a section */
export function countSectionDetailProgress(
  sectionKey: string,
  notes: Record<string, Record<string, string>>,
  themeId?: string | null
): { filled: number; total: number } {
  let filled = 0;
  let total = 0;
  for (const sp of themeId ? getBookPrompts(themeId) : ALL_PROMPTS) {
    if (sp.section === sectionKey && sp.prompts.length > 0) {
      const result = countFilledPrompts(sp.slotKey, notes, themeId);
      filled += result.filled;
      total += result.total;
    }
  }
  return { filled, total };
}

/** Note key for one item of a repeatable entry. */
export function repeatNoteKey(promptKey: string, n: number): string {
  return `${promptKey}_${n}`;
}

/** The 1-based item numbers of a repeatable entry that have any text in them. */
export function repeatItemsWithContent(
  sp: SlotPrompts,
  slotNotes: Record<string, string>
): number[] {
  const items: number[] = [];
  for (let n = 1; n <= (sp.repeat ?? 0); n++) {
    if (sp.prompts.some((p) => slotNotes[repeatNoteKey(p.key, n)]?.trim())) items.push(n);
  }
  return items;
}
