"use client";

import { useRef, useState, useCallback } from "react";
import Image from "next/image";
import { type PhotoSlot } from "@/lib/photo-slots";
import { usePhotoStore } from "@/store/photo-store";

interface PhotoSlotCardProps {
  slot: PhotoSlot;
}

export function PhotoSlotCard({ slot }: PhotoSlotCardProps) {
  const photo = usePhotoStore((s) => s.photos[slot.key]);
  const setPhoto = usePhotoStore((s) => s.setPhoto);
  const setEditingSlot = usePhotoStore((s) => s.setEditingSlot);
  const setCustomLabel = usePhotoStore((s) => s.setCustomLabel);
  const setMilestoneDate = usePhotoStore((s) => s.setMilestoneDate);
  const removePhoto = usePhotoStore((s) => s.removePhoto);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isEditingLabel, setIsEditingLabel] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);

  const hasPhoto = photo && (photo.previewUrl || photo.croppedUrl);
  const displayUrl = photo?.croppedUrl || photo?.previewUrl;

  const handleFile = useCallback(
    (file: File) => {
      if (!file.type.startsWith("image/")) return;
      const url = URL.createObjectURL(file);
      setPhoto(slot.key, url);
      setEditingSlot(slot.key);
    },
    [slot.key, setPhoto, setEditingSlot]
  );

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    handleFile(file);
    e.target.value = "";
  };

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);
      const file = e.dataTransfer.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const handleClick = () => {
    if (hasPhoto) {
      setEditingSlot(slot.key);
    } else {
      fileInputRef.current?.click();
    }
  };

  const promptText =
    slot.customLabel && photo?.customLabel ? photo.customLabel : slot.prompt;

  return (
    <div
      className={`flex items-center gap-3 p-3 rounded-xl bg-white border shadow-sm transition-colors ${
        isDragOver
          ? "border-rose-400 bg-rose-50"
          : "border-gray-100"
      }`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Thumbnail / Upload area */}
      <button
        onClick={handleClick}
        className={`relative flex-shrink-0 rounded-lg overflow-hidden flex items-center justify-center
          ${slot.size === "4x6" ? "w-14 h-20" : slot.size === "4x4" ? "w-16 h-16" : "w-14 h-14"}
          ${hasPhoto ? "bg-gray-100" : "bg-rose-50 border-2 border-dashed border-rose-200 hover:border-rose-300"}
          transition-colors`}
      >
        {hasPhoto && displayUrl ? (
          <>
            <Image
              src={displayUrl}
              alt={promptText}
              fill
              unoptimized
              className="object-cover"
            />
            {photo?.status === "cropped" && (
              <div className="absolute top-0.5 right-0.5 w-4 h-4 bg-emerald-500 rounded-full flex items-center justify-center">
                <svg
                  className="w-2.5 h-2.5 text-white"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={3}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              </div>
            )}
          </>
        ) : (
          <svg
            className={`w-6 h-6 ${isDragOver ? "text-rose-500" : "text-rose-300"}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 4.5v15m7.5-7.5h-15"
            />
          </svg>
        )}
      </button>

      {/* Label + size + date */}
      <div className="flex-1 min-w-0">
        {slot.customLabel && !hasPhoto ? (
          isEditingLabel ? (
            <input
              type="text"
              autoFocus
              placeholder="My First ___"
              defaultValue={photo?.customLabel || ""}
              onBlur={(e) => {
                if (e.target.value.trim()) {
                  setCustomLabel(slot.key, e.target.value.trim());
                }
                setIsEditingLabel(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  (e.target as HTMLInputElement).blur();
                }
              }}
              className="text-sm font-medium text-gray-800 w-full border-b border-rose-300 focus:border-rose-500 outline-none bg-transparent pb-0.5"
            />
          ) : (
            <button
              onClick={() => setIsEditingLabel(true)}
              className="text-sm font-medium text-gray-400 italic hover:text-gray-600 text-left"
            >
              {photo?.customLabel || "Tap to name this first..."}
            </button>
          )
        ) : (
          <p className="text-sm font-medium text-gray-800 truncate">
            {promptText}
          </p>
        )}
        <p className="text-xs text-gray-400 mt-0.5">
          {slot.size}&quot; print
        </p>
        {slot.dateField && (
          <input
            type="date"
            value={photo?.milestoneDate || ""}
            onChange={(e) => setMilestoneDate(slot.key, e.target.value)}
            className="mt-1 text-xs text-gray-500 border border-gray-200 rounded px-1.5 py-0.5 w-full max-w-[140px] focus:border-rose-300 focus:outline-none"
            placeholder="Date (optional)"
          />
        )}
      </div>

      {/* Actions */}
      <div className="flex-shrink-0 flex items-center gap-1">
        {hasPhoto ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              removePhoto(slot.key);
            }}
            className="p-1.5 text-gray-300 hover:text-red-400 transition-colors"
            aria-label="Remove photo"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
              />
            </svg>
          </button>
        ) : (
          <button
            onClick={() => fileInputRef.current?.click()}
            className="px-3 py-1.5 text-xs font-medium text-rose-600 bg-rose-50 rounded-full hover:bg-rose-100 transition-colors"
          >
            Upload
          </button>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileSelect}
        className="hidden"
      />
    </div>
  );
}
