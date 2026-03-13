"use client";

import { useRef } from "react";
import { Cropper, CropperRef } from "react-advanced-cropper";
import "react-advanced-cropper/dist/style.css";
import { usePhotoStore } from "@/store/photo-store";
import { PHOTO_SLOTS } from "@/lib/photo-slots";

export function CropModal() {
  const editingSlot = usePhotoStore((s) => s.editingSlot);
  const photos = usePhotoStore((s) => s.photos);
  const setCropped = usePhotoStore((s) => s.setCropped);
  const setEditingSlot = usePhotoStore((s) => s.setEditingSlot);
  const cropperRef = useRef<CropperRef>(null);

  if (!editingSlot) return null;

  const photo = photos[editingSlot];
  const slot = PHOTO_SLOTS.find((s) => s.key === editingSlot);
  if (!photo?.previewUrl || !slot) return null;

  const cropWidth =
    slot.size === "4x6" ? 1200 : slot.size === "4x4" ? 1200 : 900;
  const cropHeight =
    slot.size === "4x6" ? 1800 : slot.size === "4x4" ? 1200 : 900;
  const aspectRatio = slot.size === "4x6" ? 2 / 3 : 1;

  const handleDone = () => {
    const canvas = cropperRef.current?.getCanvas({
      // 300 DPI: 3x3 = 900px, 4x4 = 1200px, 4x6 = 1200x1800px
      width: cropWidth,
      height: cropHeight,
    });
    if (canvas) {
      const dataUrl = canvas.toDataURL("image/jpeg", 0.95);
      setCropped(editingSlot, dataUrl);
    }
    setEditingSlot(null);
  };

  const handleCancel = () => {
    setEditingSlot(null);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/90 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-black/50">
        <button
          onClick={handleCancel}
          className="text-white/80 hover:text-white text-sm font-medium"
        >
          Cancel
        </button>
        <div className="text-center">
          <p className="text-white text-sm font-medium">{slot.prompt}</p>
          <p className="text-white/60 text-xs">
            {slot.size}&quot; {aspectRatio === 1 ? "square" : "portrait"} crop
          </p>
        </div>
        <button
          onClick={handleDone}
          className="text-rose-400 hover:text-rose-300 text-sm font-semibold"
        >
          Done
        </button>
      </div>

      {/* Cropper */}
      <div className="flex-1 relative">
        <Cropper
          ref={cropperRef}
          src={photo.previewUrl}
          stencilProps={{
            aspectRatio,
          }}
          className="h-full"
        />
      </div>

      {/* Footer hint */}
      <div className="px-4 py-3 bg-black/50 text-center">
        <p className="text-white/60 text-xs">
          Pinch to zoom. Drag to position. Photo will print at {slot.size}
          &quot; at 300 DPI.
        </p>
      </div>
    </div>
  );
}
