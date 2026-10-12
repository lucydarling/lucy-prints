import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { BOOK_THEMES, getSlots } from "@/lib/photo-slots";
import { isThemeAllowed } from "@/lib/preview-gate";
import { printButtonAllowed } from "@/lib/print-orders/print-gate";
import { printedCounts } from "@/lib/print-orders/ordered";
import {
  checkRateLimit,
  RATE_LIMITS,
  tooManyRequestsResponse,
} from "@/lib/rate-limit";

/**
 * List the other active books that belong to the same email as a session the
 * caller already holds a valid token for.
 *
 * Security: this never takes an email. To see the sibling books (and their
 * resume tokens) for an address, the caller must present a valid active
 * session token for that address. Since tokens are only ever delivered to the
 * email owner, possessing one proves control of the email — this is the
 * "already logged in" check. It does NOT allow enumerating books by email,
 * which is the broken-access-control the old GET /api/sessions?email leaked.
 */
export async function POST(req: NextRequest) {
  try {
    const { sessionToken } = await req.json();

    if (!sessionToken || typeof sessionToken !== "string") {
      return NextResponse.json({ error: "Session token required" }, { status: 400 });
    }

    // Rate limit per session token.
    const rl = await checkRateLimit(sessionToken, RATE_LIMITS.siblings);
    if (!rl.success) {
      return tooManyRequestsResponse(rl.retryAfterSeconds);
    }

    // Resolve the token to its email. Unknown/expired token → neutral empty list.
    const { data: current } = await supabaseAdmin
      .from("sessions")
      .select("email")
      .eq("token", sessionToken)
      .eq("status", "active")
      .maybeSingle();

    if (!current?.email) {
      return NextResponse.json({ sessions: [] });
    }

    const { data: sessions } = await supabaseAdmin
      .from("sessions")
      .select("id, token, book_theme, baby_name, photo_count")
      .eq("email", current.email)
      .eq("status", "active")
      .order("last_activity_at", { ascending: false, nullsFirst: false });

    // A hidden book (the journal, until it's public) is listed only for a
    // browser that has unlocked it.
    const cookie = req.cookies;
    const visible = (sessions || []).filter((s) => isThemeAllowed(s.book_theme, cookie));
    // "X of 49 printed" exists only while print ordering is on for this browser; otherwise
    // the response is exactly what it was before.
    const printed = printButtonAllowed(cookie) ? await printedCounts(visible.map((s) => s.id as string)) : new Map<string, number>();
    const enriched = visible.map((s) => {
      const theme = BOOK_THEMES.find((t) => t.id === s.book_theme);
      return {
        token: s.token,
        bookTheme: s.book_theme,
        themeName: theme?.name ?? s.book_theme,
        babyName: s.baby_name as string | null,
        photoCount: s.photo_count || 0,
        ...(printed.get(s.id as string) ? { printedSoFar: printed.get(s.id as string), bookSlots: getSlots(s.book_theme).length } : {}),
      };
    });

    return NextResponse.json({ sessions: enriched });
  } catch (err) {
    console.error("sessions/siblings error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
