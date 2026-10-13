import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { loadSessionExtras } from "@/lib/session-extras";
import { isThemeAllowed } from "@/lib/preview-gate";
import { getPrintedState } from "@/lib/print-orders/printed";
import { ROUND_TTL_HOURS } from "@/lib/print-orders/config";
import { printButtonAllowed } from "@/lib/print-orders/print-gate";
import { prepareCheckout } from "@/lib/print-orders/checkout-prepare";
import type { SessionExtraRow, SessionPhotoRow } from "@/lib/print-orders/build-order";
import type { ReprintRow } from "@/lib/print-orders/round";
import { checkRateLimit, RATE_LIMITS, tooManyRequestsResponse } from "@/lib/rate-limit";

export const runtime = "nodejs";

/**
 * POST /api/sessions/[token]/print-checkout
 *
 * Works out the next round (book photos, extras and reprints not yet printed)
 * the way the orders/paid webhook will, and returns either { errors } (nothing
 * may be ordered) or { url, message, price, … } (the line to confirm and the
 * Shopify checkout URL). On success it records the round (print_rounds) so the
 * paid order prints exactly this list. 404 unless print ordering is on
 * (PRINT_ORDERS_ENABLED) or this browser holds the preview cookie, so with it
 * off the route does not exist.
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

  const printed = await getPrintedState(session.id);
  const [{ data: photoRows }, { data: extraRows }, { data: reprintRows }] = await Promise.all([
    supabaseAdmin.from("session_photos").select("slot_key, storage_path, print_size, status").eq("session_id", session.id),
    // Each duplicate copy counted once (see lib/collapse-extras.ts).
    loadSessionExtras(session.id, printed),
    supabaseAdmin.from("print_reprints").select("id, slot_key, storage_path, print_size, status").eq("session_id", session.id).eq("status", "pending"),
  ]);

  try {
    const result = await prepareCheckout({
      token,
      bookTheme: session.book_theme,
      photoRows: (photoRows ?? []) as SessionPhotoRow[],
      extraRows: (extraRows ?? []) as SessionExtraRow[],
      reprintRows: (reprintRows ?? []) as ReprintRow[],
      printed,
      createRound: async (round) => {
        const { data, error } = await supabaseAdmin
          .from("print_rounds")
          .insert({
            session_id: session.id,
            items: round.items,
            quantities: round.quantities,
            total_prints: round.total,
            expires_at: new Date(Date.now() + ROUND_TTL_HOURS * 3600_000).toISOString(),
          })
          .select("id")
          .single();
        if (error || !data) throw new Error(`could not record the round: ${error?.message ?? "no row"}`);
        return data.id as string;
      },
    });
    return NextResponse.json(result.ok ? result : { errors: result.errors }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("print-checkout failed:", err);
    return NextResponse.json({ errors: ["print ordering is not available right now"] }, { status: 503 });
  }
}
