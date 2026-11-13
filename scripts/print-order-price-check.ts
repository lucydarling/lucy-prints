/**
 * Show what the confirm step would show right now, read from the live storefront the same way
 * the print-checkout route does (fetchShopifyPricing). Read-only: it makes a throwaway anonymous
 * cart for the shipping quote and never checks out. Writes nothing to the database.
 *
 *   npm run print-order:price-check -- [prints=8]
 */
import { variantIdForKey } from "@/lib/print-orders/config";
import { fetchShopifyPricing } from "@/lib/print-orders/shopify-price";
import { dollars } from "@/lib/print-orders/round";

async function main() {
  const prints = Number(process.argv[2] ?? 8);
  if (!Number.isInteger(prints) || prints < 1) throw new Error("prints must be a whole number");
  const id = variantIdForKey("print");
  const p = await fetchShopifyPricing({ [id]: prints });
  const unit = p.unitCentsByVariant[id];
  console.log(`Shop: ${process.env.NEXT_PUBLIC_SHOPIFY_DOMAIN || "www.lucydarling.com"}, variant ${id}`);
  console.log(`${prints} prints × ${dollars(unit)} = ${dollars(prints * unit)}`);
  console.log(`Shipping & handling (${p.shippingName}): ${p.shippingFrom ? "from " : ""}${dollars(p.shippingCents)}`);
  console.log(`Total before tax: ${dollars(prints * unit + p.shippingCents)}`);
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
