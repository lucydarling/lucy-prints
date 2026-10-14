import { createHash } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase-server";

/**
 * One row in `email_sends` per email outcome (migration 014). The Photo Lab
 * monitor reads this table: the retrieval emails used to log only to Vercel,
 * which is how a five-month email outage went unnoticed.
 *
 * Never recorded: the address, the email body, or the resume token.
 */

export type EmailRoute =
  | "magic-link"
  | "my-books-email"
  | "print-order-received"
  | "print-order-held"
  | "print-order-shipped"
  | "alert";

/** lookup-* and unexpected-error mean no email was attempted (or it never got that far). */
export type EmailOutcome = "sent" | "send-failed" | "lookup-miss" | "lookup-error" | "unexpected-error";

export interface EmailSendInput {
  route: EmailRoute;
  outcome: EmailOutcome;
  sessionId?: string | null;
  resendId?: string | null;
  errorCode?: string | null;
  /** The recipient address. Only its hash is stored. */
  to?: string | null;
}

export interface EmailSendRow {
  route: EmailRoute;
  outcome: EmailOutcome;
  session_id: string | null;
  resend_id: string | null;
  error_code: string | null;
  recipient_hash: string | null;
  internal_recipient: boolean;
}

export const RECORD_TIMEOUT_MS = 3000;

/** sha256 of the lowercased, trimmed address. */
export function hashRecipient(address: string): string {
  return createHash("sha256").update(address.trim().toLowerCase()).digest("hex");
}

/** Tests and Kevin's alerts go to @lucydarling.com; the monitor keeps them apart from customers. */
export function isInternalRecipient(address: string): boolean {
  return /@lucydarling\.com$/i.test(address.trim());
}

export function buildEmailSendRow(input: EmailSendInput): EmailSendRow {
  const to = input.to?.trim() || null;
  return {
    route: input.route,
    outcome: input.outcome,
    session_id: input.sessionId ?? null,
    resend_id: input.resendId ?? null,
    error_code: input.errorCode ? input.errorCode.slice(0, 100) : null,
    recipient_hash: to ? hashRecipient(to) : null,
    internal_recipient: to ? isInternalRecipient(to) : false,
  };
}

export type InsertEmailSend = (row: EmailSendRow) => Promise<{ error: { message: string } | null }>;

const insertIntoSupabase: InsertEmailSend = async (row) => {
  if (!supabaseAdmin) return { error: { message: "Supabase is not configured in this environment" } };
  const { error } = await supabaseAdmin.from("email_sends").insert(row);
  return { error: error ? { message: error.message } : null };
};

/**
 * Record an outcome. NEVER throws and never blocks longer than `timeoutMs`:
 * a failed or slow insert is logged and the caller carries on, so recording
 * can never stop an email or change a response. Returns whether the row landed.
 */
export async function recordEmailSend(
  input: EmailSendInput,
  insert: InsertEmailSend = insertIntoSupabase,
  timeoutMs: number = RECORD_TIMEOUT_MS
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const row = buildEmailSendRow(input);
    const timeout = new Promise<{ error: { message: string } }>((resolve) => {
      timer = setTimeout(() => resolve({ error: { message: `timed out after ${timeoutMs}ms` } }), timeoutMs);
    });
    const { error } = await Promise.race([insert(row), timeout]);
    if (error) {
      console.error(`[email-sends] insert failed route=${input.route} outcome=${input.outcome} reason=${error.message}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(
      `[email-sends] insert failed route=${input.route} outcome=${input.outcome} reason=${err instanceof Error ? err.message : String(err)}`
    );
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
