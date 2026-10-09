import { createHmac, timingSafeEqual } from "node:crypto";

/** Shopify signs the RAW request body: base64(HMAC-SHA256(secret, body)) in X-Shopify-Hmac-Sha256. */
export function verifyShopifyHmac(rawBody: string, headerValue: string | null, secret: string): boolean {
  if (!secret || !headerValue) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest();
  let given: Buffer;
  try {
    given = Buffer.from(headerValue, "base64");
  } catch {
    return false;
  }
  return given.length === expected.length && timingSafeEqual(given, expected);
}
