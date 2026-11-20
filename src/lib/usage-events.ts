/**
 * First-party usage events (table photo_lab_events). Shared by the events
 * route and the tests. Nothing here stores personal data: only a fixed
 * allow-list of event names, each with a fixed allow-list of small props.
 */
export const USAGE_EVENTS = [
  "zip_downloaded",
  "session_started",
  "print_price_shown",
  "print_confirm_cancelled",
] as const;
export type UsageEvent = (typeof USAGE_EVENTS)[number];

/** Events that only exist while print ordering is on for the caller. */
export const PRINT_FUNNEL_EVENTS: readonly UsageEvent[] = ["print_price_shown", "print_confirm_cancelled"];

export const PRINT_OPTIONS = ["as-is", "pad-3x3-to-4x4", "all-on-4x6"] as const;
const BOOK_PRODUCTS = ["memory_book", "pregnancy_journal", "little_years"] as const;

type Spec = { kind: "int" } | { kind: "enum"; values: readonly string[] } | { kind: "str"; max: number };
const PROP_SPECS: Record<UsageEvent, Record<string, Spec>> = {
  zip_downloaded: {
    photo_count: { kind: "int" },
    extras_count: { kind: "int" },
    print_option: { kind: "enum", values: PRINT_OPTIONS },
    book_product: { kind: "enum", values: BOOK_PRODUCTS },
    download_number: { kind: "int" },
  },
  session_started: {
    utm_source: { kind: "str", max: 100 },
    utm_medium: { kind: "str", max: 100 },
    utm_campaign: { kind: "str", max: 100 },
    utm_content: { kind: "str", max: 100 },
    referrer_host: { kind: "str", max: 100 },
  },
  print_price_shown: {
    print_count: { kind: "int" },
    prints_cents: { kind: "int" },
    shipping_cents: { kind: "int" },
  },
  print_confirm_cancelled: {},
};

export function isUsageEvent(name: unknown): name is UsageEvent {
  return typeof name === "string" && (USAGE_EVENTS as readonly string[]).includes(name);
}

/** Keep only the known props for this event, with the right types. Unknown or malformed values are dropped. */
export function sanitizeProps(event: UsageEvent, raw: unknown): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  const src = raw as Record<string, unknown>;
  for (const [key, spec] of Object.entries(PROP_SPECS[event])) {
    const v = src[key];
    if (spec.kind === "int" && typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 1_000_000) out[key] = v;
    else if (spec.kind === "enum" && typeof v === "string" && spec.values.includes(v)) out[key] = v;
    else if (spec.kind === "str" && typeof v === "string" && v.trim()) out[key] = v.trim().slice(0, spec.max);
  }
  return out;
}
