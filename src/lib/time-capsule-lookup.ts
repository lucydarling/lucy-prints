/**
 * Look up Time Capsule auto-fill suggestions based on baby's birthdate.
 *
 * Uses a static dataset shipped with the app bundle (~8KB).
 * Data covers 2019–2026 and is updated periodically with deploys.
 */

import data from "./time-capsule-data.json";

export interface TimeCapsuleSuggestions {
  breadCost: string | null;
  fuelCost: string | null;
  popularSong: string | null;
  nationsLeader: string | null;
}

/**
 * Given a birthdate string (YYYY-MM-DD), return auto-fill suggestions
 * for the four Time Capsule fields. Returns null if the date is invalid
 * or outside the dataset range.
 */
export function lookupTimeCapsule(
  birthdate: string | null | undefined
): TimeCapsuleSuggestions | null {
  if (!birthdate) return null;

  const date = new Date(birthdate + "T12:00:00"); // noon to avoid timezone issues
  if (isNaN(date.getTime())) return null;

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const monthKey = `${year}-${month}`;
  const yearKey = String(year);

  // Gas price (monthly)
  const gasPrice = (data.gasPrices as Record<string, number>)[monthKey];
  const fuelCost = gasPrice != null ? `$${gasPrice.toFixed(2)}` : null;

  // Song (monthly)
  const popularSong = (data.songs as Record<string, string>)[monthKey] || null;

  // Bread price (yearly)
  const breadPrice = (data.breadPrices as Record<string, number>)[yearKey];
  const breadCost = breadPrice != null ? `$${breadPrice.toFixed(2)}` : null;

  // President (date range lookup)
  let nationsLeader: string | null = null;
  const dateStr = birthdate; // YYYY-MM-DD
  for (const p of data.presidents) {
    if (dateStr >= p.start && dateStr < p.end) {
      nationsLeader = p.name;
      break;
    }
  }

  // Return null if we have no data at all for this date
  if (!fuelCost && !popularSong && !breadCost && !nationsLeader) {
    return null;
  }

  return { breadCost, fuelCost, popularSong, nationsLeader };
}

/**
 * Map from Time Capsule prompt keys to suggestion fields.
 * Used to auto-fill the correct prompt from lookup results.
 */
export const TIME_CAPSULE_PROMPT_MAP: Record<
  string,
  keyof TimeCapsuleSuggestions
> = {
  bread_cost: "breadCost",
  fuel_cost: "fuelCost",
  popular_song: "popularSong",
  nations_leader: "nationsLeader",
};
