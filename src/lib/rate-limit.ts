/**
 * Shared rate limiter backed by Vercel KV (Upstash Redis).
 *
 * Design goals:
 *  - FAIL OPEN. Rate limiting is a guardrail, not a gate. If KV credentials are
 *    missing or a Redis call throws, we log once and ALLOW the request. A limiter
 *    outage must never take down uploads or email.
 *  - Explicit client construction from the KV_ prefixed env vars. The Vercel KV
 *    integration provisions KV_REST_API_URL / KV_REST_API_TOKEN, NOT the
 *    UPSTASH_REDIS_REST_* names that Redis.fromEnv() looks for — so fromEnv()
 *    would silently find nothing. We pass url/token in by hand.
 *  - One shared helper + a registry of named sliding-window rules so every write
 *    route limits the same way.
 */
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

type Duration = Parameters<typeof Ratelimit.slidingWindow>[1];

export interface RateLimitRule {
  /** Max requests allowed within the window. */
  limit: number;
  /** Sliding window, e.g. "60 s" or "10 m". */
  window: Duration;
  /** Redis key prefix — keeps each rule's counters isolated. */
  prefix: string;
}

export interface RateLimitResult {
  success: boolean;
  /** Seconds until the window resets — surfaced as the Retry-After header. */
  retryAfterSeconds: number;
}

/**
 * Named sliding-window limiters. Tune limits only with a documented reason.
 */
export const RATE_LIMITS = {
  // 60 uploads/min per session token — generous; a full 49-slot book plus
  // re-crops and extras fits comfortably, but scripted abuse trips quickly.
  upload: { limit: 60, window: "60 s", prefix: "rl:upload" },
  // 20 session creates/min per IP — well above a human filling a form.
  sessions: { limit: 20, window: "60 s", prefix: "rl:sessions" },
  // 30 sibling lookups/min per token — UI polls this on resume.
  siblings: { limit: 30, window: "60 s", prefix: "rl:siblings" },
  // Email spam is the abuse vector → tight per-email, looser per-IP.
  myBooksEmailPerEmail: { limit: 3, window: "10 m", prefix: "rl:mybooks:email" },
  myBooksEmailPerIp: { limit: 10, window: "10 m", prefix: "rl:mybooks:ip" },
  // magic-link keeps its existing 60s per-email throttle; this caps per-IP fan-out.
  magicLinkPerIp: { limit: 5, window: "10 m", prefix: "rl:magic:ip" },
} as const satisfies Record<string, RateLimitRule>;

// ---------------------------------------------------------------------------
// Lazy, fail-open Redis + limiter construction
// ---------------------------------------------------------------------------
let redis: Redis | null = null;
let redisInitFailed = false;
let warnedMissingCreds = false;

function getRedis(): Redis | null {
  if (redis) return redis;
  if (redisInitFailed) return null;

  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    if (!warnedMissingCreds) {
      console.warn(
        "[rate-limit] KV_REST_API_URL/KV_REST_API_TOKEN not set — rate limiting disabled (fail-open)."
      );
      warnedMissingCreds = true;
    }
    redisInitFailed = true;
    return null;
  }

  try {
    redis = new Redis({ url, token });
    return redis;
  } catch (err) {
    console.error("[rate-limit] Redis init failed — rate limiting disabled (fail-open).", err);
    redisInitFailed = true;
    return null;
  }
}

// Memoize one Ratelimit instance per rule prefix.
const limiterCache = new Map<string, Ratelimit>();

function getLimiter(rule: RateLimitRule): Ratelimit | null {
  const client = getRedis();
  if (!client) return null;

  const cached = limiterCache.get(rule.prefix);
  if (cached) return cached;

  const limiter = new Ratelimit({
    redis: client,
    limiter: Ratelimit.slidingWindow(rule.limit, rule.window),
    prefix: rule.prefix,
    analytics: false,
  });
  limiterCache.set(rule.prefix, limiter);
  return limiter;
}

/**
 * Check one identifier against one rule. Always resolves — on any failure
 * (no creds, Redis throws) it returns `{ success: true }` so the caller proceeds.
 */
export async function checkRateLimit(
  identifier: string,
  rule: RateLimitRule
): Promise<RateLimitResult> {
  const limiter = getLimiter(rule);
  if (!limiter) return { success: true, retryAfterSeconds: 0 };

  try {
    const { success, reset } = await limiter.limit(identifier);
    const retryAfterSeconds = Math.max(0, Math.ceil((reset - Date.now()) / 1000));
    return { success, retryAfterSeconds };
  } catch (err) {
    console.error("[rate-limit] limiter error — allowing request (fail-open).", err);
    return { success: true, retryAfterSeconds: 0 };
  }
}

/**
 * Check several identifier/rule pairs at once. Blocks if ANY trip; the returned
 * Retry-After is the longest of the tripped windows. Used by the email routes,
 * which key on both email and IP.
 */
export async function checkRateLimits(
  checks: Array<{ identifier: string; rule: RateLimitRule }>
): Promise<RateLimitResult> {
  const results = await Promise.all(
    checks.map(({ identifier, rule }) => checkRateLimit(identifier, rule))
  );
  const blocked = results.filter((r) => !r.success);
  if (blocked.length === 0) return { success: true, retryAfterSeconds: 0 };
  return {
    success: false,
    retryAfterSeconds: Math.max(...blocked.map((r) => r.retryAfterSeconds)),
  };
}

/**
 * Best-effort client IP from the proxy chain. Vercel sets x-forwarded-for with
 * the real client as the first hop. Falls back to a constant bucket so a missing
 * header degrades to "limit everyone together" rather than "limit no one".
 */
export function getClientIp(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip")?.trim() || "unknown-ip";
}

/** Standard 429 response with a Retry-After header. */
export function tooManyRequestsResponse(retryAfterSeconds: number): NextResponse {
  return NextResponse.json(
    { error: "Too many requests, please slow down." },
    {
      status: 429,
      headers: { "Retry-After": String(Math.max(1, retryAfterSeconds)) },
    }
  );
}
