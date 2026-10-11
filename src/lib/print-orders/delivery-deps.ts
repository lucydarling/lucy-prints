import { supabaseAdmin } from "@/lib/supabase-server";
import { sendPrintOrderAlert } from "@/lib/email";
import type { RecordedOrderRow } from "./build-from-snapshot";
import type { Destination } from "./config";
import type { SentOrderRef } from "./error-monitor";

/** print_orders reads and guarded status changes for delivery and the _error check. Server-side only. */

export async function loadRecordedRow(shopifyOrderId: string): Promise<RecordedOrderRow | null> {
  const { data, error } = await supabaseAdmin
    .from("print_orders")
    .select("status, snapshot, external_id, print_count")
    .eq("shopify_order_id", shopifyOrderId)
    .maybeSingle();
  if (error) throw new Error(`print_orders lookup failed: ${error.message}`);
  return (data as RecordedOrderRow | null) ?? null;
}

/** ready (or sent, for a re-send) → sent. Only changes the row if it is still `fromStatus`. */
export async function markSent(shopifyOrderId: string, fromStatus: string, dest: Destination, sentAt: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("print_orders")
    .update({ status: "sent", sent_at: sentAt, destination: dest.kind })
    .eq("shopify_order_id", shopifyOrderId)
    .eq("status", fromStatus)
    .select("id");
  if (error) throw new Error(`print_orders update failed: ${error.message}`);
  return (data ?? []).length === 1;
}

export async function findSentByExternalIds(externalIds: string[]): Promise<SentOrderRef[]> {
  if (externalIds.length === 0) return [];
  const { data, error } = await supabaseAdmin
    .from("print_orders")
    .select("shopify_order_id, shopify_order_name, external_id")
    .eq("status", "sent")
    .in("external_id", externalIds);
  if (error) throw new Error(`print_orders lookup failed: ${error.message}`);
  return (data ?? []).map((r) => ({
    shopifyOrderId: r.shopify_order_id as string,
    shopifyOrderName: r.shopify_order_name as string | null,
    externalId: r.external_id as string,
  }));
}

/** sent → error, only while still sent. True when this call changed the row (so only one caller alerts). */
export async function markError(shopifyOrderId: string, reason: string, at: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("print_orders")
    .update({ status: "error", error_reason: reason, error_at: at })
    .eq("shopify_order_id", shopifyOrderId)
    .eq("status", "sent")
    .select("id");
  if (error) throw new Error(`print_orders update failed: ${error.message}`);
  return (data ?? []).length === 1;
}

export async function alertPrinterError(info: { shopifyOrderId: string; shopifyOrderName?: string; externalId: string; folder: string; reason: string }) {
  await sendPrintOrderAlert({
    status: "error",
    shopifyOrderId: info.shopifyOrderId,
    shopifyOrderName: info.shopifyOrderName,
    reasons: [`Folder: _error/${info.folder}`, info.reason],
  });
}
