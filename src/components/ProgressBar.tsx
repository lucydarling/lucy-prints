"use client";

import { usePhotoStore } from "@/store/photo-store";
import { useSaveStore } from "@/store/save-store";
import { PHOTO_SLOTS } from "@/lib/photo-slots";

function formatBirthdate(dateStr: string): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
}

export function ProgressBar() {
  const photos = usePhotoStore((s) => s.photos);
  const total = PHOTO_SLOTS.length;
  const uploaded = Object.values(photos).filter(
    (p) => p.status === "cropped" || p.status === "uploaded"
  ).length;
  const percent = total > 0 ? Math.round((uploaded / total) * 100) : 0;

  const pendingBabyName = useSaveStore((s) => s.pendingBabyName);
  const pendingBabyBirthdate = useSaveStore((s) => s.pendingBabyBirthdate);
  const birthdateOptOut = useSaveStore((s) => s.birthdateOptOut);
  const setShowBabyInfoModal = useSaveStore((s) => s.setShowBabyInfoModal);

  const hasInfo = !!(pendingBabyName || pendingBabyBirthdate || birthdateOptOut);

  return (
    <div className="sticky top-0 z-10 bg-white/95 backdrop-blur-sm border-b border-gray-100 px-4 py-3">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-sm font-medium text-gray-700">
            {uploaded} of {total} photos
          </span>
          <span className="text-sm font-medium text-gray-500">{percent}%</span>
        </div>
        <div className="w-full bg-gray-100 rounded-full h-2">
          <div
            className="bg-rose-400 h-2 rounded-full transition-all duration-500 ease-out"
            style={{ width: `${percent}%` }}
          />
        </div>

        {/* Baby info row */}
        <div className="flex items-center justify-between mt-2">
          {hasInfo ? (
            <div className="flex items-center gap-1.5 min-w-0">
              {pendingBabyName && (
                <span className="text-xs font-semibold text-gray-700 truncate">
                  {pendingBabyName}
                </span>
              )}
              {pendingBabyName && (pendingBabyBirthdate || birthdateOptOut) && (
                <span className="text-xs text-gray-300">·</span>
              )}
              {pendingBabyBirthdate && !birthdateOptOut ? (
                <span className="text-xs text-gray-400">
                  b. {formatBirthdate(pendingBabyBirthdate)}
                </span>
              ) : birthdateOptOut ? (
                <span className="text-xs text-gray-400">no reminders</span>
              ) : null}
            </div>
          ) : (
            <span className="text-xs text-gray-400">No baby info added yet</span>
          )}
          <button
            onClick={() => setShowBabyInfoModal(true)}
            className="ml-2 shrink-0 flex items-center gap-1 text-xs text-gray-400 hover:text-rose-500 transition-colors"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
            </svg>
            {hasInfo ? "Edit" : "Add"}
          </button>
        </div>
      </div>
    </div>
  );
}
