import { supabaseAdmin } from "@/lib/supabase-server";

/** Download one object from the photos bucket. Read-only. */
export async function downloadPhoto(storagePath: string): Promise<Buffer> {
  const { data, error } = await supabaseAdmin.storage.from("photos").download(storagePath);
  if (error || !data) throw new Error(`download failed: ${error?.message ?? "no data"}`);
  return Buffer.from(await data.arrayBuffer());
}
