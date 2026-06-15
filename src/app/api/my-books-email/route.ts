import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { sendMyBooksEmail } from "@/lib/email";
import { BOOK_THEMES } from "@/lib/photo-slots";
import {
  checkRateLimits,
  RATE_LIMITS,
  getClientIp,
  tooManyRequestsResponse,
} from "@/lib/rate-limit";

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json();

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "Valid email required" }, { status: 400 });
    }

    // Email-sending route — abuse vector is email spam, so key on BOTH the
    // normalized email and the IP; whichever trips first blocks.
    const normalizedEmail = email.toLowerCase().trim();
    const rl = await checkRateLimits([
      { identifier: normalizedEmail, rule: RATE_LIMITS.myBooksEmailPerEmail },
      { identifier: getClientIp(req), rule: RATE_LIMITS.myBooksEmailPerIp },
    ]);
    if (!rl.success) {
      return tooManyRequestsResponse(rl.retryAfterSeconds);
    }

    const { data: sessions } = await supabaseAdmin
      .from("sessions")
      .select("token, book_theme, baby_name, photo_count")
      .eq("email", email.toLowerCase().trim())
      .eq("status", "active")
      .order("last_activity_at", { ascending: false, nullsFirst: false });

    // Always return 200 — don't reveal whether email exists
    if (!sessions || sessions.length === 0) {
      return NextResponse.json({ success: true });
    }

    const enriched = sessions.map((s) => {
      const theme = BOOK_THEMES.find((t) => t.id === s.book_theme);
      return {
        token: s.token,
        themeName: theme?.name ?? s.book_theme,
        babyName: s.baby_name as string | null,
        photoCount: s.photo_count || 0,
      };
    });

    await sendMyBooksEmail({ to: email.toLowerCase().trim(), sessions: enriched });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("my-books-email error:", err);
    return NextResponse.json({ error: "Failed to send email" }, { status: 500 });
  }
}
