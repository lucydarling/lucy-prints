"use client";

import { usePhotoStore, type ShelvedBook } from "@/store/photo-store";
import { useSaveStore } from "@/store/save-store";
import { getProductForTheme, type ProductType } from "@/lib/photo-slots";

/**
 * Open a book theme.
 *
 * Within one product this only changes the theme, exactly as before books
 * other than memory books existed: photos, notes and the saved session carry
 * over (every memory book theme has the same slots).
 *
 * Opening a DIFFERENT product shelves the current product's work — photos,
 * extras, notes and its saved session — and brings back whatever was shelved
 * for the new product. Nothing is discarded, so a memory book's unsaved
 * photos are still there when the customer comes back from the journal.
 */
export function openBook(themeId: string): void {
  const photoState = usePhotoStore.getState();
  const from = getProductForTheme(photoState.bookTheme);
  const to = getProductForTheme(themeId);

  if (!photoState.bookTheme || !from || !to || from === to) {
    photoState.setBookTheme(themeId);
    return;
  }

  const save = useSaveStore.getState();
  const current: ShelvedBook = {
    bookTheme: photoState.bookTheme,
    photos: photoState.photos,
    extras: photoState.extras,
    notes: photoState.notes,
    detailsMode: photoState.detailsMode,
    session: {
      sessionToken: save.sessionToken,
      sessionId: save.sessionId,
      email: save.email,
      babyName: save.babyName,
      babyBirthdate: save.babyBirthdate,
      uploadedSlots: save.uploadedSlots,
    },
  };
  const next = photoState.shelf[to];

  const shelf = { ...photoState.shelf, [from]: current };
  delete shelf[to];

  usePhotoStore.setState({
    bookTheme: themeId,
    photos: next?.photos ?? {},
    extras: next?.extras ?? [],
    notes: next?.notes ?? {},
    detailsMode: next?.detailsMode ?? false,
    editingSlot: null,
    shelf,
  });

  // The upload queue belongs to the book being put away — drop it rather than
  // send its photos to the other book's session.
  useSaveStore.setState({
    sessionToken: next?.session.sessionToken ?? null,
    sessionId: next?.session.sessionId ?? null,
    email: next?.session.email ?? null,
    babyName: next?.session.babyName ?? null,
    babyBirthdate: next?.session.babyBirthdate ?? null,
    uploadedSlots: next?.session.uploadedSlots ?? [],
    uploadQueue: [],
    uploadingSlot: null,
    uploadErrors: {},
    saveStatus: next?.session.sessionToken ? "saved" : "idle",
  });
}

/** Work for `product` that is on the shelf (not the open book), if any. */
export function shelvedBookFor(product: ProductType | null): ShelvedBook | undefined {
  if (!product) return undefined;
  return usePhotoStore.getState().shelf[product];
}

/** Forget the shelved work for one product (used when a saved session replaces it). */
export function clearShelvedBook(product: ProductType): void {
  usePhotoStore.setState((s) => {
    const shelf = { ...s.shelf };
    delete shelf[product];
    return { shelf };
  });
}
