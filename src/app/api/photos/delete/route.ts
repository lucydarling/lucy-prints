import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { isThemeAllowed } from "@/lib/preview-gate";
import { getPrintedState, lockDecision } from "@/lib/print-orders/printed";
import { checkRateLimit, RATE_LIMITS, tooManyRequestsResponse } from "@/lib/rate-limit";

export const runtime = "nodejs";

const SLOT_KEY_SHAPE = /^[a-z0-9_]+$/;
const EXTRA_KEY_SHAPE = /^extra_[a-z0-9_]+$/i;

/**
 * DELETE /api/photos/delete
 * Body: { sessionToken, slotKey } for a book slot, or { sessionToken, extraId } for an extra.
 *
 * The customer removed a photo or extra: delete its row and its stored file.
 * A slot or extra that has been printed is locked (409); everything else can be removed. Only ever touches this session's own row, and the
 * file named by that row. Removing something that isn't there is a success.
 */
export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const sessionToken = typeof body.sessionToken === "string" ? body.sessionToken : "";
    const slotKey = typeof body.slotKey === "string" ? body.slotKey : "";
    const extraId = typeof body.extraId === "string" ? body.extraId : "";
    // Remove a pending (not yet ordered) reprint of a printed slot.
    const reprint = body.reprint === true;
    if (!sessionToken || (!slotKey && !extraId) || (slotKey && extraId)) {
      return NextResponse.json({ error: "sessionToken and one of slotKey or extraId are required" }, { status: 400 });
    }
    if (extraId ? !EXTRA_KEY_SHAPE.test(extraId) : !SLOT_KEY_SHAPE.test(slotKey)) {
      return NextResponse.json({ error: "Invalid key" }, { status: 400 });
    }

    const rl = await checkRateLimit(sessionToken, RATE_LIMITS.upload);
    if (!rl.success) return tooManyRequestsResponse(rl.retryAfterSeconds);

    const { data: session } = await supabaseAdmin
      .from("sessions")
      .select("id, book_theme")
      .eq("token", sessionToken)
      .eq("status", "active")
      .maybeSingle();
    if (!session || !isThemeAllowed(session.book_theme, req.cookies)) {
      return NextResponse.json({ error: "Invalid or expired session" }, { status: 404 });
    }
    // Printed slots and extras can't be removed; a pending reprint can.
    const printed = await getPrintedState(session.id);
    if (reprint) {
      if (!slotKey) return NextResponse.json({ error: "slotKey is required to remove a reprint" }, { status: 400 });
      const { error: rpError } = await supabaseAdmin
        .from("print_reprints")
        .delete()
        .eq("session_id", session.id)
        .eq("slot_key", slotKey)
        .eq("status", "pending");
      if (rpError) {
        console.error("Reprint delete error:", rpError);
        return NextResponse.json({ error: "Failed to remove the replacement photo" }, { status: 500 });
      }
      // The stored file is kept (never deleted); only the pending row goes.
      return NextResponse.json({ success: true, deleted: true });
    }
    const locked = lockDecision(printed, { isExtra: Boolean(extraId), key: extraId || slotKey });
    if (locked) return NextResponse.json(locked.body, { status: locked.status });

    const table = extraId ? "session_extras" : "session_photos";
    const keyColumn = extraId ? "extra_id" : "slot_key";
    const keyValue = extraId || slotKey;

    const { data: row } = await supabaseAdmin
      .from(table)
      .select("storage_path")
      .eq("session_id", session.id)
      .eq(keyColumn, keyValue)
      .maybeSingle();
    if (!row) return NextResponse.json({ success: true, deleted: false });

    // Row first: if the file removal then fails we have an orphaned file (harmless),
    // never a row pointing at a missing file (which would break the book).
    const { error: delError } = await supabaseAdmin
      .from(table)
      .delete()
      .eq("session_id", session.id)
      .eq(keyColumn, keyValue);
    if (delError) {
      console.error("Photo delete (row) error:", delError);
      return NextResponse.json({ error: "Failed to remove the photo" }, { status: 500 });
    }
    if (row.storage_path) {
      const { error: rmError } = await supabaseAdmin.storage.from("photos").remove([row.storage_path]);
      if (rmError) console.error("Photo delete (file) error — orphaned file:", row.storage_path, rmError);
    }
    return NextResponse.json({ success: true, deleted: true });
  } catch (err) {
    console.error("Photo delete error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
