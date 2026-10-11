import type { ShopifyPaidOrder } from "./paid-order";

/**
 * MANUAL RETRY ONLY: fetch one order from the Shopify Admin REST API so the
 * same handler can be re-run (e.g. after a customer fills a held slot).
 * Needs SHOPIFY_ADMIN_TOKEN and SHOPIFY_ADMIN_DOMAIN (the *.myshopify.com host).
 */
export async function fetchShopifyOrder(orderId: string): Promise<ShopifyPaidOrder> {
  const token = process.env.SHOPIFY_ADMIN_TOKEN;
  const domain = process.env.SHOPIFY_ADMIN_DOMAIN;
  if (!token || !domain) throw new Error("SHOPIFY_ADMIN_TOKEN and SHOPIFY_ADMIN_DOMAIN must be set");
  if (!/^\d+$/.test(orderId)) throw new Error("order id must be the numeric Shopify order id");
  const res = await fetch(`https://${domain}/admin/api/2025-10/orders/${orderId}.json`, {
    headers: { "X-Shopify-Access-Token": token },
  });
  if (!res.ok) throw new Error(`Shopify Admin API ${res.status} for order ${orderId}`);
  const { order } = (await res.json()) as { order: ShopifyPaidOrder };
  // Only orders that were actually paid may be processed.
  if (order.financial_status !== "paid") {
    throw new Error(`order ${orderId} is "${order.financial_status}", not paid — refusing`);
  }
  return order;
}
