import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { generateSessionToken } from "@/lib/tokens";
import { BOOK_THEMES } from "@/lib/photo-slots";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { email, babyName, babyBirthdate, phone, smsOptIn, bookTheme } = body;

    // Validate required fields
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "Valid email required" }, { status: 400 });
    }
    if (!bookTheme || !BOOK_THEMES.some((t) => t.id === bookTheme)) {
      return NextResponse.json({ error: "Valid book theme required" }, { status: 400 });
    }

    // Check for existing session with same email + theme
    const { data: existing } = await supabaseAdmin
      .from("sessions")
      .select("id, token, photo_count")
      .eq("email", email.toLowerCase().trim())
      .eq("book_theme", bookTheme)
      .eq("status", "active")
      .maybeSingle();

    if (existing) {
      // Update baby info and touch last_activity_at
      await supabaseAdmin
        .from("sessions")
        .update({
          baby_name: babyName || undefined,
          baby_birthdate: babyBirthdate || undefined,
          phone: phone || undefined,
          sms_opt_in: smsOptIn || false,
          last_activity_at: new Date().toISOString(),
        })
        .eq("id", existing.id);

      return NextResponse.json({
        token: existing.token,
        sessionId: existing.id,
        isExisting: true,
        photoCount: existing.photo_count,
      });
    }

    // Create new session
    const token = generateSessionToken();

    const { data: session, error } = await supabaseAdmin
      .from("sessions")
      .insert({
        token,
        email: email.toLowerCase().trim(),
        baby_name: babyName || null,
        baby_birthdate: babyBirthdate || null,
        phone: phone || null,
        sms_opt_in: smsOptIn || false,
        book_theme: bookTheme,
        last_activity_at: new Date().toISOString(),
      })
      .select("id, token")
      .single();

    if (error) {
      console.error("Session creation error:", error);
      return NextResponse.json({ error: "Failed to create session" }, { status: 500 });
    }

    return NextResponse.json({
      token: session.token,
      sessionId: session.id,
      isExisting: false,
      photoCount: 0,
    });
  } catch (err) {
    console.error("Session API error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
