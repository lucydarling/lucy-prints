import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { sendMyBooksEmail, EmailSendError } from "@/lib/email";
import { hashRecipient, recordEmailSend } from "@/lib/email-sends";
import { BOOK_THEMES, getSlots } from "@/lib/photo-slots";
import { isThemeAllowed } from "@/lib/preview-gate";
import { printButtonAllowed } from "@/lib/print-orders/print-gate";
import { printedCounts } from "@/lib/print-orders/ordered";
import {
  checkRateLimits,
  RATE_LIMITS,
  getClientIp,
  tooManyRequestsResponse,
} from "@/lib/rate-limit";

// Logs carry session ids (or a short recipient hash when there is no session),
// never the address or a resume token. The hash prefix matches
// email_sends.recipient_hash.
const recipientRef = (email: string) => hashRecipient(email).slice(0, 12);

export async function POST(req: NextRequest) {
  // Only requests that passed the rate limits are recorded, so junk requests can't fill email_sends.
  let pastRateLimit = false;
  let to: string | null = null;
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
    pastRateLimit = true;
    to = normalizedEmail;

    const { data: allSessions, error: lookupError } = await supabaseAdmin
      .from("sessions")
      .select("id, token, book_theme, baby_name, photo_count")
      .eq("email", normalizedEmail)
      .eq("status", "active")
      .order("last_activity_at", { ascending: false, nullsFirst: false });

    if (lookupError) {
      // A failed query is NOT the same as "no books" — never let a database
      // outage masquerade as an empty result and return a silent 200.
      console.error(
        `[my-books-email] outcome=lookup-error recipient=${recipientRef(normalizedEmail)} reason=${lookupError.message}`
      );
      await recordEmailSend({ route: "my-books-email", outcome: "lookup-error", to: normalizedEmail });
      return NextResponse.json({ error: "Failed to send email" }, { status: 500 });
    }

    // A hidden book (the journal, until it's public) is left out unless this
    // browser has unlocked it.
    const cookie = req.cookies;
    const sessions = (allSessions ?? []).filter((s) => isThemeAllowed(s.book_theme, cookie));

    // Always return 200 — don't reveal whether email exists.
    // Logged distinctly so a lookup miss is never confused with a send failure.
    if (sessions.length === 0) {
      console.warn(
        `[my-books-email] outcome=lookup-miss recipient=${recipientRef(normalizedEmail)} — no active session; no email attempted`
      );
      await recordEmailSend({ route: "my-books-email", outcome: "lookup-miss", to: normalizedEmail });
      return NextResponse.json({ success: true });
    }

    const sessionIds = sessions.map((s) => s.id as string).join(",");

    // "X of 49 printed" only while print ordering is on for this browser.
    const printed = printButtonAllowed(cookie) ? await printedCounts(sessions.map((s) => s.id as string)) : new Map<string, number>();
    const enriched = sessions.map((s) => {
      const theme = BOOK_THEMES.find((t) => t.id === s.book_theme);
      return {
        token: s.token,
        themeName: theme?.name ?? s.book_theme,
        babyName: s.baby_name as string | null,
        photoCount: s.photo_count || 0,
        printedSoFar: printed.get(s.id as string),
        bookSlots: getSlots(s.book_theme).length,
      };
    });

    try {
      // sendEmail records sent / send-failed in email_sends.
      await sendMyBooksEmail({
        to: normalizedEmail,
        sessions: enriched,
        sessionId: sessions.length === 1 ? (sessions[0].id as string) : null,
      });
    } catch (sendErr) {
      // Distinct from lookup-miss above: the session WAS found and the send
      // was rejected. Log the provider's own reason verbatim — a generic
      // "failed to send" is what hid the unverified-domain 403 for weeks.
      const detail =
        sendErr instanceof EmailSendError
          ? `provider=${sendErr.providerName} status=${sendErr.providerStatus ?? "n/a"} reason=${sendErr.message}`
          : `reason=${sendErr instanceof Error ? sendErr.message : String(sendErr)}`;
      console.error(
        `[my-books-email] outcome=send-failed sessions=${sessionIds} ${detail}`
      );
      return NextResponse.json({ error: "Failed to send email" }, { status: 500 });
    }

    console.log(
      `[my-books-email] outcome=sent sessions=${sessionIds}`
    );
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error(
      `[my-books-email] outcome=unexpected-error reason=${err instanceof Error ? err.message : String(err)}`
    );
    if (pastRateLimit) await recordEmailSend({ route: "my-books-email", outcome: "unexpected-error", to });
    return NextResponse.json({ error: "Failed to send email" }, { status: 500 });
  }
}
