import { loadPrintRoundProperties } from "./round-reminders";
import { setProfileProperties } from "@/lib/klaviyo";
import { printButtonAllowed, printOrdersEnabled, type CookieJar } from "./print-gate";

/**
 * Pushes the round-reminder properties for one saved memory book to Klaviyo.
 * Allowed only when print ordering is on for the caller: the global flag, or
 * (request routes only) a valid preview cookie. With neither, this does
 * nothing at all, so flag-off customers' profiles never change. Never throws.
 */
export async function syncPrintRoundReminders(
  sessionId: string,
  gate: { jar: CookieJar } | { flagOnly: true }
): Promise<void> {
  try {
    const allowed = "jar" in gate ? printButtonAllowed(gate.jar) : printOrdersEnabled();
    if (!allowed) return;
    const loaded = await loadPrintRoundProperties(sessionId);
    if (!loaded) return;
    await setProfileProperties(loaded.email, loaded.properties as unknown as Record<string, unknown>);
  } catch (err) {
    console.error("print round reminder sync failed:", err);
  }
}
