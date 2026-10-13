import { supabaseAdmin } from "@/lib/supabase-server";
import { loadSessionExtras } from "@/lib/session-extras";
import type { SessionExtraRow, SessionPhotoRow } from "./build-order";

/** Server-side only. Read-only on production data. */
export async function loadSessionForPrint(token: string) {
  const { data: session, error } = await supabaseAdmin
    .from("sessions")
    .select("id, token, email, book_theme, baby_name, status")
    .eq("token", token)
    .maybeSingle();
  if (error || !session) throw new Error(`Session not found for token ${token.slice(0, 6)}…`);

  const { data: photoRows } = await supabaseAdmin
    .from("session_photos")
    .select("slot_key, storage_path, print_size, status")
    .eq("session_id", session.id);
  // Each duplicate copy once (see lib/collapse-extras.ts), as checkout counted them.
  const { data: extraRows } = await loadSessionExtras(session.id);

  const fetchImage = async (storagePath: string): Promise<Buffer> => {
    const { data, error: dlError } = await supabaseAdmin.storage.from("photos").download(storagePath);
    if (dlError || !data) throw new Error(`download failed: ${dlError?.message ?? "no data"}`);
    return Buffer.from(await data.arrayBuffer());
  };

  return {
    session: session as { id: string; token: string; email: string; book_theme: string; baby_name: string | null; status: string },
    photoRows: (photoRows ?? []) as SessionPhotoRow[],
    extraRows: (extraRows ?? []) as SessionExtraRow[],
    fetchImage,
  };
}
