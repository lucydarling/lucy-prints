import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const sessionToken = formData.get("sessionToken") as string;
    const slotKey = formData.get("slotKey") as string;
    const imageFile = formData.get("image") as File;
    const customLabel = formData.get("customLabel") as string | null;
    const milestoneDate = formData.get("milestoneDate") as string | null;
    const printSize = formData.get("printSize") as string | null;
    const isExtra = formData.get("isExtra") === "true";
    const extraId = formData.get("extraId") as string | null;

    if (!sessionToken || !slotKey || !imageFile) {
      return NextResponse.json(
        { error: "sessionToken, slotKey, and image are required" },
        { status: 400 }
      );
    }

    // Look up session
    const { data: session } = await supabaseAdmin
      .from("sessions")
      .select("id")
      .eq("token", sessionToken)
      .eq("status", "active")
      .maybeSingle();

    if (!session) {
      return NextResponse.json({ error: "Invalid or expired session" }, { status: 404 });
    }

    // Convert File to buffer for Supabase Storage
    const arrayBuffer = await imageFile.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Upload to Supabase Storage
    const storagePath = isExtra
      ? `${session.id}/extras/${extraId || slotKey}.jpg`
      : `${session.id}/${slotKey}.jpg`;

    const { error: uploadError } = await supabaseAdmin.storage
      .from("photos")
      .upload(storagePath, buffer, {
        contentType: "image/jpeg",
        upsert: true,
      });

    if (uploadError) {
      console.error("Storage upload error:", uploadError);
      return NextResponse.json({ error: "Failed to upload photo" }, { status: 500 });
    }

    // Upsert photo record in database
    if (isExtra) {
      const { error: dbError } = await supabaseAdmin
        .from("session_extras")
        .upsert(
          {
            session_id: session.id,
            extra_id: extraId || slotKey,
            print_size: printSize || "4x4",
            storage_path: storagePath,
          },
          { onConflict: "session_id,extra_id" }
        );

      if (dbError) {
        console.error("DB upsert error (extras):", dbError);
      }
    } else {
      const { error: dbError } = await supabaseAdmin
        .from("session_photos")
        .upsert(
          {
            session_id: session.id,
            slot_key: slotKey,
            storage_path: storagePath,
            custom_label: customLabel || null,
            milestone_date: milestoneDate || null,
            print_size: printSize || "4x4",
            status: "cropped",
          },
          { onConflict: "session_id,slot_key" }
        );

      if (dbError) {
        console.error("DB upsert error:", dbError);
      }
    }

    // Update photo count on session
    const { count } = await supabaseAdmin
      .from("session_photos")
      .select("*", { count: "exact", head: true })
      .eq("session_id", session.id);

    await supabaseAdmin
      .from("sessions")
      .update({ photo_count: count || 0 })
      .eq("id", session.id);

    return NextResponse.json({ success: true, storagePath });
  } catch (err) {
    console.error("Photo upload error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
