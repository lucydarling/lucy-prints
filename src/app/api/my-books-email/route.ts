import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { sendMyBooksEmail, EmailSendError } from "@/lib/email";
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

    const { data: sessions, error: lookupError } = await supabaseAdmin
      .from("sessions")
      .select("token, book_theme, baby_name, photo_count")
      .eq("email", normalizedEmail)
      .eq("status", "active")
      .order("last_activity_at", { ascending: false, nullsFirst: false });

    if (lookupError) {
      // A failed query is NOT the same as "no books" — never let a database
      // outage masquerade as an empty result and return a silent 200.
      console.error(
        `[my-books-email] outcome=lookup-error email=${normalizedEmail} reason=${lookupError.message}`
      );
      return NextResponse.json({ error: "Failed to send email" }, { status: 500 });
    }

    // Always return 200 — don't reveal whether email exists.
    // Logged distinctly so a lookup miss is never confused with a send failure.
    if (!sessions || sessions.length === 0) {
      console.warn(
        `[my-books-email] outcome=lookup-miss email=${normalizedEmail} — no active session; no email attempted`
      );
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

    try {
      await sendMyBooksEmail({ to: normalizedEmail, sessions: enriched });
    } catch (sendErr) {
      // Distinct from lookup-miss above: the session WAS found and the send
      // was rejected. Log the provider's own reason verbatim — a generic
      // "failed to send" is what hid the unverified-domain 403 for weeks.
      const detail =
        sendErr instanceof EmailSendError
          ? `provider=${sendErr.providerName} status=${sendErr.providerStatus ?? "n/a"} reason=${sendErr.message}`
          : `reason=${sendErr instanceof Error ? sendErr.message : String(sendErr)}`;
      console.error(
        `[my-books-email] outcome=send-failed email=${normalizedEmail} sessions=${enriched.length} ${detail}`
      );
      return NextResponse.json({ error: "Failed to send email" }, { status: 500 });
    }

    console.log(
      `[my-books-email] outcome=sent email=${normalizedEmail} sessions=${enriched.length}`
    );
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error(
      `[my-books-email] outcome=unexpected-error reason=${err instanceof Error ? err.message : String(err)}`
    );
    return NextResponse.json({ error: "Failed to send email" }, { status: 500 });
  }
}
