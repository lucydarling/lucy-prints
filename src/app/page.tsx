import { cookies } from "next/headers";
import { HomePage } from "@/components/HomePage";
import { getProductForTheme, type ProductType } from "@/lib/photo-slots";
import { GATED_PRODUCTS, unlockedProducts } from "@/lib/preview-gate";

const PRODUCT_IDS: ProductType[] = ["memory_book", "pregnancy_journal", "little_years"];

/**
 * Home: book picker. Reads the preview cookies on the server so a hidden book
 * never reaches a visitor who hasn't unlocked it, and honours
 * ?book=<product or theme id> by putting that book first.
 */
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ book?: string | string[] }>;
}) {
  const [{ book }, jar] = await Promise.all([searchParams, cookies()]);
  const unlocked = unlockedProducts(jar);

  const wanted = typeof book === "string" ? book : null;
  const wantedProduct = PRODUCT_IDS.find((p) => p === wanted) ?? getProductForTheme(wanted);
  // A hidden book falls back to the normal home page, as if no ?book= was given.
  const preselect = wantedProduct && unlocked[wantedProduct] ? wanted : null;

  // Only books this visitor may see are named in the page; a locked visitor
  // gets an empty list, so a hidden book never appears in the HTML.
  const unlockedBooks = GATED_PRODUCTS.filter((p) => unlocked[p]);
  return <HomePage unlockedBooks={unlockedBooks} preselect={preselect} />;
}
