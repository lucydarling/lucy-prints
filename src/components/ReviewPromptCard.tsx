"use client";

import { useEffect, useRef, useState } from "react";
import { BOOK_THEMES } from "@/lib/photo-slots";
import { getReviewUrl, type ReviewSource } from "@/lib/review-links";
import { canAsk, readReviewState, recordAsk, recordClick } from "@/lib/review-prompt";

/** Presentational card. The caller decides when to show it and counts the ask. */
export function ReviewPromptCard({
  themeId,
  source,
  onClose,
  className = "mt-3",
}: {
  themeId: string;
  source: ReviewSource;
  onClose?: () => void;
  className?: string;
}) {
  const [hidden, setHidden] = useState(false);
  const url = getReviewUrl(themeId, source);
  const theme = BOOK_THEMES.find((t) => t.id === themeId);
  if (hidden || !url || !theme) return null;

  const close = () => {
    setHidden(true);
    onClose?.();
  };

  return (
    <div className={`${className} p-4 rounded-xl bg-rose-50 border border-rose-100`}>
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
          onClick={() => {
            recordClick(themeId);
            close();
          }}
          className="px-4 py-2 rounded-lg bg-rose-500 text-white text-xs font-semibold hover:bg-rose-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-2"
        >
          Write a review
        </a>
        <button
          type="button"
          onClick={close}
          className="text-xs text-gray-500 hover:text-gray-700 underline focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 rounded"
        >
          Maybe later
        </button>
      </div>
    </div>
  );
}

/**
 * Post-download ask. Counts against the same 2-ask cap as the milestone asks;
 * if storage is unavailable it still shows (the one ask we can't cap).
 */
export function DownloadReviewPrompt({ themeId }: { themeId: string }) {
  const [show] = useState(() => {
    const s = readReviewState(themeId);
    return s === null || canAsk(s);
  });
  const counted = useRef(false);
  useEffect(() => {
    if (!show || counted.current) return;
    counted.current = true;
    recordAsk(themeId);
  }, [show, themeId]);
  if (!show) return null;
  return <ReviewPromptCard themeId={themeId} source="after_download" />;
}
