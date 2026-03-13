"use client";

import { usePhotoStore } from "@/store/photo-store";

export function DetailsModeToggle() {
  const detailsMode = usePhotoStore((s) => s.detailsMode);
  const setDetailsMode = usePhotoStore((s) => s.setDetailsMode);

  return (
    <div className="mx-4 mb-4 p-3 rounded-xl bg-rose-50/60 border border-rose-100">
      <div className="flex items-center justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-800">
            Capture book details too?
          </p>
          <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">
            Jot down details while they&apos;re fresh — we&apos;ll include a
            reference sheet in your download.
          </p>
        </div>
        <button
          role="switch"
          aria-checked={detailsMode}
          onClick={() => setDetailsMode(!detailsMode)}
          className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-rose-400 focus:ring-offset-2 ${
            detailsMode ? "bg-rose-400" : "bg-gray-200"
          }`}
        >
          <span
            className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
              detailsMode ? "translate-x-5" : "translate-x-0"
            }`}
          />
        </button>
      </div>
    </div>
  );
}
