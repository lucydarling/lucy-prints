"use client";

import { useEffect, useState } from "react";
import { usePhotoStore } from "@/store/photo-store";
import { getReviewUrl, type ReviewSource } from "@/lib/review-links";
import { countCropped, milestoneFor, readReviewState, recordAsk } from "@/lib/review-prompt";
import { getBookSlots } from "@/lib/photo-slots";
import { ReviewPromptCard } from "@/components/ReviewPromptCard";

/**
 * Inline (never modal) review ask shown on /upload when the cropped-photo count
 * RISES past 10 or 25. It subscribes to the store after mount, so counts that
 * arrive by rehydrate or resume never trigger it. With no usable localStorage
 * there are no milestone asks.
 */
export function ReviewMilestoneBanner({ themeId }: { themeId: string }) {
  const [ask, setAsk] = useState<{ source: ReviewSource; id: number } | null>(null);

  useEffect(() => {
    const st = usePhotoStore.getState();
    if (!getReviewUrl(themeId)) return; // unmapped theme: never ask, never burn an ask
    let prev = countCropped(st.photos, st.extras, getBookSlots(st.bookTheme, st.regionLayouts));
    return usePhotoStore.subscribe((state) => {
      const next = countCropped(state.photos, state.extras, getBookSlots(state.bookTheme, state.regionLayouts));
      const source = milestoneFor(prev, next, readReviewState(themeId));
      prev = next;
      if (source && recordAsk(themeId)) setAsk({ source, id: Date.now() });
    });
  }, [themeId]);

  if (!ask) return null;
  return (
    <div className="sticky top-2 z-30 px-4 max-w-2xl mx-auto">
      <ReviewPromptCard
        key={ask.id}
        themeId={themeId}
        source={ask.source}
        className="shadow-md"
        onClose={() => setAsk(null)}
      />
    </div>
  );
}
