import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { printOrdersEnabled } from "@/lib/print-orders/print-gate";
import { syncPrintRoundReminders } from "@/lib/print-orders/round-reminder-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(header: string | null, secret: string): boolean {
  const want = Buffer.from(`Bearer ${secret}`);
  const got = Buffer.from(header ?? "");
  return got.length === want.length && timingSafeEqual(got, want);
}

/**
 * GET /api/cron/print-round-reminders  (Vercel Cron, daily; CRON_SECRET-gated)
 *
 * Refreshes the Klaviyo round-reminder properties so a baby crossing an age
 * threshold updates without a save. Does NOTHING unless PRINT_ORDERS_ENABLED
 * is "true" (a preview cookie cannot exist here). One session per email: the
 * most recently active active memory book with a birthdate. Writes only
 * Klaviyo profile properties; nothing in our database.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET ?? "";
  if (!secret) return NextResponse.json({ error: "not configured" }, { status: 500 });
  if (!authorized(req.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!printOrdersEnabled()) return NextResponse.json({ skipped: "print ordering is off" });

  const { data, error } = await supabaseAdmin
    .from("sessions")
    .select("id, email, last_activity_at, created_at")
    .eq("status", "active")
    .not("baby_birthdate", "is", null)
    .order("last_activity_at", { ascending: false, nullsFirst: false });
  if (error) {
    console.error("print round reminders: session list failed:", error);
    return NextResponse.json({ error: "server error" }, { status: 500 });
  }

  // First row per email = most recently active (sync skips non-memory books itself).
  const byEmail = new Map<string, string>();
  for (const s of data ?? []) {
    const key = (s.email as string).toLowerCase().trim();
    if (!byEmail.has(key)) byEmail.set(key, s.id as string);
  }
  const ids = [...byEmail.values()];

  let next = 0;
  const worker = async () => {
    while (next < ids.length) {
      const id = ids[next++];
      await syncPrintRoundReminders(id, { flagOnly: true });
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  return NextResponse.json({ synced: ids.length });
}
