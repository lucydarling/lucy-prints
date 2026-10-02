"use client";

import { getBookSlots, type PhotoSlot } from "@/lib/photo-slots";
import { usePhotoStore } from "@/store/photo-store";
import {
  getStandaloneAfterSection,
  countSectionDetailProgress,
} from "@/lib/book-prompts";
import { PhotoSlotCard } from "./PhotoSlotCard";
import { StandaloneDetailCard } from "./StandaloneDetailCard";
import { RegionCard } from "./RegionCard";

interface SectionGroupProps {
  section: string;
  label: string;
  slots: PhotoSlot[];
}

export function SectionGroup({ section, label, slots }: SectionGroupProps) {
  const photos = usePhotoStore((s) => s.photos);
  const detailsMode = usePhotoStore((s) => s.detailsMode);
  const notes = usePhotoStore((s) => s.notes);
  const bookTheme = usePhotoStore((s) => s.bookTheme);
  const regionLayouts = usePhotoStore((s) => s.regionLayouts);

  // A region (several photos on one page) shows as one card and counts once.
  const items: ({ kind: "slot"; slot: PhotoSlot } | { kind: "region"; key: string })[] = [];
  for (const slot of slots) {
    if (!slot.region) items.push({ kind: "slot", slot });
    else if (!items.some((i) => i.kind === "region" && i.key === slot.region)) {
      items.push({ kind: "region", key: slot.region });
    }
  }
  const inUse = getBookSlots(bookTheme, regionLayouts);
  const isFilled = (key: string) => {
    const photo = photos[key];
    return Boolean(photo && (photo.status === "cropped" || photo.status === "uploaded"));
  };
  const completed = items.filter((item) =>
    item.kind === "slot"
      ? isFilled(item.slot.key)
      : inUse.some((s) => s.region === item.key && isFilled(s.key))
  ).length;

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
            {completed}/{items.length}
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
        {items.map((item) =>
          item.kind === "slot" ? (
            <PhotoSlotCard key={item.slot.key} slot={item.slot} />
          ) : (
            <RegionCard key={item.key} regionKey={item.key} />
          )
        )}
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
