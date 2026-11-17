import { NextRequest, NextResponse } from "next/server";
import { handlePaidOrder, PaidOrderBusy, type ShopifyPaidOrder } from "@/lib/print-orders/paid-order";
import { realPaidOrderDeps } from "@/lib/print-orders/paid-order-deps";
import { verifyShopifyHmac } from "@/lib/print-orders/webhook-hmac";
import { syncPrintRoundReminders } from "@/lib/print-orders/round-reminder-sync";

// Image decoding (sharp) and node:crypto need the Node.js runtime.
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/webhooks/shopify/orders-paid
 *
 * Shopify "orders/paid" webhook. Verifies the HMAC, and if the order is a
 * photo-print order, checks it and records ready / held / refused in
 * print_orders. Test mode: external ids carry a TEST- prefix and NOTHING is
 * delivered to a print partner. Not linked from anywhere.
 *
 * A bad or missing signature answers 401 with no detail (a missing one even
 * before SHOPIFY_WEBHOOK_SECRET is set; a signed request then gets 500 so
 * Shopify retries once it is). Our own failures
 * (database down) answer 500 so Shopify retries; a refused or held print
 * order is a recorded business outcome and answers 200.
 */
export async function POST(req: NextRequest) {
  // No signature at all is never Shopify: 401, even before the secret is configured.
  if (!req.headers.get("x-shopify-hmac-sha256")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET ?? "";
  if (!secret) {
    console.error("SHOPIFY_WEBHOOK_SECRET is not set — refusing all webhooks");
    return NextResponse.json({ error: "not configured" }, { status: 500 });
  }
  const raw = await req.text();
  if (!verifyShopifyHmac(raw, req.headers.get("x-shopify-hmac-sha256"), secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const topic = req.headers.get("x-shopify-topic");
  if (topic && topic !== "orders/paid") {
    return NextResponse.json({ status: "ignored", reason: "wrong topic" });
  }
  let order: ShopifyPaidOrder;
  try {
    order = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "bad body" }, { status: 400 });
  }
  // Which delivery this is: Shopify keeps X-Shopify-Webhook-Id on its own retries
  // and gives a separate event a new one. Logged so a duplicate can be told apart.
  const delivery = {
    order: order?.id,
    webhookId: req.headers.get("x-shopify-webhook-id"),
    eventId: req.headers.get("x-shopify-event-id"),
    triggeredAt: req.headers.get("x-shopify-triggered-at"),
  };
  console.log(`[orders-paid] delivery ${JSON.stringify(delivery)}`);
  try {
    const result = await handlePaidOrder(order, realPaidOrderDeps());
    console.log(`[orders-paid] order ${delivery.order} webhook ${delivery.webhookId}: ${result.status}`);
    // Refresh the Klaviyo round-reminder properties (only when print ordering is
    // on for everyone; never throws, never changes the webhook's answer).
    if (result.status === "ready" && result.sessionId) {
      await syncPrintRoundReminders(result.sessionId, { flagOnly: true });
    }
    return NextResponse.json({ status: result.status });
  } catch (err) {
    // Another delivery of this order is still running: let Shopify retry later.
    if (err instanceof PaidOrderBusy) {
      console.warn(`[orders-paid] ${err.message}`);
      return NextResponse.json({ error: "busy" }, { status: 503 });
    }
    console.error("print order webhook failed:", err);
    return NextResponse.json({ error: "server error" }, { status: 500 });
  }
}
