import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;

    // Look up session
    const { data: session } = await supabaseAdmin
      .from("sessions")
      .select("id, token, email, baby_name, baby_birthdate, book_theme, photo_count, created_at, last_activity_at")
      .eq("token", token)
      .eq("status", "active")
      .maybeSingle();

    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    // Inactivity-based expiration: 2 years since last activity.
    // This app is a companion for Baby's First Year memory books — sessions can
    // span years as moms add birthday and school photos over time. We expire
    // only after a long period of no activity, not from the creation date.
    const EXPIRY_DAYS = 730; // 2 years
    const lastActivity = new Date(session.last_activity_at || session.created_at);
    const daysSinceActivity = (Date.now() - lastActivity.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceActivity > EXPIRY_DAYS) {
      await supabaseAdmin
        .from("sessions")
        .update({ status: "expired" })
        .eq("id", session.id);
      return NextResponse.json(
        { error: "This session has expired due to inactivity. Please start a new upload." },
        { status: 410 }
      );
    }

    // Touch last_activity_at — this session is being actively used
    await supabaseAdmin
      .from("sessions")
      .update({ last_activity_at: new Date().toISOString() })
      .eq("id", session.id);

    // Fetch all photos for this session
    const { data: photoRows } = await supabaseAdmin
      .from("session_photos")
      .select("slot_key, storage_path, custom_label, milestone_date, print_size, status")
      .eq("session_id", session.id);

    // Fetch extras
    const { data: extraRows } = await supabaseAdmin
      .from("session_extras")
      .select("extra_id, print_size, storage_path, quantity")
      .eq("session_id", session.id);

    // Generate signed URLs for each photo (valid 1 hour)
    const photos: Record<string, {
      signedUrl: string;
      customLabel: string | null;
      milestoneDate: string | null;
      printSize: string;
      status: string;
    }> = {};

    if (photoRows) {
      for (const row of photoRows) {
        const { data: signedData } = await supabaseAdmin.storage
          .from("photos")
          .createSignedUrl(row.storage_path, 3600);

        if (signedData?.signedUrl) {
          photos[row.slot_key] = {
            signedUrl: signedData.signedUrl,
            customLabel: row.custom_label,
            milestoneDate: row.milestone_date,
            printSize: row.print_size,
            status: row.status,
          };
        }
      }
    }

    const extras: Array<{
      extraId: string;
      printSize: string;
      signedUrl: string | null;
      quantity: number;
    }> = [];

    if (extraRows) {
      for (const row of extraRows) {
        let signedUrl: string | null = null;
        if (row.storage_path) {
          const { data: signedData } = await supabaseAdmin.storage
            .from("photos")
            .createSignedUrl(row.storage_path, 3600);
          signedUrl = signedData?.signedUrl || null;
        }
        extras.push({
          extraId: row.extra_id,
          printSize: row.print_size,
          signedUrl,
          quantity: row.quantity,
        });
      }
    }

    return NextResponse.json({
      session: {
        token: session.token,
        email: session.email,
        babyName: session.baby_name,
        bookTheme: session.book_theme,
        photoCount: session.photo_count,
      },
      photos,
      extras,
    });
  } catch (err) {
    console.error("Load session error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
