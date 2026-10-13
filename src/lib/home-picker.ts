import { getProductForTheme, type ProductType } from "@/lib/photo-slots";

const PRODUCT_IDS: ProductType[] = ["memory_book", "pregnancy_journal", "little_years"];

/** Life-stage order of the Step 1 tiles. */
export const PICKER_ORDER: ProductType[] = ["pregnancy_journal", "memory_book", "little_years"];

/**
 * Which book the multi-book home page opens on: the product named by ?book=
 * (a product id, or a theme id whose product we look up), else the memory book.
 * A product the visitor can't see falls back to the memory book too — the
 * server already nulls it, this is defence in depth.
 */
export function resolveInitialProduct(
  preselect: string | null,
  unlockedBooks: ProductType[]
): ProductType {
  const wanted = PRODUCT_IDS.find((p) => p === preselect) ?? getProductForTheme(preselect);
  if (wanted && (wanted === "memory_book" || unlockedBooks.includes(wanted))) return wanted;
  return "memory_book";
}

/** The tiles to show, in life-stage order: the memory book plus whatever is unlocked. */
export function visibleProducts(unlockedBooks: ProductType[]): ProductType[] {
  return PICKER_ORDER.filter((p) => p === "memory_book" || unlockedBooks.includes(p));
}
