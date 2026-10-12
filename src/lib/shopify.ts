/**
 * Shopify integration config for lucy-prints checkout.
 *
 * Product: "Custom Photo Prints for Memory Book", one variant "Photo print" (id via
 * NEXT_PUBLIC_SHOPIFY_VARIANT_PRINT; see print-orders/config.ts). Price is per print.
 *
 * Variant IDs and store domain come from env vars so they can differ
 * between staging and production without a code change.
 */

const SHOPIFY_STORE_DOMAIN =
  process.env.NEXT_PUBLIC_SHOPIFY_DOMAIN || "www.lucydarling.com";

/**
 * Build a Shopify cart permalink that sends the customer straight to checkout
 * with one line per print variant (quantity = prints at that price) and the
 * round as cart attributes.
 *
 * URL format:
 *   https://www.lucydarling.com/cart/{variantA}:{qty},{variantB}:{qty}?attributes[round_id]=…&attributes[session_token]=…
 *
 * Cart attributes appear on the Shopify order. `round_id` names the exact list
 * of prints recorded at the click; the webhook prints that list and nothing else.
 */
export function buildCheckoutUrl({
  quantities,
  sessionToken,
  bookTheme,
  roundId,
  printCount,
}: {
  /** variant id → quantity */
  quantities: Record<string, number>;
  sessionToken: string;
  bookTheme: string;
  roundId: string;
  printCount: number;
}): string {
  const lines = Object.entries(quantities).filter(([, q]) => q > 0);
  if (lines.length === 0) throw new Error("checkout needs at least one print");
  const cart = lines.map(([id, q]) => `${id}:${q}`).join(",");

  const params = new URLSearchParams({
    "attributes[session_token]": sessionToken,
    "attributes[book_theme]": bookTheme,
    "attributes[round_id]": roundId,
    "attributes[photo_count]": String(printCount),
  });

  return `https://${SHOPIFY_STORE_DOMAIN}/cart/${cart}?${params.toString()}`;
}

/**
 * Same cart as buildCheckoutUrl, but emptied first (/cart/clear), so anything
 * already in the customer's cart can't ride along on a print order.
 */
export function buildFreshCartCheckoutUrl(args: Parameters<typeof buildCheckoutUrl>[0]): string {
  const cartPath = buildCheckoutUrl(args).replace(/^https:\/\/[^/]+/, "");
  return `https://${SHOPIFY_STORE_DOMAIN}/cart/clear?return_to=${encodeURIComponent(cartPath)}`;
}
