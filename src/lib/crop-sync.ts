/**
 * What changed between two snapshots of the crops (key → cropped data URL,
 * null when there is no crop). Pure, so the upload hook's rules are testable.
 *
 * - newlyCropped: has a crop now, had none before (or wasn't there).
 * - recropped:    had a crop and now has a DIFFERENT one — the cloud copy is old.
 * - cleared:      had a crop and now has none (orientation or layout changed,
 *                 photo removed). Whatever crop replaces it must upload again,
 *                 so the key can't stay marked as uploaded.
 *
 * On the first pass after mount `prev` is empty, so nothing counts as
 * recropped or cleared — catch-up uploads still dedupe against uploadedSlots.
 */
export function diffCrops(
  prev: Map<string, string | null>,
  next: Map<string, string | null>
): { newlyCropped: string[]; recropped: string[]; cleared: string[] } {
  const newlyCropped: string[] = [];
  const recropped: string[] = [];
  const cleared: string[] = [];
  for (const [key, url] of next) {
    const before = prev.get(key) ?? null;
    if (url && !before) newlyCropped.push(key);
    else if (url && before && url !== before) recropped.push(key);
    else if (!url && before) cleared.push(key);
  }
  for (const [key, before] of prev) {
    if (before && !next.has(key)) cleared.push(key); // an extra deleted outright
  }
  return { newlyCropped, recropped, cleared };
}
