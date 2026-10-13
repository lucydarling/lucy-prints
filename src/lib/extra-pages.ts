import { LITTLE_YEARS_SLOTS } from "@/lib/little-years-slots";
import type { PhotoSlot, PrintSize } from "@/lib/photo-slots";

/**
 * The Little Years' optional "extra pages": each age has 6 blank journaling
 * pages, and four 4x4 prints fit a page (the Snapshots 2x2), so a parent can
 * add up to 24 photos per age. They're extra prints underneath: stored in
 * session_extras like any other extra, but tagged with their age through the
 * id (`extra_pg_a1_<time>_<random>`), so no column is needed for it. They
 * never count toward the book's 146.
 */

export const EXTRA_PAGES_PER_AGE = 24;
export const EXTRA_PAGE_SIZE: PrintSize = "4x4";

export interface LittleYearsAge {
  /** "a1".."a5", as in the slot keys (`ly_a1_…`). */
  age: string;
  /** "Age One".."Age Five", the heading on /upload. */
  label: string;
  slots: PhotoSlot[];
  /** The age's last slot number (its last Snapshot), for ZIP ordering. */
  lastSortOrder: number;
}

/** The book's five ages, in order, read from the slot data. */
export const LITTLE_YEARS_AGES: LittleYearsAge[] = (() => {
  const ages: LittleYearsAge[] = [];
  for (const slot of LITTLE_YEARS_SLOTS) {
    const age = slot.key.match(/^ly_(a\d)_/)?.[1];
    if (!age || !slot.group) continue;
    let entry = ages.find((a) => a.age === age);
    if (!entry) {
      entry = { age, label: slot.group, slots: [], lastSortOrder: 0 };
      ages.push(entry);
    }
    entry.slots.push(slot);
    entry.lastSortOrder = Math.max(entry.lastSortOrder, slot.sortOrder);
  }
  return ages;
})();

export function getAgeByLabel(label: string | undefined): LittleYearsAge | undefined {
  return LITTLE_YEARS_AGES.find((a) => a.label === label);
}

export function newExtraPageId(age: string): string {
  return `extra_pg_${age}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

/** The age an extra-page id belongs to ("a1"…), or null for any other extra. */
export function extraPageAge(id: string): string | null {
  return id.match(/^extra_pg_(a\d)_/)?.[1] ?? null;
}

export function isExtraPage(extra: { id: string }): boolean {
  return extraPageAge(extra.id) !== null;
}

/** An age's extra pages, in the order they were added. */
export function extraPagesFor<T extends { id: string }>(extras: T[], age: string): T[] {
  return extras.filter((e) => extraPageAge(e.id) === age);
}

/** True once every one of the age's slots has a crop. */
export function isAgeFull(
  photos: Record<string, { croppedUrl: string | null } | undefined>,
  age: LittleYearsAge
): boolean {
  return age.slots.every((s) => photos[s.key]?.croppedUrl);
}

// ── "Age One is full" reminder: once per age per browser ──

const reminderKey = (themeId: string, age: string) => `ld_extra_pages_reminder_${themeId}_${age}`;

/** Null when storage can't be read (then the reminder isn't shown). */
export function reminderShown(themeId: string, age: string): boolean | null {
  try {
    return localStorage.getItem(reminderKey(themeId, age)) === "1";
  } catch {
    return null;
  }
}

/** Records the reminder as shown. False (and the caller must not show it) if that can't be stored. */
export function recordReminderShown(themeId: string, age: string): boolean {
  try {
    localStorage.setItem(reminderKey(themeId, age), "1");
    return true;
  } catch {
    return false;
  }
}
