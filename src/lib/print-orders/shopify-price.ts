/**
 * The prices the confirm step shows, read from the same Shopify storefront the checkout link
 * goes to, at click time, so the confirm step and checkout cannot disagree (Kevin, 2026-11-13).
 * No constants, no cache.
 *
 *  - Per-print price: the variant's own price, `GET https://<shop>/variants/<id>.js` (public
 *    storefront JSON; `price` is in cents). Checkout charges variant price × quantity.
 *  - Shipping: Shopify's own quote for this exact cart (the shipping profile's rate), from a
 *    throwaway anonymous storefront cart: `POST /cart/add.js` with the round's variants and
 *    quantities, then `GET /cart/shipping_rates.json` for a reference US address. The cart is
 *    never checked out and only lives in the cookie this function holds.
 *
 * The customer's own address is unknown at this point, so the quote uses REFERENCE_ADDRESS.
 * Today the profile has one US-wide rate ("Photo Print Shipping", the same for AZ and NY on
 * 2026-11-13). If Shopify ever returns more than one rate, the lowest is shown with
 * `shippingFrom: true` ("from $X"), since the customer picks at checkout.
 * Tax is added at checkout and is not part of this total.
 *
 * Any failure throws: the caller shows "not available right now" rather than a price that
 * might be wrong.
 */

export const REFERENCE_ADDRESS = { country: "United States", province: "Arizona", zip: "85016" } as const;
const TIMEOUT_MS = 8000;

export interface ShopifyPricing {
  /** Price per print in cents, by Shopify variant id. */
  unitCentsByVariant: Record<string, number>;
  /** Shipping in cents for this cart (the lowest rate if there is more than one). */
  shippingCents: number;
  /** True when Shopify offered more than one shipping price, so the customer may pay more. */
  shippingFrom: boolean;
  /** The rate's name in Shopify, e.g. "Photo Print Shipping". */
  shippingName: string;
}

export class ShopifyPriceError extends Error {}

type Fetch = typeof fetch;

function storeDomain(env: NodeJS.ProcessEnv): string {
  // Same host as the checkout link (lib/shopify.ts buildCheckoutUrl).
  return env.NEXT_PUBLIC_SHOPIFY_DOMAIN || "www.lucydarling.com";
}

async function getJson(f: Fetch, url: string, init: RequestInit, what: string): Promise<{ body: unknown; res: Response }> {
  let res: Response;
  try {
    res = await f(url, { ...init, cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    throw new ShopifyPriceError(`${what}: request failed (${(err as Error).message})`);
  }
  if (!res.ok) throw new ShopifyPriceError(`${what}: Shopify answered ${res.status}`);
  try {
    return { body: await res.json(), res };
  } catch {
    throw new ShopifyPriceError(`${what}: not JSON`);
  }
}

/** "6.00" → 600. Refuses anything that isn't a plain non-negative amount. */
export function dollarsToCents(v: unknown): number {
  const s = typeof v === "number" ? v.toFixed(2) : String(v ?? "");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) throw new ShopifyPriceError(`not a price: ${JSON.stringify(v)}`);
  const [whole, frac = ""] = s.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

/** The name=value part of every Set-Cookie header, joined for a Cookie header. */
function cookieHeader(res: Response): string {
  const h = res.headers as Headers & { getSetCookie?: () => string[] };
  const all = h.getSetCookie ? h.getSetCookie() : (res.headers.get("set-cookie") ?? "").split(/,(?=\s*[^;,\s]+=)/);
  return all.map((c) => c.split(";")[0].trim()).filter(Boolean).join("; ");
}

export async function fetchShopifyPricing(
  quantities: Record<string, number>,
  opts: { fetch?: Fetch; env?: NodeJS.ProcessEnv } = {}
): Promise<ShopifyPricing> {
  const f = opts.fetch ?? fetch;
  const base = `https://${storeDomain(opts.env ?? process.env)}`;
  const lines = Object.entries(quantities).filter(([, q]) => q > 0);
  if (lines.length === 0) throw new ShopifyPriceError("no prints to price");
  for (const [id] of lines) if (!/^\d+$/.test(id)) throw new ShopifyPriceError(`not a variant id: ${id}`);

  const unitCentsByVariant: Record<string, number> = {};
  for (const [id] of lines) {
    const { body } = await getJson(f, `${base}/variants/${id}.js`, {}, `variant ${id}`);
    const v = body as { id?: number; price?: unknown; available?: boolean };
    if (String(v.id) !== id) throw new ShopifyPriceError(`variant ${id}: Shopify returned variant ${v.id}`);
    if (!Number.isInteger(v.price) || (v.price as number) < 0) throw new ShopifyPriceError(`variant ${id}: price ${JSON.stringify(v.price)} is not whole cents`);
    if (v.available === false) throw new ShopifyPriceError(`variant ${id}: not available on the storefront`);
    unitCentsByVariant[id] = v.price as number;
  }

  const { res: added } = await getJson(
    f,
    `${base}/cart/add.js`,
    {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ items: lines.map(([id, quantity]) => ({ id: Number(id), quantity })) }),
    },
    "cart add"
  );
  const cookie = cookieHeader(added);
  if (!/(^|; )cart=/.test(cookie)) throw new ShopifyPriceError("cart add: Shopify set no cart cookie");
  const q = new URLSearchParams({
    "shipping_address[country]": REFERENCE_ADDRESS.country,
    "shipping_address[province]": REFERENCE_ADDRESS.province,
    "shipping_address[zip]": REFERENCE_ADDRESS.zip,
  });
  const { body } = await getJson(f, `${base}/cart/shipping_rates.json?${q}`, { headers: { cookie, accept: "application/json" } }, "shipping rates");
  const rates = ((body as { shipping_rates?: Array<{ name?: string; price?: unknown }> }).shipping_rates ?? []).map((r) => ({
    name: String(r.name ?? ""),
    cents: dollarsToCents(r.price),
  }));
  if (rates.length === 0) throw new ShopifyPriceError("shipping rates: Shopify offered no shipping for this cart");
  const lowest = rates.reduce((a, b) => (b.cents < a.cents ? b : a));
  return {
    unitCentsByVariant,
    shippingCents: lowest.cents,
    shippingFrom: new Set(rates.map((r) => r.cents)).size > 1,
    shippingName: lowest.name,
  };
}
