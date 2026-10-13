"use client";

import { useRouter } from "next/navigation";
import { useSaveStore } from "@/store/save-store";
import { usePhotoStore } from "@/store/photo-store";
import { countMissingFromBrowser, isStorageFull, useStorageStatus } from "@/store/storage-status";

/**
 * Shown when this browser can't keep the customer's photos (localStorage is
 * full). Unsaved: their only copy is this page, so the ask is to save, which
 * puts everything in the cloud. Saved: the cloud has everything, but a reload
 * of this page only brings back what fit, so offer to reload the full session
 * from the cloud (the resume link), once uploads have finished. After a page
 * reload no write fails (the browser re-saves what it already had), so the
 * saved case also shows when cloud photos are missing from this browser.
 */
export function StorageFullBanner() {
  const router = useRouter();
  const full = useStorageStatus(isStorageFull);
  const reloaded = useStorageStatus((s) => s.reloadedFromCloud);
  const sessionToken = useSaveStore((s) => s.sessionToken);
  const setShowSaveModal = useSaveStore((s) => s.setShowSaveModal);
  const uploading = useSaveStore((s) => s.uploadingSlot !== null || s.uploadQueue.length > 0);
  const uploadedSlots = useSaveStore((s) => s.uploadedSlots);
  const photos = usePhotoStore((s) => s.photos);
  const extras = usePhotoStore((s) => s.extras);
  const missing = sessionToken ? countMissingFromBrowser(uploadedSlots, photos, extras) : 0;

  const show = sessionToken ? missing > 0 || (full && !reloaded) : full;
  if (!show) return null;

  return (
    <div className="max-w-2xl mx-auto px-4 mt-3">
      <div role="alert" className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-sm text-amber-900">
        {!sessionToken ? (
          <>
            <p>Your browser is out of room. Save your progress to keep these photos.</p>
            <button
              onClick={() => setShowSaveModal(true)}
              className="mt-3 px-4 py-2 text-xs font-semibold text-white bg-rose-500 hover:bg-rose-600 rounded-full transition-colors"
            >
              Save My Progress
            </button>
          </>
        ) : (
          <>
            {/* DRAFT copy, pending Kevin/Haily. */}
            <p>
              Your browser is out of room, so it can&apos;t keep all of your photos here.
              They&apos;re saved in your account.
            </p>
            <button
              onClick={() => router.push(`/resume/${sessionToken}`)}
              disabled={uploading}
              className="mt-3 px-4 py-2 text-xs font-semibold text-white bg-rose-500 hover:bg-rose-600 rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {uploading ? "Finishing uploads…" : "Reload my photos"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
