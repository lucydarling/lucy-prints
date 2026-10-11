import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { getPrintLock } from "@/lib/print-orders/freeze";
import { isThemeAllowed } from "@/lib/preview-gate";
import { printButtonAllowed } from "@/lib/print-orders/print-gate";

export const runtime = "nodejs";

/**
 * GET /api/sessions/[token]/print-status
 * { printStatus: "frozen" | "held" | null } — drives the banner on the upload page.
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
  // printEnabled is added ONLY when true, so with print ordering off the
  // response is byte-for-byte what it was before.
  return NextResponse.json({
    printStatus: await getPrintLock(session.id),
    ...(printButtonAllowed(req.cookies) ? { printEnabled: true } : {}),
  });
}
