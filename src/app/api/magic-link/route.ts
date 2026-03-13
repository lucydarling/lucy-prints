import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { sendMagicLinkEmail } from "@/lib/email";

export async function POST(req: NextRequest) {
  try {
    const { sessionToken } = await req.json();

    if (!sessionToken) {
      return NextResponse.json({ error: "sessionToken required" }, { status: 400 });
    }

    // Look up session
    const { data: session } = await supabaseAdmin
      .from("sessions")
      .select("id, token, email, baby_name, photo_count, last_emailed_at")
      .eq("token", sessionToken)
      .eq("status", "active")
      .maybeSingle();

    if (!session) {
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
    await sendMagicLinkEmail({
      to: session.email,
      babyName: session.baby_name || undefined,
      token: session.token,
      photoCount: session.photo_count || 0,
    });

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
