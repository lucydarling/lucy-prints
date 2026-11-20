import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { checkRateLimit, RATE_LIMITS, tooManyRequestsResponse } from "@/lib/rate-limit";
import { isUsageEvent, sanitizeProps, PRINT_FUNNEL_EVENTS } from "@/lib/usage-events";
import { printButtonAllowed } from "@/lib/print-orders/print-gate";

export const runtime = "nodejs";

/**
 * POST /api/sessions/[token]/events  { event, props }
 * Records one usage event for the session. Fixed allow-list of event names
 * (anything else: 400); props are filtered to each event's known keys.
 * Print-funnel events are dropped silently (204) unless print ordering is on
 * for the caller, so with the feature off nothing new is stored.
 * Answers 204 and nothing else: callers fire and forget.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const rl = await checkRateLimit(token, RATE_LIMITS.events);
  if (!rl.success) return tooManyRequestsResponse(rl.retryAfterSeconds);

  let body: { event?: unknown; props?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  if (!isUsageEvent(body.event)) {
    return NextResponse.json({ error: "Unknown event" }, { status: 400 });
  }
  const event = body.event;
  if (PRINT_FUNNEL_EVENTS.includes(event) && !printButtonAllowed(req.cookies)) {
    return new NextResponse(null, { status: 204 });
  }

  const { data: session } = await supabaseAdmin
    .from("sessions")
    .select("id")
    .eq("token", token)
    .maybeSingle();
  if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 });

  const { error } = await supabaseAdmin
    .from("photo_lab_events")
    .insert({ session_id: session.id, event, props: sanitizeProps(event, body.props) });
  if (error) console.error("photo_lab_events insert error:", error.message);
  return new NextResponse(null, { status: 204 });
}
