import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

/**
 * Server-side Supabase client using the service_role key.
 * Use ONLY in API route handlers (src/app/api/).
 * Bypasses RLS — never expose to client.
 *
 * Will throw at request time (not build time) if env vars are missing.
 */
export const supabaseAdmin = supabaseUrl && supabaseServiceKey
  ? createClient(supabaseUrl, supabaseServiceKey)
  : (null as unknown as ReturnType<typeof createClient>);
