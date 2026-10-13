import { supabaseAdmin } from "@/lib/supabase-server";
import { loadSessionExtras } from "@/lib/session-extras";
import { getProductForTheme } from "@/lib/photo-slots";
import { ROUND_REMINDER } from "./config";
import { getPrintedState, type PrintedState } from "./printed";
import { computeRound } from "./round";
import type { SessionExtraRow, SessionPhotoRow } from "./build-order";

/**
 * Data for Klaviyo round-reminder flows. Four profile properties describe the
 * memory book the customer saved most recently (Klaviyo profiles are one value
 * per email, last write wins):
 *
 *   printed_count        book photos printed so far: distinct slots with a
 *                        print_order_items row, i.e. the same number as the
 *                        per-slot lock and the "X of Y photos printed" line
 *                        (orders in ready, sent or error; held/refused never
 *                        write rows).
 *   unprinted_count      prints the next order would contain from new photos:
 *                        saved book photos not yet printed + extra prints not
 *                        yet printed (extras by quantity). Pending reprints
 *                        are not counted.
 *   last_print_order_at  ISO time of the latest ready/sent/error order for
 *                        the book. Not written if there is none.
 *   print_round_due      "welcome_baby" | "first_year" | "growing_up" | "".
 *                        Not written if the book has no birthdate.
 */
export type PrintRoundDue = "welcome_baby" | "first_year" | "growing_up" | "";

export interface PrintRoundProperties {
  printed_count: number;
  unprinted_count: number;
  last_print_order_at?: string;
  print_round_due?: PrintRoundDue;
}

/** Whole months from birthdate ("YYYY-MM-DD") to `now` (UTC dates); negative for a future date. */
export function ageInMonths(birthdate: string, now: Date): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(birthdate);
  if (!m) return null;
  const [by, bm, bd] = [Number(m[1]), Number(m[2]), Number(m[3])];
  let months = (now.getUTCFullYear() - by) * 12 + (now.getUTCMonth() + 1 - bm);
  if (now.getUTCDate() < bd) months -= 1;
  return months;
}

export interface RoundDueInput {
  birthdate: string | null;
  now: Date;
  unprintedCount: number;
  /** Latest ready/sent/error order for this book, or null. */
  lastOrderAt: Date | null;
}

/**
 * The reminder rules. null = leave the property unset (no usable birthdate).
 * A child of 5+ is checked for growing_up first (it has no quiet period); a
 * baby of 13+ months for first_year; a baby of 3-12 months for welcome_baby
 * (only before any order).
 */
export function computePrintRoundDue(i: RoundDueInput, cfg = ROUND_REMINDER): PrintRoundDue | null {
  if (!i.birthdate) return null;
  const months = ageInMonths(i.birthdate, i.now);
  if (months === null) return null;
  if (months < 0) return "";

  if (months >= cfg.GROWING_UP_MIN_YEARS * 12 && i.unprintedCount >= cfg.GROWING_UP_MIN_UNPRINTED) {
    return "growing_up";
  }
  if (months >= cfg.FIRST_YEAR_MIN_MONTHS && i.unprintedCount >= cfg.MIN_UNPRINTED) {
    const quietMs = cfg.FIRST_YEAR_QUIET_DAYS * 86_400_000;
    const recent = i.lastOrderAt !== null && i.now.getTime() - i.lastOrderAt.getTime() < quietMs;
    if (!recent) return "first_year";
  }
  if (
    months >= cfg.WELCOME_BABY_MIN_MONTHS &&
    months <= cfg.WELCOME_BABY_MAX_MONTHS &&
    i.lastOrderAt === null &&
    i.unprintedCount >= cfg.MIN_UNPRINTED
  ) {
    return "welcome_baby";
  }
  return "";
}

/** Pure: the four properties from what was read. */
export function buildPrintRoundProperties(r: {
  bookTheme: string;
  birthdate: string | null;
  now: Date;
  photoRows: SessionPhotoRow[];
  extraRows: SessionExtraRow[];
  printed: PrintedState;
  lastOrderAt: Date | null;
}): PrintRoundProperties {
  const round = computeRound({
    bookTheme: r.bookTheme,
    photoRows: r.photoRows,
    extraRows: r.extraRows,
    reprintRows: [],
    printed: r.printed,
    variantId: () => "n/a", // only the counts are used here
  });
  const unprinted = round.newPhotos + round.extras;
  const out: PrintRoundProperties = { printed_count: r.printed.slots.size, unprinted_count: unprinted };
  if (r.lastOrderAt) out.last_print_order_at = r.lastOrderAt.toISOString();
  const due = computePrintRoundDue({ birthdate: r.birthdate, now: r.now, unprintedCount: unprinted, lastOrderAt: r.lastOrderAt });
  if (due !== null) out.print_round_due = due;
  return out;
}

/** Read-only. Null for a book that is not a memory book (journal / Little Years never get these). */
export async function loadPrintRoundProperties(
  sessionId: string,
  now = new Date()
): Promise<{ email: string; properties: PrintRoundProperties } | null> {
  const { data: session } = await supabaseAdmin
    .from("sessions")
    .select("id, email, book_theme, baby_birthdate")
    .eq("id", sessionId)
    .eq("status", "active")
    .maybeSingle();
  if (!session || getProductForTheme(session.book_theme) !== "memory_book") return null;

  const printed = await getPrintedState(session.id);
  const [photos, extras, orders] = await Promise.all([
    supabaseAdmin.from("session_photos").select("slot_key, storage_path, print_size, status").eq("session_id", session.id),
    // Each duplicate copy counted once (see lib/collapse-extras.ts).
    loadSessionExtras(session.id, printed),
    supabaseAdmin
      .from("print_orders")
      .select("created_at")
      .eq("session_id", session.id)
      .in("status", ["ready", "sent", "error"])
      .order("created_at", { ascending: false })
      .limit(1),
  ]);
  if (photos.error || extras.error || orders.error) {
    console.error("print round properties lookup failed:", photos.error ?? extras.error ?? orders.error);
    return null;
  }
  const last = orders.data?.[0]?.created_at ? new Date(orders.data[0].created_at as string) : null;
  return {
    email: session.email as string,
    properties: buildPrintRoundProperties({
      bookTheme: session.book_theme as string,
      birthdate: (session.baby_birthdate as string | null) ?? null,
      now,
      photoRows: (photos.data ?? []) as SessionPhotoRow[],
      extraRows: (extras.data ?? []) as SessionExtraRow[],
      printed,
      lastOrderAt: last,
    }),
  };
}
