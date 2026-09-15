"use client";

import { useEffect, useRef, useState } from "react";
import { Cropper, CropperRef } from "react-advanced-cropper";
import "react-advanced-cropper/dist/style.css";
import { usePhotoStore } from "@/store/photo-store";
import {
  PHOTO_SLOTS,
  getPrintDimensions,
  getPrintSizeLabel,
  isSquarePrintSize,
  type PrintOrientation,
  type PrintSize,
} from "@/lib/photo-slots";

export function CropModal() {
  const editingSlot = usePhotoStore((s) => s.editingSlot);
  const photos = usePhotoStore((s) => s.photos);
  const extras = usePhotoStore((s) => s.extras);
  const setCropped = usePhotoStore((s) => s.setCropped);
  const setExtraCropped = usePhotoStore((s) => s.setExtraCropped);
  const setEditingSlot = usePhotoStore((s) => s.setEditingSlot);
  const removePhoto = usePhotoStore((s) => s.removePhoto);
  const removeExtra = usePhotoStore((s) => s.removeExtra);
  const setExtraOrientation = usePhotoStore((s) => s.setExtraOrientation);
  const cropperRef = useRef<CropperRef>(null);
  const [loadError, setLoadError] = useState(false);

  // Read the editing extra's orientation up here so the refresh effect below
  // sits above the early returns and keeps a stable hook order.
  const editingOrientation = usePhotoStore((s) =>
    s.editingSlot
      ? s.extras.find((e) => e.id === s.editingSlot)?.orientation ?? null
      : null
  );
  const previousOrientation = useRef<PrintOrientation | null>(null);

  // Reset the error state whenever a different slot opens the modal.
  useEffect(() => {
    setLoadError(false);
  }, [editingSlot]);

  // Flipping orientation changes the stencil's aspect ratio — the cropper
  // needs a nudge to re-fit the crop box to the new shape.
  useEffect(() => {
    const previous = previousOrientation.current;
    if (previous && editingOrientation && previous !== editingOrientation) {
      cropperRef.current?.refresh();
    }
    previousOrientation.current = editingOrientation;
  }, [editingOrientation]);

  if (!editingSlot) return null;

  // Check regular photo slots first, then extras
  const photo = photos[editingSlot];
  const slot = PHOTO_SLOTS.find((s) => s.key === editingSlot);
  const extra = !slot ? extras.find((e) => e.id === editingSlot) : null;

  // Determine preview URL, size, and orientation. Book slots always print in
  // their natural shape; only extras carry a customer-chosen orientation.
  const previewUrl = slot ? photo?.previewUrl : extra?.previewUrl;
  const size: PrintSize = slot?.size || extra?.size || "4x4";
  const orientation: PrintOrientation | undefined = slot
    ? undefined
    : extra?.orientation;
  const sizeLabel = getPrintSizeLabel(size, orientation);
  const label = slot?.prompt || `Extra ${sizeLabel}" Print`;

  if (!previewUrl) return null;

  const { width: cropWidth, height: cropHeight } = getPrintDimensions(
    size,
    orientation
  );
  const aspectRatio = cropWidth / cropHeight;
  const canChooseOrientation = Boolean(extra) && !isSquarePrintSize(size);

  const handleDone = () => {
    const canvas = cropperRef.current?.getCanvas({
      // 300 DPI — e.g. 3x3 = 900px, 4x4 = 1200px, 4x6 = 1200x1800px,
      // and the same sizes rotated when an extra is set to landscape.
      width: cropWidth,
      height: cropHeight,
    });
    // getCanvas returns null when the image never decoded — don't close
    // silently (that's what produced empty ZIPs). Surface the failure instead.
    if (!canvas) {
      setLoadError(true);
      return;
    }
    const dataUrl = canvas.toDataURL("image/jpeg", 0.95);
    if (extra) {
      setExtraCropped(editingSlot, dataUrl);
    } else {
      setCropped(editingSlot, dataUrl);
    }
    setEditingSlot(null);
  };

  const handleCancel = () => {
    setEditingSlot(null);
  };

  // Remove the un-openable photo entirely so it can't linger as an
  // uploaded-but-uncroppable slot (which would otherwise inflate counts
  // and produce an empty ZIP).
  const handleRemoveAndClose = () => {
    if (extra) {
      removeExtra(editingSlot);
    } else {
      removePhoto(editingSlot);
    }
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
          <p className="text-white text-sm font-medium">{label}</p>
          <p className="text-white/60 text-xs">
            {sizeLabel}&quot;{" "}
            {aspectRatio === 1
              ? "square"
              : aspectRatio > 1
              ? "landscape"
              : "portrait"}{" "}
            crop
          </p>

          {/* Extras can be turned while the photo is on screen — which is the
              only point you can really tell which way it wants to go. Book
              slots print in a fixed shape, and squares look the same either
              way, so neither gets the control. */}
          {canChooseOrientation && !loadError && (
            <div
              role="group"
              aria-label="Print orientation"
              className="inline-flex mt-1.5 p-0.5 rounded-full bg-white/10"
            >
              {(["portrait", "landscape"] as const).map((option) => (
                <button
                  key={option}
                  onClick={() => setExtraOrientation(editingSlot, option)}
                  aria-pressed={orientation === option}
                  className={`px-2.5 py-0.5 text-[11px] font-medium rounded-full capitalize transition-colors ${
                    orientation === option
                      ? "bg-white text-gray-900"
                      : "text-white/60 hover:text-white"
                  }`}
                >
                  {option}
                </button>
              ))}
            </div>
          )}
        </div>
        {loadError ? (
          <span className="text-sm font-semibold text-white/30 select-none">Done</span>
        ) : (
          <button
            onClick={handleDone}
            className="text-rose-400 hover:text-rose-300 text-sm font-semibold"
          >
            Done
          </button>
        )}
      </div>

      {/* Cropper — or an inline error if the photo couldn't be opened */}
      <div className="flex-1 relative">
        {loadError ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
            <svg className="w-12 h-12 text-rose-400 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
            <p className="text-white text-sm font-medium mb-1">
              We couldn&apos;t open this photo
            </p>
            <p className="text-white/60 text-xs max-w-xs mb-5">
              This file type isn&apos;t supported for cropping. Please try a JPG or PNG version of the photo.
            </p>
            <button
              onClick={handleRemoveAndClose}
              className="px-4 py-2 bg-rose-500 hover:bg-rose-600 text-white text-sm font-semibold rounded-full transition-colors"
            >
              Remove &amp; pick another
            </button>
          </div>
        ) : (
          <Cropper
            ref={cropperRef}
            src={previewUrl}
            stencilProps={{
              aspectRatio,
            }}
            onError={() => setLoadError(true)}
            className="h-full"
          />
        )}
      </div>

      {/* Footer hint */}
      {!loadError && (
        <div className="px-4 py-3 bg-black/50 text-center">
          <p className="text-white/60 text-xs">
            Pinch to zoom. Drag to position. Photo will print at {sizeLabel}
            &quot; at 300 DPI.
          </p>
        </div>
      )}
    </div>
  );
}
