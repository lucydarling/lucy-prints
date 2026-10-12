// Server code only (reads secrets from env).
import { createHash, timingSafeEqual } from "crypto";

/**
 * Who may see the "Print my photos" button and call the checkout route.
 *
 *   PRINT_ORDERS_ENABLED=true     → everyone (the launch)
 *   PRINT_PREVIEW_SECRET=<secret> → /review?print_preview=<secret> sets an
 *                                   httpOnly cookie in that browser; only that
 *                                   cookie (or the flag) opens the feature.
 *
 * With neither, the feature does not exist: the checkout route answers 404 and
 * no customer page differs from before print orders. Session emails are NOT
 * used as a key (they are not verified). Mirrors preview-gate.ts.
 */
export const PRINT_PREVIEW_COOKIE = "ld_print_preview";
export const PRINT_PREVIEW_MAX_AGE = 60 * 60 * 24 * 30; // 30 days
const SALT = "ld-print-preview";

export interface CookieJar {
  get(name: string): { value: string } | undefined;
}

export function printOrdersEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.PRINT_ORDERS_ENABLED === "true";
}

const digest = (value: string) => createHash("sha256").update(`${SALT}:${value}`).digest();

function configuredSecret(env: NodeJS.ProcessEnv = process.env): string | null {
  // Trimmed: a value pasted into the Vercel dashboard can pick up a trailing newline.
  const key = env.PRINT_PREVIEW_SECRET?.trim();
  // A short or missing secret never unlocks anything.
  return key && key.length >= 16 ? key : null;
}

/** True when `candidate` is the configured preview secret (constant-time on equal-length digests). */
export function printPreviewKeyMatches(candidate: string | null | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  const key = configuredSecret(env);
  if (!key || !candidate) return false;
  return timingSafeEqual(digest(candidate), digest(key));
}

/** The cookie value a valid preview link sets (a hash — never the secret itself). */
export function printPreviewCookieValue(env: NodeJS.ProcessEnv = process.env): string | null {
  const key = configuredSecret(env);
  return key ? digest(`cookie:${key}`).toString("hex") : null;
}

/** May this request use print ordering? The flag, or the preview cookie. */
export function printButtonAllowed(jar: CookieJar | null | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  if (printOrdersEnabled(env)) return true;
  const expected = printPreviewCookieValue(env);
  const value = jar?.get(PRINT_PREVIEW_COOKIE)?.value;
  if (!expected || !value || value.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(value), Buffer.from(expected));
}
