// Server code only (reads secrets from env).
import { createHash, timingSafeEqual } from "crypto";
import { getProductForTheme } from "@/lib/photo-slots";

/**
 * The pregnancy journal is hidden until Kevin says otherwise. While hidden,
 * it exists only for browsers that opened the private preview link, which
 * sets an httpOnly cookie. Everything that decides "can this request see or
 * write a journal?" goes through this file, so going public is one env change:
 *
 *   PHOTO_LAB_PJ_PUBLIC=true          → journal visible to everyone
 *   PHOTO_LAB_PJ_PREVIEW_KEY=<secret> → /preview?key=<secret> unlocks a browser
 *
 * Neither variable is in git; both live in Vercel project env.
 */
export const PJ_PREVIEW_COOKIE = "ld_pj_preview";
export const PJ_PREVIEW_MAX_AGE = 60 * 60 * 24 * 90; // 90 days

export function isJournalPublic(): boolean {
  return process.env.PHOTO_LAB_PJ_PUBLIC === "true";
}

function digest(value: string): Buffer {
  return createHash("sha256").update(`ld-pj-preview:${value}`).digest();
}

function configuredKey(): string | null {
  // Trimmed: a key pasted into the Vercel dashboard can pick up a trailing newline.
  const key = process.env.PHOTO_LAB_PJ_PREVIEW_KEY?.trim();
  // A short or missing key never unlocks anything.
  return key && key.length >= 16 ? key : null;
}

/** True when `candidate` is the configured preview key. */
export function previewKeyMatches(candidate: string | null | undefined): boolean {
  const key = configuredKey();
  if (!key || !candidate) return false;
  return timingSafeEqual(digest(candidate), digest(key));
}

/** The cookie value a valid preview link sets (a hash — never the key itself). */
export function previewCookieValue(): string | null {
  const key = configuredKey();
  return key ? digest(`cookie:${key}`).toString("hex") : null;
}

/** True when the journal is public, or this request carries the unlock cookie. */
export function isJournalUnlocked(cookieValue: string | null | undefined): boolean {
  if (isJournalPublic()) return true;
  const expected = previewCookieValue();
  if (!expected || !cookieValue || cookieValue.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(cookieValue), Buffer.from(expected));
}

/** May this request use `themeId`? Every theme except a hidden journal's. */
export function isThemeAllowed(
  themeId: string | null | undefined,
  cookieValue: string | null | undefined
): boolean {
  return getProductForTheme(themeId) !== "pregnancy_journal" || isJournalUnlocked(cookieValue);
}
