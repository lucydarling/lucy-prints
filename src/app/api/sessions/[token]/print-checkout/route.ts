import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { isThemeAllowed } from "@/lib/preview-gate";
import { getPrintLock } from "@/lib/print-orders/freeze";
import { printButtonAllowed } from "@/lib/print-orders/print-gate";
import { prepareCheckout } from "@/lib/print-orders/checkout-prepare";
import type { SessionExtraRow, SessionPhotoRow } from "@/lib/print-orders/build-order";
import { checkRateLimit, RATE_LIMITS, tooManyRequestsResponse } from "@/lib/rate-limit";

export const runtime = "nodejs";

/**
 * POST /api/sessions/[token]/print-checkout
 *
 * Checks the saved book the way the orders/paid webhook will, and returns
 * either { errors } (nothing may be ordered) or { url, message } (the line to
 * confirm and the Shopify checkout URL). Read-only. 404 unless print ordering
 * is on (PRINT_ORDERS_ENABLED) or this browser holds the preview cookie, so
 * with it off the route does not exist.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  if (!printButtonAllowed(req.cookies)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const { token } = await params;
  const rl = await checkRateLimit(token, RATE_LIMITS.printCheckout);
  if (!rl.success) return tooManyRequestsResponse(rl.retryAfterSeconds);

  const { data: session } = await supabaseAdmin
    .from("sessions")
    .select("id, book_theme")
    .eq("token", token)
    .eq("status", "active")
    .maybeSingle();
  if (!session || !isThemeAllowed(session.book_theme, req.cookies)) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const [{ data: photoRows }, { data: extraRows }, lock] = await Promise.all([
    supabaseAdmin.from("session_photos").select("slot_key, storage_path, print_size, status").eq("session_id", session.id),
    supabaseAdmin.from("session_extras").select("extra_id, print_size, orientation, storage_path, quantity").eq("session_id", session.id),
    getPrintLock(session.id),
  ]);

  try {
    const result = prepareCheckout({
      token,
      bookTheme: session.book_theme,
      photoRows: (photoRows ?? []) as SessionPhotoRow[],
      extraRows: (extraRows ?? []) as SessionExtraRow[],
      lock,
    });
    return NextResponse.json(result.ok ? result : { errors: result.errors }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("print-checkout failed:", err);
    return NextResponse.json({ errors: ["print ordering is not available right now"] }, { status: 503 });
  }
}
