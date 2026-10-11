import { sendPrintOrderAlert } from "@/lib/email";
import { claimOnce } from "@/lib/rate-limit";

export const UPLOAD_CHECK_ALERT_KEY = "alert:upload-check-skipped";
export const UPLOAD_CHECK_ALERT_TTL_SECONDS = 3600;

export interface UploadCheckAlertDeps {
  claim: (key: string, ttlSeconds: number) => Promise<boolean>;
  send: typeof sendPrintOrderAlert;
}
const realDeps: UploadCheckAlertDeps = { claim: claimOnce, send: sendPrintOrderAlert };

/**
 * The upload size check could not run, so an upload was accepted unchecked.
 * Logs every time; emails Kevin at most once an hour. Never throws — the
 * customer's upload must not fail because the alert did.
 */
export async function reportUploadCheckSkipped(
  reason: string,
  context: { sessionId: string; slotKey: string },
  deps: UploadCheckAlertDeps = realDeps
): Promise<"alerted" | "throttled" | "alert-failed"> {
  console.error(`[upload-check] size check skipped (upload accepted unchecked): ${reason}`, context);
  try {
    if (!(await deps.claim(UPLOAD_CHECK_ALERT_KEY, UPLOAD_CHECK_ALERT_TTL_SECONDS))) return "throttled";
    await deps.send({
      status: "upload-check",
      shopifyOrderId: "n/a",
      reasons: [
        reason,
        `First affected upload: session ${context.sessionId}, slot ${context.slotKey}.`,
        "Uploads are being ACCEPTED without the size/damage check until this is fixed. At most one of these emails is sent per hour.",
      ],
    });
    return "alerted";
  } catch (err) {
    console.error("[upload-check] alert failed:", err);
    return "alert-failed";
  }
}
