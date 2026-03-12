"use client";

import { type PhotoSlot } from "@/lib/photo-slots";
import { usePhotoStore } from "@/store/photo-store";
import { PhotoSlotCard } from "./PhotoSlotCard";

interface SectionGroupProps {
  section: string;
  label: string;
  slots: PhotoSlot[];
}

export function SectionGroup({ label, slots }: SectionGroupProps) {
  const photos = usePhotoStore((s) => s.photos);

  const completed = slots.filter((slot) => {
    const photo = photos[slot.key];
    return photo && (photo.status === "cropped" || photo.status === "uploaded");
  }).length;

  return (
    <div className="mb-6">
      {/* Section header */}
      <div className="flex items-center justify-between px-4 mb-2">
        <h2 className="text-base font-semibold text-gray-800">{label}</h2>
        <span className="text-xs text-gray-400 font-medium">
          {completed}/{slots.length}
        </span>
      </div>

      {/* Cards */}
      <div className="px-4 space-y-2">
        {slots.map((slot) => (
          <PhotoSlotCard key={slot.key} slot={slot} />
        ))}
      </div>
    </div>
  );
}
