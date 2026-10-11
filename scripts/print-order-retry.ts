/**
 * Manual retry: re-run the paid-order check for one Shopify order, fetched
 * from the Admin API. Records ready/held/refused in print_orders. Sends nothing.
 *
 *   npm run print-order:retry -- <numeric-shopify-order-id> [--refreeze]
 *
 * By default a retry reuses the photos frozen at payment. --refreeze takes a
 * fresh snapshot of the session (only for an order that is not ready, e.g. a
 * held empty order that was fixed by hand).
 */
import { handlePaidOrder } from "@/lib/print-orders/paid-order";
import { realPaidOrderDeps } from "@/lib/print-orders/paid-order-deps";
import { fetchShopifyOrder } from "@/lib/print-orders/shopify-admin";

(async () => {
  const id = process.argv[2];
  if (!id) throw new Error("usage: print-order:retry <numeric-shopify-order-id>");
  const result = await handlePaidOrder(await fetchShopifyOrder(id), realPaidOrderDeps(), { refreeze: process.argv.includes("--refreeze") });
  console.log(JSON.stringify(result, null, 2));
})().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
