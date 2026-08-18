import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { sendMagicLinkEmail, EmailSendError } from "@/lib/email";
import {
  checkRateLimit,
  RATE_LIMITS,
  getClientIp,
  tooManyRequestsResponse,
} from "@/lib/rate-limit";

export async function POST(req: NextRequest) {
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

    // Look up session
    const { data: session } = await supabaseAdmin
      .from("sessions")
      .select("id, token, email, baby_name, photo_count, last_emailed_at")
      .eq("token", sessionToken)
      .eq("status", "active")
      .maybeSingle();

    if (!session) {
      console.warn(
        `[magic-link] outcome=lookup-miss token=${sessionToken} — no active session; no email attempted`
      );
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

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

    // Send magic link email
    try {
      await sendMagicLinkEmail({
        to: session.email,
        babyName: session.baby_name || undefined,
        token: session.token,
        photoCount: session.photo_count || 0,
      });
    } catch (sendErr) {
      const detail =
        sendErr instanceof EmailSendError
          ? `provider=${sendErr.providerName} status=${sendErr.providerStatus ?? "n/a"} reason=${sendErr.message}`
          : `reason=${sendErr instanceof Error ? sendErr.message : String(sendErr)}`;
      console.error(
        `[magic-link] outcome=send-failed token=${session.token} ${detail}`
      );
      // Do NOT stamp last_emailed_at — nothing was sent, so the 60s throttle
      // must not lock the customer out of retrying.
      return NextResponse.json({ error: "Failed to send email" }, { status: 500 });
    }

    console.log(`[magic-link] outcome=sent token=${session.token}`);

    // Update last emailed timestamp
    await supabaseAdmin
      .from("sessions")
      .update({ last_emailed_at: new Date().toISOString() })
      .eq("id", session.id);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Magic link error:", err);
    return NextResponse.json({ error: "Failed to send email" }, { status: 500 });
  }
}
