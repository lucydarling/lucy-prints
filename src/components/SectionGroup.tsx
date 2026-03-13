"use client";

import { type PhotoSlot } from "@/lib/photo-slots";
import { usePhotoStore } from "@/store/photo-store";
import {
  getStandaloneAfterSection,
  countSectionDetailProgress,
} from "@/lib/book-prompts";
import { PhotoSlotCard } from "./PhotoSlotCard";
import { StandaloneDetailCard } from "./StandaloneDetailCard";

interface SectionGroupProps {
  section: string;
  label: string;
  slots: PhotoSlot[];
}

export function SectionGroup({ section, label, slots }: SectionGroupProps) {
  const photos = usePhotoStore((s) => s.photos);
  const detailsMode = usePhotoStore((s) => s.detailsMode);
  const notes = usePhotoStore((s) => s.notes);

  const completed = slots.filter((slot) => {
    const photo = photos[slot.key];
    return photo && (photo.status === "cropped" || photo.status === "uploaded");
  }).length;

  // Standalone detail cards that appear after this section
  const standaloneCards = detailsMode
    ? getStandaloneAfterSection(section)
    : [];

  // Detail progress for this section (only when detailsMode is on)
  const detailProgress = detailsMode
    ? countSectionDetailProgress(section, notes)
    : null;

  return (
    <div className="mb-6">
      {/* Section header */}
      <div className="flex items-center justify-between px-4 mb-2">
        <h2 className="text-base font-semibold text-gray-800">{label}</h2>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400 font-medium">
            {completed}/{slots.length}
          </span>
          {detailProgress && detailProgress.total > 0 && (
            <>
              <span className="text-xs text-gray-300">&middot;</span>
              <span
                className={`text-xs font-medium ${
                  detailProgress.filled > 0 ? "text-rose-400" : "text-gray-300"
                }`}
              >
                {detailProgress.filled}/{detailProgress.total} 📝
              </span>
            </>
          )}
        </div>
      </div>

      {/* Cards */}
      <div className="px-4 space-y-2">
        {slots.map((slot) => (
          <PhotoSlotCard key={slot.key} slot={slot} />
        ))}
      </div>

      {/* Standalone detail cards after this section */}
      {standaloneCards.length > 0 && (
        <div className="px-4 mt-3 space-y-2">
          {standaloneCards.map((entry) => (
            <StandaloneDetailCard key={entry.slotKey} entry={entry} />
          ))}
        </div>
      )}
    </div>
  );
}
