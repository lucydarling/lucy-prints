import { getProductForTheme, type PhotoSlot } from "@/lib/photo-slots";
import type { PhotoEntry, ExtraPrint } from "@/store/photo-store";
import type { ReviewSource } from "@/lib/review-links";

/** Cropped-photo counts that trigger ask #1 and ask #2. */
export const REVIEW_THRESHOLD_1 = 10;
export const REVIEW_THRESHOLD_2 = 25;
export const MAX_REVIEW_ASKS = 2;

/** A book's two ask thresholds and the utm_content each ask carries. */
export interface ReviewThresholds {
  first: { at: number; source: ReviewSource };
  second: { at: number; source: ReviewSource };
}

const DEFAULT_THRESHOLDS: ReviewThresholds = {
  first: { at: REVIEW_THRESHOLD_1, source: "photos_10" },
  second: { at: REVIEW_THRESHOLD_2, source: "photos_25" },
};

/** The Little Years holds 146 photos, so its asks come later. */
const LITTLE_YEARS_THRESHOLDS: ReviewThresholds = {
  first: { at: 30, source: "photos_30" },
  second: { at: 75, source: "photos_75" },
};

/** Thresholds for a theme's book: 30/75 for The Little Years, 10/25 for everything else. */
export function reviewThresholdsFor(themeId: string | null | undefined): ReviewThresholds {
  return getProductForTheme(themeId) === "little_years" ? LITTLE_YEARS_THRESHOLDS : DEFAULT_THRESHOLDS;
}

export interface ReviewState {
  asks: number;
  clicked: boolean;
}

const key = (themeId: string) => `ld_review_prompt_${themeId}`;

/**
 * Per-browser, per-theme ask state. Returns null when storage is unavailable
 * (callers then show no milestone asks). The old "1" value, written by the
 * first version of the card, migrates to {asks: 1, clicked: true}.
 */
export function readReviewState(themeId: string): ReviewState | null {
  try {
    const raw = localStorage.getItem(key(themeId));
    if (raw === null) return { asks: 0, clicked: false };
    if (raw === "1") {
      const migrated = { asks: 1, clicked: true };
      localStorage.setItem(key(themeId), JSON.stringify(migrated));
      return migrated;
    }
    const parsed = JSON.parse(raw);
    const asks = Number.isFinite(parsed?.asks) ? Number(parsed.asks) : 0;
    return { asks, clicked: parsed?.clicked === true };
  } catch {
    return null;
  }
}

function write(themeId: string, state: ReviewState): boolean {
  try {
    localStorage.setItem(key(themeId), JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export const canAsk = (s: ReviewState | null): s is ReviewState =>
  s !== null && !s.clicked && s.asks < MAX_REVIEW_ASKS;

/** Counts one ask. Returns false (and the caller must not show) if it can't be stored. */
export function recordAsk(themeId: string): boolean {
  const s = readReviewState(themeId);
  if (!canAsk(s)) return false;
  return write(themeId, { ...s, asks: s.asks + 1 });
}

export function recordClick(themeId: string): void {
  const s = readReviewState(themeId);
  write(themeId, { asks: s?.asks ?? 0, clicked: true });
}

/** Photos a customer has cropped: the book's slots plus extras (what the ZIP will contain). */
export function countCropped(
  photos: Record<string, PhotoEntry>,
  extras: ExtraPrint[],
  slots: PhotoSlot[]
): number {
  return (
    slots.filter((slot) => photos[slot.key]?.croppedUrl).length +
    extras.filter((e) => e.croppedUrl).length
  );
}

/**
 * Which milestone ask, if any, a rise in the cropped count from `prev` to `next`
 * earns. Ask #1 needs no prior asks, ask #2 needs exactly one; a jump past both
 * thresholds earns the earliest ask the state allows.
 */
export function milestoneFor(
  prev: number,
  next: number,
  state: ReviewState | null,
  thresholds: ReviewThresholds = DEFAULT_THRESHOLDS
): ReviewSource | null {
  if (!canAsk(state) || next <= prev) return null;
  const { first, second } = thresholds;
  if (state.asks === 0 && prev < first.at && next >= first.at) return first.source;
  if (state.asks <= 1 && prev < second.at && next >= second.at) return second.source;
  return null;
}
