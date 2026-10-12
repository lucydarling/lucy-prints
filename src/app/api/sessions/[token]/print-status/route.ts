import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { getSlots } from "@/lib/photo-slots";
import { getPrintedState } from "@/lib/print-orders/printed";
import { isThemeAllowed } from "@/lib/preview-gate";
import { printButtonAllowed } from "@/lib/print-orders/print-gate";

export const runtime = "nodejs";

/**
 * GET /api/sessions/[token]/print-status
 * { printStatus: null } — kept for old clients (the session never locks as a
 * whole any more). With print ordering on for this browser it also returns
 * { printEnabled: true, printed: { slots, extras, reprintSlots, printedCount, bookSlots } }
 * which drives the per-photo locks and the progress line.
 * Reveals nothing beyond what holding the session token already shows.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const { data: session } = await supabaseAdmin
    .from("sessions")
    .select("id, book_theme")
    .eq("token", token)
    .eq("status", "active")
    .maybeSingle();
  if (!session || !isThemeAllowed(session.book_theme, req.cookies)) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  // Everything beyond printStatus is added ONLY when print ordering is on for this
  // browser, so with it off the response is byte-for-byte what it was before.
  if (!printButtonAllowed(req.cookies)) return NextResponse.json({ printStatus: null });

  const [printed, { data: reprints }] = await Promise.all([
    getPrintedState(session.id),
    supabaseAdmin.from("print_reprints").select("slot_key").eq("session_id", session.id).eq("status", "pending"),
  ]);
  return NextResponse.json({
    printStatus: null,
    printEnabled: true,
    printed: {
      slots: [...printed.slots.keys()],
      extras: [...printed.extras],
      reprintSlots: (reprints ?? []).map((r) => r.slot_key as string),
      printedCount: printed.slots.size,
      bookSlots: getSlots(session.book_theme).length,
    },
  });
}
