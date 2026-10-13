import { getProductForTheme } from "@/lib/photo-slots";

/**
 * Pure helpers for keeping crops out of localStorage. The persisted photo
 * state is unchanged except that a crop stored in IndexedDB is written as
 * `idb:<product>/<slot key or extra id>` instead of its data URL.
 */

export const CROP_REF = "idb:";

export const isCropRef = (url: string | null | undefined): url is string =>
  typeof url === "string" && url.startsWith(CROP_REF);

type Crop = { croppedUrl: string | null };
interface Book {
  photos?: Record<string, Crop>;
  extras?: Array<Crop & { id: string }>;
}
export interface PersistedPhotos extends Book {
  bookTheme?: string | null;
  shelf?: Record<string, Book | undefined>;
}

/** The product a book's crops are filed under (an unknown theme is a memory book). */
export const cropProduct = (bookTheme: string | null | undefined) =>
  getProductForTheme(bookTheme) ?? "memory_book";

/**
 * A copy of `state` with every crop passed through `fn(key, url)`, for the
 * open book and every shelved one. Anything that isn't a crop is untouched.
 */
export function mapCrops<S extends PersistedPhotos>(
  state: S,
  fn: (key: string, url: string | null) => string | null
): S {
  const mapBook = <B extends Book>(product: string, book: B): B => ({
    ...book,
    ...(book.photos && {
      photos: Object.fromEntries(
        Object.entries(book.photos).map(([k, p]) => [k, { ...p, croppedUrl: fn(`${product}/${k}`, p.croppedUrl) }])
      ),
    }),
    ...(book.extras && {
      extras: book.extras.map((e) => ({ ...e, croppedUrl: fn(`${product}/${e.id}`, e.croppedUrl) })),
    }),
  });
  const open = mapBook(cropProduct(state.bookTheme), state);
  if (state.shelf) {
    open.shelf = Object.fromEntries(
      Object.entries(state.shelf).map(([product, book]) => [product, book && mapBook(product, book)])
    );
  }
  return open;
}

/** Every crop in `state` as key → url (null when there is none). */
export function listCrops(state: PersistedPhotos): Map<string, string | null> {
  const crops = new Map<string, string | null>();
  mapCrops(state, (key, url) => {
    crops.set(key, url);
    return url;
  });
  return crops;
}
