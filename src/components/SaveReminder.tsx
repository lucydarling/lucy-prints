"use client";

import { usePhotoStore } from "@/store/photo-store";
import { useSaveStore } from "@/store/save-store";
import { isStorageFull, useStorageStatus } from "@/store/storage-status";
import { countCropped } from "@/lib/review-prompt";
import { getBookSlots } from "@/lib/photo-slots";

/** Cropped photos on an unsaved book before the reminder shows. */
export const SAVE_REMINDER_AT = 5;

/**
 * Unsaved work lives only in this browser, and Safari clears a site's stored
 * data (IndexedDB included) after seven days of Safari use without a visit.
 * So once an unsaved book has 5 photos, a small note stays at the top until
 * it's saved. Not dismissable. The out-of-room banner, when it shows, says
 * the same thing more urgently, so this steps aside for it.
 * DRAFT copy, pending Haily.
 */
export function SaveReminder() {
  const sessionToken = useSaveStore((s) => s.sessionToken);
  const setShowSaveModal = useSaveStore((s) => s.setShowSaveModal);
  const full = useStorageStatus(isStorageFull);
  const cropped = usePhotoStore((s) =>
    countCropped(s.photos, s.extras, getBookSlots(s.bookTheme, s.regionLayouts))
  );

  if (sessionToken || full || cropped < SAVE_REMINDER_AT) return null;

  return (
    <div className="max-w-2xl mx-auto px-4 mt-3">
      <div className="flex items-center justify-between gap-3 px-3 py-2 rounded-xl bg-rose-50 border border-rose-100 text-xs text-gray-700">
        <p>Your photos are only on this device for now. Save your progress so they&apos;re safe.</p>
        <button
          onClick={() => setShowSaveModal(true)}
          className="shrink-0 px-3 py-1.5 font-semibold text-white bg-rose-500 hover:bg-rose-600 rounded-full transition-colors"
        >
          Save
        </button>
      </div>
    </div>
  );
}
