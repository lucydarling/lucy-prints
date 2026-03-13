import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { generateSessionToken } from "@/lib/tokens";
import { BOOK_THEMES } from "@/lib/photo-slots";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { email, babyName, babyBirthdate, phone, smsOptIn, bookTheme, notes, detailsMode } = body;

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
      // Update baby info — last_activity_at and other added columns are set
      // only if PostgREST schema cache knows about them (graceful degradation).
      const updateData: Record<string, unknown> = {};
      if (babyName !== undefined) updateData.baby_name = babyName || null;
      if (babyBirthdate !== undefined) updateData.baby_birthdate = babyBirthdate || null;
      if (phone !== undefined) updateData.phone = phone || null;
      if (smsOptIn !== undefined) updateData.sms_opt_in = smsOptIn;
      if (notes !== undefined) updateData.notes = notes;
      if (detailsMode !== undefined) updateData.details_mode = detailsMode;
      updateData.last_activity_at = new Date().toISOString();

      // Non-critical — don't let update failure block the response
      try {
        await supabaseAdmin
          .from("sessions")
          .update(updateData)
          .eq("id", existing.id);
      } catch {
        // Schema cache may be stale — session still works
      }

      return NextResponse.json({
        token: existing.token,
        sessionId: existing.id,
        isExisting: true,
        photoCount: existing.photo_count,
      });
    }

    // Create new session
    const token = generateSessionToken();

    const insertData: Record<string, unknown> = {
      token,
      email: email.toLowerCase().trim(),
      baby_name: babyName || null,
      baby_birthdate: babyBirthdate || null,
      phone: phone || null,
      sms_opt_in: smsOptIn || false,
      book_theme: bookTheme,
      // last_activity_at omitted — DEFAULT NOW() in database handles it
    };
    // Only include notes/details_mode if non-default — gracefully handles
    // databases where migration 003 hasn't been applied yet.
    if (notes && Object.keys(notes).length > 0) insertData.notes = notes;
    if (detailsMode) insertData.details_mode = detailsMode;

    const { data: session, error } = await supabaseAdmin
      .from("sessions")
      .insert(insertData)
      .select("id, token")
      .single();

    if (error) {
      console.error("Session creation error:", error);
      return NextResponse.json(
        { error: `Failed to create session: ${error.message}` },
        { status: 500 }
      );
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
