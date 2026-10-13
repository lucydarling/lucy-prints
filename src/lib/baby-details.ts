/**
 * Baby details (name, birthdate) on a saved book.
 *
 * Saving is never a way to clear them: a blank value means "unchanged". The
 * edit form opens empty whenever the browser doesn't know the saved values
 * (a resume on a new device, before 2026-10-13), so a blank used to wipe a
 * stored birthdate, and the birthdate is what times the Klaviyo milestone
 * reminders.
 */

function nonBlank(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
}

/** The session columns a save may write. Blank, null or missing values are left out. */
export function babyDetailsUpdate(input: {
  babyName?: unknown;
  babyBirthdate?: unknown;
}): { baby_name?: string; baby_birthdate?: string } {
  const out: { baby_name?: string; baby_birthdate?: string } = {};
  const name = nonBlank(input.babyName);
  const birthdate = nonBlank(input.babyBirthdate);
  if (name !== undefined) out.baby_name = name;
  if (birthdate !== undefined) out.baby_birthdate = birthdate;
  return out;
}

/** True when a save sets a birthdate the session didn't already have (first time or changed). */
export function isNewBirthdate(stored: string | null | undefined, sent: string | undefined): boolean {
  return !!sent && sent !== (stored ?? null);
}

/**
 * Form state for a resumed book: the progress bar's baby row and the edit
 * form read these, so without them a resumed book showed "Add your baby's
 * name" and an empty form.
 */
export function resumedBabyDetails(session: {
  babyName?: string | null;
  babyBirthdate?: string | null;
  milestoneOptOut?: boolean | null;
}): { pendingBabyName: string; pendingBabyBirthdate: string; birthdateOptOut: boolean } {
  return {
    pendingBabyName: session.babyName ?? "",
    pendingBabyBirthdate: session.babyBirthdate ?? "",
    birthdateOptOut: session.milestoneOptOut === true,
  };
}

/**
 * Session column for "I don't want milestone reminders". Only an explicit
 * boolean is written. It never touches the birthdate.
 */
export function milestoneOptOutUpdate(sent: unknown): { milestone_opt_out?: boolean } {
  if (sent === true || sent === false) return { milestone_opt_out: sent };
  return {};
}
