/**
 * Shopify integration config for lucy-prints checkout.
 *
 * Product: "Custom Photo Prints for Memory Book"
 * Created as Draft in Shopify admin — set pricing & activate when ready.
 *
 * Variant IDs and store domain come from env vars so they can differ
 * between staging and production without a code change.
 */

const SHOPIFY_STORE_DOMAIN =
  process.env.NEXT_PUBLIC_SHOPIFY_DOMAIN || "www.lucydarling.com";

/** Shopify variant IDs for the photo print product */
export const SHOPIFY_VARIANTS = {
  standard: process.env.NEXT_PUBLIC_SHOPIFY_VARIANT_STANDARD || "48078680424673",
  luxury: process.env.NEXT_PUBLIC_SHOPIFY_VARIANT_LUXURY || "48078680457441",
} as const;

/**
 * Build a Shopify cart permalink that sends the customer straight to checkout
 * with the correct variant, quantity = 1, and session metadata as cart attributes.
 *
 * URL format:
 *   https://www.lucydarling.com/cart/{variantId}:1?attributes[session_token]=xxx&attributes[book_theme]=xxx&attributes[photo_count]=xx
 *
 * Cart attributes appear on the Shopify order, so fulfillment
 * can pull the photos from Supabase using the session token.
 */
export function buildCheckoutUrl({
  tier,
  sessionToken,
  bookTheme,
  photoCount,
}: {
  tier: "standard" | "luxury";
  sessionToken: string;
  bookTheme: string;
  photoCount: number;
}): string {
  const variantId = SHOPIFY_VARIANTS[tier];

  const params = new URLSearchParams({
    "attributes[session_token]": sessionToken,
    "attributes[book_theme]": bookTheme,
    "attributes[photo_count]": String(photoCount),
  });

  return `https://${SHOPIFY_STORE_DOMAIN}/cart/${variantId}:1?${params.toString()}`;
}
