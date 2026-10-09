import { NextRequest, NextResponse } from "next/server";
import { handlePaidOrder, type ShopifyPaidOrder } from "@/lib/print-orders/paid-order";
import { realPaidOrderDeps } from "@/lib/print-orders/paid-order-deps";
import { verifyShopifyHmac } from "@/lib/print-orders/webhook-hmac";

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
 * A bad or missing signature answers 401 with no detail. Our own failures
 * (database down) answer 500 so Shopify retries; a refused or held print
 * order is a recorded business outcome and answers 200.
 */
export async function POST(req: NextRequest) {
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
  try {
    const result = await handlePaidOrder(order, realPaidOrderDeps());
    return NextResponse.json({ status: result.status });
  } catch (err) {
    console.error("print order webhook failed:", err);
    return NextResponse.json({ error: "server error" }, { status: 500 });
  }
}
