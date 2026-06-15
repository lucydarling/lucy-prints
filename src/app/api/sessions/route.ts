import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { generateSessionToken } from "@/lib/tokens";
import { BOOK_THEMES } from "@/lib/photo-slots";
import { syncProfileToKlaviyo, trackPhotoAppSignup, subscribeToEmailList } from "@/lib/klaviyo";
import {
  checkRateLimit,
  RATE_LIMITS,
  getClientIp,
  tooManyRequestsResponse,
} from "@/lib/rate-limit";

export async function POST(req: NextRequest) {
  try {
    // Rate limit per IP — session creation is unauthenticated.
    const rl = await checkRateLimit(getClientIp(req), RATE_LIMITS.sessions);
    if (!rl.success) {
      return tooManyRequestsResponse(rl.retryAfterSeconds);
    }

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
      // Update baby info + refresh the activity timestamp.
      const updateData: Record<string, unknown> = {};
      if (babyName !== undefined) updateData.baby_name = babyName || null;
      if (babyBirthdate !== undefined) updateData.baby_birthdate = babyBirthdate || null;
      if (phone !== undefined) updateData.phone = phone || null;
      if (smsOptIn !== undefined) updateData.sms_opt_in = smsOptIn;
      if (notes !== undefined) updateData.notes = notes;
      if (detailsMode !== undefined) updateData.details_mode = detailsMode;
      updateData.last_activity_at = new Date().toISOString();

      // Non-critical to the response — log a failure but still return the token.
      const { error: updateError } = await supabaseAdmin
        .from("sessions")
        .update(updateData)
        .eq("id", existing.id);
      if (updateError) {
        console.error("Session update error (existing):", updateError);
      }

      // Sync updated profile to Klaviyo (fire-and-forget)
      syncProfileToKlaviyo({
        email,
        babyName,
        babyBirthdate,
        phone,
        smsOptIn,
        bookTheme,
      }).catch(() => {});

      // Ensure they're on the milestone reminder list
      subscribeToEmailList(email).catch(() => {});

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
    // Only include notes/details_mode when non-default to keep the insert lean.
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

    // Sync new profile to Klaviyo and fire signup event (fire-and-forget)
    syncProfileToKlaviyo({
      email,
      babyName,
      babyBirthdate,
      phone,
      smsOptIn,
      bookTheme,
    }).catch(() => {});

    // Add to the milestone reminder email list
    subscribeToEmailList(email).catch(() => {});

    // Fire the "Photo App Signup" event only when we have a birthdate —
    // this is what triggers the monthly milestone reminder flow in Klaviyo.
    if (babyBirthdate) {
      trackPhotoAppSignup({
        email,
        babyName,
        babyBirthdate,
        phone,
        smsOptIn,
        bookTheme,
        sessionToken: session.token,
      }).catch(() => {});
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
