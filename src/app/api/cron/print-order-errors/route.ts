import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { runErrorCheck } from "@/lib/print-orders/run-error-check";
import { runStalledCheck } from "@/lib/print-orders/run-stalled-check";

// Dropbox calls, node:crypto and the Supabase service client need the Node.js runtime.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(header: string | null, secret: string): boolean {
  const want = Buffer.from(`Bearer ${secret}`);
  const got = Buffer.from(header ?? "");
  return got.length === want.length && timingSafeEqual(got, want);
}

/**
 * GET /api/cron/print-order-errors
 *
 * Scheduled check of the print hotfolder's _error folder (Vercel Cron sends
 * `Authorization: Bearer $CRON_SECRET`). Each sent order found there becomes
 * "error" and Kevin gets one alert. Then a second, independent check: a sent order
 * still sitting in the hotfolder past STALLED_AFTER_MINUTES (pfRouter not picking
 * it up) alerts once. A failure in one check never stops the other.
 * Not linked from anywhere. Read-only on Dropbox.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET ?? "";
  if (!secret) {
    console.error("CRON_SECRET is not set — refusing the print order _error check");
    return NextResponse.json({ error: "not configured" }, { status: 500 });
  }
  if (!authorized(req.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let status = 200;
  const body: Record<string, unknown> = {};
  try {
    const r = await runErrorCheck();
    if (r.ignored.length > 0) console.log("print order _error folders with no sent order:", r.ignored);
    body.seen = r.seen.length;
    body.marked = r.marked;
    body.alertFailures = r.alertFailures;
  } catch (err) {
    console.error("print order _error check failed:", err);
    body.error = "server error";
    status = 500;
  }
  try {
    const r = await runStalledCheck();
    body.stalled = r.stalled;
    body.stalledAlerted = r.alerted;
    body.stalledAlertFailed = r.alertFailed;
  } catch (err) {
    console.error("print order stalled check failed:", err);
    body.stalledError = "server error";
    status = 500;
  }
  return NextResponse.json(body, { status });
}
