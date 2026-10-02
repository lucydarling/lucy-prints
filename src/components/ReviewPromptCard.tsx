"use client";

import { useState } from "react";
import { BOOK_THEMES } from "@/lib/photo-slots";
import { getReviewUrl } from "@/lib/review-links";

const storageKey = (themeId: string) => `ld_review_prompt_${themeId}`;

function markSeen(themeId: string) {
  try {
    localStorage.setItem(storageKey(themeId), "1");
  } catch {
    // storage unavailable; card just hides for this view
  }
}

export function ReviewPromptCard({ themeId }: { themeId: string }) {
  // Only mounts after a download (client-side), so reading storage here is hydration-safe.
  const [visible, setVisible] = useState(() => {
    try {
      return localStorage.getItem(storageKey(themeId)) !== "1";
    } catch {
      return true;
    }
  });
  const url = getReviewUrl(themeId);
  const theme = BOOK_THEMES.find((t) => t.id === themeId);

  if (!visible || !url || !theme) return null;

  const dismiss = () => {
    markSeen(themeId);
    setVisible(false);
  };

  return (
    <div className="mt-3 p-4 rounded-xl bg-rose-50 border border-rose-100">
      <h2 className="text-sm font-semibold text-gray-800">
        How&apos;s your {theme.name} book coming along?
      </h2>
      <p className="text-xs text-gray-600 mt-1 leading-relaxed">
        If you&apos;re loving it, a quick review helps other parents find a book they&apos;ll actually finish. It takes about a minute.
      </p>
      <div className="flex items-center gap-4 mt-3">
        <a
          href={url}
          target="_blank"
          rel="noopener"
          onClick={() => markSeen(themeId)}
          className="px-4 py-2 rounded-lg bg-rose-500 text-white text-xs font-semibold hover:bg-rose-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-2"
        >
          Write a review
        </a>
        <button
          type="button"
          onClick={dismiss}
          className="text-xs text-gray-500 hover:text-gray-700 underline focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 rounded"
        >
          Maybe later
        </button>
      </div>
    </div>
  );
}
