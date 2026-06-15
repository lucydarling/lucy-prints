import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { PHOTO_SLOTS } from "@/lib/photo-slots";
import {
  checkRateLimit,
  RATE_LIMITS,
  tooManyRequestsResponse,
} from "@/lib/rate-limit";

export const maxDuration = 30;

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024; // 15 MB

// The 48 fixed book slots — a known, closed set used as a strict allowlist.
const SLOT_KEYS = new Set<string>(PHOTO_SLOTS.map((s) => s.key));

/**
 * Sniff the leading bytes to confirm the file is actually an image we accept,
 * not just something with an image/* content-type header. Returns the detected
 * MIME type, or null if the magic bytes don't match JPEG / PNG / WebP.
 */
function sniffImageType(bytes: Uint8Array): string | null {
  // JPEG: FF D8 FF
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  // PNG: 89 50 4E 47
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "image/png";
  }
  // WebP: "RIFF" .... "WEBP"
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && // R
    bytes[1] === 0x49 && // I
    bytes[2] === 0x46 && // F
    bytes[3] === 0x46 && // F
    bytes[8] === 0x57 && // W
    bytes[9] === 0x45 && // E
    bytes[10] === 0x42 && // B
    bytes[11] === 0x50 // P
  ) {
    return "image/webp";
  }
  return null;
}

const EXT_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

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

    // Rate limit per session token before any heavy work (storage + DB).
    const rl = await checkRateLimit(sessionToken, RATE_LIMITS.upload);
    if (!rl.success) {
      return tooManyRequestsResponse(rl.retryAfterSeconds);
    }

    // Validate slotKey / extraId before they're used to build a storage path,
    // so a caller can't write arbitrary objects (path traversal) or pollute
    // the bucket with unknown keys.
    if (isExtra) {
      // Extras are created client-side with ids shaped `extra_<ts>_<rand>`.
      // They aren't in a fixed allowlist, so enforce the namespace + a safe
      // charset (no slashes, dots, or `..`) on the key used in the path.
      const extraKey = extraId || slotKey;
      if (!extraKey || !/^extra_[a-z0-9_]+$/i.test(extraKey)) {
        return NextResponse.json({ error: "Invalid extra id" }, { status: 400 });
      }
    } else if (!SLOT_KEYS.has(slotKey)) {
      // The 48 book slots are a fixed, known set — strict allowlist.
      return NextResponse.json({ error: "Unknown slot" }, { status: 400 });
    }

    // Validate the uploaded file: size, declared type, and actual magic bytes.
    if (imageFile.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { error: "Image too large (max 15 MB)" },
        { status: 400 }
      );
    }
    if (!imageFile.type || !imageFile.type.startsWith("image/")) {
      return NextResponse.json(
        { error: "File must be an image" },
        { status: 400 }
      );
    }

    // Convert File to buffer for Supabase Storage
    const arrayBuffer = await imageFile.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Magic-byte sniff — confirm the bytes really are JPEG/PNG/WebP, not just a
    // file with an image/* content-type header.
    const detectedType = sniffImageType(buffer.subarray(0, 12));
    if (!detectedType) {
      return NextResponse.json(
        { error: "Unsupported image format (must be JPEG, PNG, or WebP)" },
        { status: 400 }
      );
    }
    const ext = EXT_BY_TYPE[detectedType];

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

    // Upload to Supabase Storage
    const storagePath = isExtra
      ? `${session.id}/extras/${extraId || slotKey}.${ext}`
      : `${session.id}/${slotKey}.${ext}`;

    const { error: uploadError } = await supabaseAdmin.storage
      .from("photos")
      .upload(storagePath, buffer, {
        contentType: detectedType,
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
        return NextResponse.json({ error: "Failed to save photo record" }, { status: 500 });
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
        return NextResponse.json({ error: "Failed to save photo record" }, { status: 500 });
      }
    }

    // photo_count is maintained automatically by the session_photos_count_sync
    // trigger (migration 004) — no manual recompute needed here. We only touch
    // last_activity_at to keep the session's inactivity-expiry clock fresh.
    await supabaseAdmin
      .from("sessions")
      .update({ last_activity_at: new Date().toISOString() })
      .eq("id", session.id);

    return NextResponse.json({ success: true, storagePath });
  } catch (err) {
    console.error("Photo upload error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
