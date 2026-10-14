import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { sendMagicLinkEmail, EmailSendError } from "@/lib/email";
import { recordEmailSend } from "@/lib/email-sends";
import {
  checkRateLimit,
  RATE_LIMITS,
  getClientIp,
  tooManyRequestsResponse,
} from "@/lib/rate-limit";

// Logs carry the session id, never the resume token or the address.
export async function POST(req: NextRequest) {
  let sessionId: string | null = null;
  // Only requests that passed the per-IP limit are recorded, so junk requests can't fill email_sends.
  let pastRateLimit = false;
  try {
    const { sessionToken } = await req.json();

    if (!sessionToken) {
      return NextResponse.json({ error: "sessionToken required" }, { status: 400 });
    }

    // Per-IP cap on top of the existing 60s per-email throttle below — limits
    // how many magic-link emails one client can fan out across sessions.
    const rl = await checkRateLimit(getClientIp(req), RATE_LIMITS.magicLinkPerIp);
    if (!rl.success) {
      return tooManyRequestsResponse(rl.retryAfterSeconds);
    }
    pastRateLimit = true;

    // Look up session
    const { data: session, error: lookupError } = await supabaseAdmin
      .from("sessions")
      .select("id, token, email, baby_name, last_emailed_at")
      .eq("token", sessionToken)
      .eq("status", "active")
      .maybeSingle();

    if (lookupError) {
      // A failed query is NOT "no such session": never let a database outage
      // pass as a lookup miss.
      console.error(`[magic-link] outcome=lookup-error reason=${lookupError.message}`);
      await recordEmailSend({ route: "magic-link", outcome: "lookup-error" });
      return NextResponse.json({ error: "Failed to send email" }, { status: 500 });
    }

    if (!session) {
      console.warn(`[magic-link] outcome=lookup-miss — no active session for the token; no email attempted`);
      await recordEmailSend({ route: "magic-link", outcome: "lookup-miss" });
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    sessionId = session.id;

    // Rate limit: 1 email per 60 seconds
    if (session.last_emailed_at) {
      const lastSent = new Date(session.last_emailed_at).getTime();
      const now = Date.now();
      if (now - lastSent < 60_000) {
        return NextResponse.json(
          { error: "Please wait before requesting another email" },
          { status: 429 }
        );
      }
    }

    // Send magic link email (sendEmail records sent / send-failed in email_sends)
    try {
      await sendMagicLinkEmail({
        to: session.email,
        babyName: session.baby_name || undefined,
        token: session.token,
        sessionId: session.id,
      });
    } catch (sendErr) {
      const detail =
        sendErr instanceof EmailSendError
          ? `provider=${sendErr.providerName} status=${sendErr.providerStatus ?? "n/a"} reason=${sendErr.message}`
          : `reason=${sendErr instanceof Error ? sendErr.message : String(sendErr)}`;
      console.error(
        `[magic-link] outcome=send-failed session=${session.id} ${detail}`
      );
      // Do NOT stamp last_emailed_at — nothing was sent, so the 60s throttle
      // must not lock the customer out of retrying.
      return NextResponse.json({ error: "Failed to send email" }, { status: 500 });
    }

    console.log(`[magic-link] outcome=sent session=${session.id}`);

    // Update last emailed timestamp
    await supabaseAdmin
      .from("sessions")
      .update({ last_emailed_at: new Date().toISOString() })
      .eq("id", session.id);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error(
      `[magic-link] outcome=unexpected-error session=${sessionId ?? "n/a"} reason=${err instanceof Error ? err.message : String(err)}`
    );
    if (pastRateLimit) await recordEmailSend({ route: "magic-link", outcome: "unexpected-error", sessionId });
    return NextResponse.json({ error: "Failed to send email" }, { status: 500 });
  }
}
