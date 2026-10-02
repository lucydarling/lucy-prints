// Server code only (reads secrets from env).
import { createHash, timingSafeEqual } from "crypto";
import { getProductForTheme, type ProductType } from "@/lib/photo-slots";

/**
 * Books that are hidden until Kevin says otherwise. While a book is hidden it
 * exists only for browsers that opened its private preview link, which sets
 * an httpOnly cookie. Everything that decides "can this request see or write
 * this book?" goes through this file, so going public is one env change per
 * book:
 *
 *   Pregnancy journal
 *     PHOTO_LAB_PJ_PUBLIC=true            → visible to everyone
 *     PHOTO_LAB_PJ_PREVIEW_KEY=<secret>   → /preview?key=<secret> unlocks a browser
 *   The Little Years
 *     LITTLE_YEARS_ENABLED=true           → visible to everyone (the launch)
 *     LITTLE_YEARS_PREVIEW_KEY=<secret>   → /preview?book=little_years&key=<secret>
 *
 * None of these are in git; they live in Vercel project env. Each book has its
 * own key and cookie, so one book's key never unlocks the other.
 */
interface Gate {
  publicEnv: string;
  keyEnv: string;
  cookie: string;
  /** Hash salt. Changing it invalidates every cookie already set for the book. */
  salt: string;
}

const GATES: Partial<Record<ProductType, Gate>> = {
  pregnancy_journal: {
    publicEnv: "PHOTO_LAB_PJ_PUBLIC",
    keyEnv: "PHOTO_LAB_PJ_PREVIEW_KEY",
    cookie: "ld_pj_preview",
    salt: "ld-pj-preview",
  },
  little_years: {
    publicEnv: "LITTLE_YEARS_ENABLED",
    keyEnv: "LITTLE_YEARS_PREVIEW_KEY",
    cookie: "ld_ly_preview",
    salt: "ld-ly-preview",
  },
};

export const PREVIEW_MAX_AGE = 60 * 60 * 24 * 90; // 90 days

/** Anything with `get(name)?.value` — a NextRequest's cookies or next/headers cookies(). */
export interface CookieJar {
  get(name: string): { value: string } | undefined;
}

/** Products that have a gate, whether or not it's currently open. */
export const GATED_PRODUCTS = Object.keys(GATES) as ProductType[];

/** The cookie name that unlocks `product`, or null if the product has no gate. */
export function previewCookieName(product: ProductType): string | null {
  return GATES[product]?.cookie ?? null;
}

/** True when `product` has no gate or its gate is open to everyone. */
export function isProductPublic(product: ProductType): boolean {
  const gate = GATES[product];
  return !gate || process.env[gate.publicEnv] === "true";
}

function digest(gate: Gate, value: string): Buffer {
  return createHash("sha256").update(`${gate.salt}:${value}`).digest();
}

function configuredKey(gate: Gate): string | null {
  // Trimmed: a key pasted into the Vercel dashboard can pick up a trailing newline.
  const key = process.env[gate.keyEnv]?.trim();
  // A short or missing key never unlocks anything.
  return key && key.length >= 16 ? key : null;
}

/** True when `candidate` is the configured preview key for `product`. */
export function previewKeyMatches(
  product: ProductType,
  candidate: string | null | undefined
): boolean {
  const gate = GATES[product];
  const key = gate && configuredKey(gate);
  if (!gate || !key || !candidate) return false;
  return timingSafeEqual(digest(gate, candidate), digest(gate, key));
}

/** The cookie value a valid preview link sets (a hash — never the key itself). */
export function previewCookieValue(product: ProductType): string | null {
  const gate = GATES[product];
  const key = gate && configuredKey(gate);
  return gate && key ? digest(gate, `cookie:${key}`).toString("hex") : null;
}

/** True when `product` is public, or this request carries its unlock cookie. */
export function isProductUnlocked(product: ProductType, jar: CookieJar | null | undefined): boolean {
  if (isProductPublic(product)) return true;
  const gate = GATES[product]!;
  const expected = previewCookieValue(product);
  const value = jar?.get(gate.cookie)?.value;
  if (!expected || !value || value.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(value), Buffer.from(expected));
}

/** May this request use `themeId`? Every theme except a hidden book's. */
export function isThemeAllowed(
  themeId: string | null | undefined,
  jar: CookieJar | null | undefined
): boolean {
  const product = getProductForTheme(themeId);
  return !product || isProductUnlocked(product, jar);
}

/** Which gated books this request may see. */
export function unlockedProducts(jar: CookieJar | null | undefined): Record<ProductType, boolean> {
  return {
    memory_book: true,
    pregnancy_journal: isProductUnlocked("pregnancy_journal", jar),
    little_years: isProductUnlocked("little_years", jar),
  };
}
