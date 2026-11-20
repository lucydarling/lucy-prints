/**
 * How this visit arrived: UTM params and the referrer HOST (never the full
 * URL), kept in sessionStorage on the first page load and sent once with the
 * save request. Host only, so no paths or query strings are ever stored.
 */
const KEY = "ld_entry_source";
const UTM = ["utm_source", "utm_medium", "utm_campaign", "utm_content"] as const;

export function captureEntrySource(): void {
  try {
    if (window.sessionStorage.getItem(KEY)) return;
    const params = new URLSearchParams(window.location.search);
    const entry: Record<string, string> = {};
    for (const k of UTM) {
      const v = params.get(k);
      if (v) entry[k] = v.slice(0, 100);
    }
    if (document.referrer) {
      try {
        const host = new URL(document.referrer).host;
        if (host && host !== window.location.host) entry.referrer_host = host.slice(0, 100);
      } catch {
        /* ignore */
      }
    }
    window.sessionStorage.setItem(KEY, JSON.stringify(entry));
  } catch {
    /* storage blocked: no entry source */
  }
}

export function getEntrySource(): Record<string, string> | undefined {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && Object.keys(parsed).length > 0 ? parsed : undefined;
  } catch {
    return undefined;
  }
}
