/**
 * When to ask for a missing baby birthdate (the "BirthdateCard"). Pure logic,
 * so it is unit tested. The per-book choice lives in localStorage only (the
 * existing "I don't want milestone reminders" opt-out is device-local too).
 *
 *   "not now"        → hidden for NOT_NOW_DAYS, then asked again
 *   "rather not say" → never asked again for this book on this device
 */
export const BIRTHDATE_CARD_KEY_PREFIX = "ld-birthdate-card:";
export const NOT_NOW_DAYS = 7;

export type BirthdateChoice = { kind: "not_now"; at: number } | { kind: "never" } | null;

export function birthdateCardKey(token: string): string {
  return `${BIRTHDATE_CARD_KEY_PREFIX}${token}`;
}

export function parseBirthdateChoice(raw: string | null): BirthdateChoice {
  if (!raw) return null;
  if (raw === "never") return { kind: "never" };
  const m = /^not_now:(\d+)$/.exec(raw);
  return m ? { kind: "not_now", at: Number(m[1]) } : null;
}

export function serializeBirthdateChoice(choice: NonNullable<BirthdateChoice>): string {
  return choice.kind === "never" ? "never" : `not_now:${choice.at}`;
}

export interface BirthdateCardInput {
  hasToken: boolean;
  /** Memory books only; journals and Little Years never ask for a baby's birthday. */
  isMemoryBook: boolean;
  babyBirthdate: string | null;
  /** The device-wide "I don't want milestone reminders" choice already made at sign-up. */
  optedOutOfReminders: boolean;
  choice: BirthdateChoice;
  now: number;
}

export function shouldShowBirthdateCard(i: BirthdateCardInput): boolean {
  if (!i.hasToken || !i.isMemoryBook || i.babyBirthdate || i.optedOutOfReminders) return false;
  if (i.choice?.kind === "never") return false;
  if (i.choice?.kind === "not_now" && i.now - i.choice.at < NOT_NOW_DAYS * 86_400_000) return false;
  return true;
}

/** "YYYY-MM-DD" in the caller's local time, for the date input's max. */
export function localDateString(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
