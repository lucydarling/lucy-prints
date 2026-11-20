import type { UsageEvent } from "@/lib/usage-events";

/**
 * Fire-and-forget usage event. Never throws, never awaited by callers, never
 * blocks the download or checkout: a failed request is simply lost.
 */
export function trackEvent(sessionToken: string | null | undefined, event: UsageEvent, props: Record<string, unknown> = {}): void {
  try {
    if (!sessionToken || typeof window === "undefined") return;
    const url = `/api/sessions/${sessionToken}/events`;
    const body = JSON.stringify({ event, props });
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      if (navigator.sendBeacon(url, new Blob([body], { type: "application/json" }))) return;
    }
    void fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
  } catch {
    /* swallow */
  }
}

/** Per-browser download counter for one session (a convenience; analysis counts rows). */
export function nextDownloadNumber(sessionToken: string): number {
  try {
    const key = `ld_dl_count:${sessionToken}`;
    const n = (parseInt(window.localStorage.getItem(key) ?? "0", 10) || 0) + 1;
    window.localStorage.setItem(key, String(n));
    return n;
  } catch {
    return 1;
  }
}
