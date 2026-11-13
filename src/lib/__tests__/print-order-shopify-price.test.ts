import { test } from "node:test";
import assert from "node:assert/strict";
import { REFERENCE_ADDRESS, dollarsToCents, fetchShopifyPricing } from "@/lib/print-orders/shopify-price";

const ENV = { NEXT_PUBLIC_SHOPIFY_DOMAIN: "shop.example.test" } as unknown as NodeJS.ProcessEnv;

/** A storefront speaking Shopify's public JSON: /variants/<id>.js, /cart/add.js, /cart/shipping_rates.json. */
function storefront(o: { prices?: Record<string, number | string>; rates?: Array<{ name: string; price: string }>; fail?: string; noCookie?: boolean } = {}) {
  const calls: Array<{ url: string; method: string; body?: string; cookie?: string }> = [];
  const prices = o.prices ?? { "48078680424673": 100 };
  const f = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url, method: init?.method ?? "GET", body: init?.body as string | undefined, cookie: headers.cookie });
    if (o.fail && url.includes(o.fail)) return new Response("nope", { status: 503 });
    const v = url.match(/\/variants\/(\d+)\.js$/);
    if (v) return Response.json({ id: Number(v[1]), price: prices[v[1]], available: true });
    if (url.endsWith("/cart/add.js")) {
      const h = new Headers({ "content-type": "application/json" });
      if (!o.noCookie) {
        h.append("set-cookie", "cart=c1abc%3Fkey%3Dz; path=/; expires=Wed, 27 Nov 2026 14:00:00 GMT; SameSite=Lax");
        h.append("set-cookie", "_shopify_y=xyz; path=/");
      }
      return new Response(JSON.stringify({ items: [] }), { status: 200, headers: h });
    }
    if (url.includes("/cart/shipping_rates.json")) return Response.json({ shipping_rates: o.rates ?? [{ name: "Photo Print Shipping", price: "6.00" }] });
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  return { f, calls };
}

test("Shopify pricing: the variant's own price and Shopify's shipping quote for this exact cart", async () => {
  const s = storefront();
  const p = await fetchShopifyPricing({ "48078680424673": 9 }, { fetch: s.f, env: ENV });
  assert.deepEqual(p, { unitCentsByVariant: { "48078680424673": 100 }, shippingCents: 600, shippingFrom: false, shippingName: "Photo Print Shipping" });
  assert.equal(s.calls[0].url, "https://shop.example.test/variants/48078680424673.js");
  assert.equal(s.calls[1].url, "https://shop.example.test/cart/add.js");
  assert.deepEqual(JSON.parse(s.calls[1].body!), { items: [{ id: 48078680424673, quantity: 9 }] });
  const rates = new URL(s.calls[2].url);
  assert.equal(rates.pathname, "/cart/shipping_rates.json");
  assert.equal(rates.searchParams.get("shipping_address[zip]"), REFERENCE_ADDRESS.zip);
  assert.equal(s.calls[2].cookie, "cart=c1abc%3Fkey%3Dz; _shopify_y=xyz", "the quote is for the cart just made");
});

test("Shopify pricing: a price change in Shopify shows up on the next click (nothing cached)", async () => {
  const prices: Record<string, number> = { "1": 100 };
  const s = storefront({ prices });
  assert.equal((await fetchShopifyPricing({ "1": 8 }, { fetch: s.f, env: ENV })).unitCentsByVariant["1"], 100);
  prices["1"] = 249;
  assert.equal((await fetchShopifyPricing({ "1": 8 }, { fetch: s.f, env: ENV })).unitCentsByVariant["1"], 249);
});

test("Shopify pricing: more than one shipping price → the lowest, marked 'from'", async () => {
  const s = storefront({ rates: [{ name: "Expedited", price: "12.50" }, { name: "Photo Print Shipping", price: "6.00" }] });
  const p = await fetchShopifyPricing({ "48078680424673": 8 }, { fetch: s.f, env: ENV });
  assert.deepEqual([p.shippingCents, p.shippingFrom, p.shippingName], [600, true, "Photo Print Shipping"]);
});

test("Shopify pricing: anything unexpected throws instead of showing a guess", async () => {
  const id = { "48078680424673": 8 };
  await assert.rejects(fetchShopifyPricing(id, { fetch: storefront({ fail: "/variants/" }).f, env: ENV }), /variant 48078680424673: Shopify answered 503/);
  await assert.rejects(fetchShopifyPricing(id, { fetch: storefront({ fail: "/cart/add.js" }).f, env: ENV }), /cart add: Shopify answered 503/);
  await assert.rejects(fetchShopifyPricing(id, { fetch: storefront({ fail: "shipping_rates" }).f, env: ENV }), /shipping rates: Shopify answered 503/);
  await assert.rejects(fetchShopifyPricing(id, { fetch: storefront({ rates: [] }).f, env: ENV }), /no shipping/);
  await assert.rejects(fetchShopifyPricing(id, { fetch: storefront({ noCookie: true }).f, env: ENV }), /no cart cookie/);
  await assert.rejects(fetchShopifyPricing(id, { fetch: storefront({ prices: { "48078680424673": "1.00" } }).f, env: ENV }), /not whole cents/);
  await assert.rejects(fetchShopifyPricing({}, { fetch: storefront().f, env: ENV }), /no prints/);
  await assert.rejects(fetchShopifyPricing({ "abc": 1 }, { fetch: storefront().f, env: ENV }), /not a variant id/);
});

test("dollarsToCents: exact, no float drift", () => {
  assert.equal(dollarsToCents("6.00"), 600);
  assert.equal(dollarsToCents("0.1"), 10);
  assert.equal(dollarsToCents("19.99"), 1999);
  assert.equal(dollarsToCents(4.35), 435);
  for (const bad of ["", "-1.00", "6.005", "abc", null]) assert.throws(() => dollarsToCents(bad), /not a price/);
});
