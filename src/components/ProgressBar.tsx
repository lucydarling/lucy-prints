"use client";

import { usePhotoStore } from "@/store/photo-store";
import { PHOTO_SLOTS } from "@/lib/photo-slots";

export function ProgressBar() {
  const photos = usePhotoStore((s) => s.photos);
  const total = PHOTO_SLOTS.length;
  const uploaded = Object.values(photos).filter(
    (p) => p.status === "cropped" || p.status === "uploaded"
  ).length;
  const percent = total > 0 ? Math.round((uploaded / total) * 100) : 0;

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
      </div>
    </div>
  );
}
