"use client";

import { useEffect, useRef, useState } from "react";
import { usePhotoStore } from "@/store/photo-store";
import { prepareImageFile } from "@/lib/image-prep";
import {
  EXTRA_PAGES_PER_AGE,
  extraPagesFor,
  isAgeFull,
  recordReminderShown,
  reminderShown,
  type LittleYearsAge,
} from "@/lib/extra-pages";
import { ExtraSlotCard } from "./ExtraSlotCard";

interface ExtraPagesCardProps {
  themeId: string;
  age: LittleYearsAge;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
}

/**
 * The Little Years: after each age's Snapshots, an optional card for photos
 * for the age's 6 blank pages (up to 24 4x4 prints). Collapsed by default.
 * When the age's own slots are all cropped, a one-time note (per age, per
 * browser) points to it. DRAFT copy, pending Haily's pass.
 */
export function ExtraPagesCard({ themeId, age, expanded, onExpandedChange }: ExtraPagesCardProps) {
  const allExtras = usePhotoStore((s) => s.extras);
  const addExtraPage = usePhotoStore((s) => s.addExtraPage);
  const setExtraPhoto = usePhotoStore((s) => s.setExtraPhoto);
  const setEditingSlot = usePhotoStore((s) => s.setEditingSlot);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isConverting, setIsConverting] = useState(false);
  const [showReminder, setShowReminder] = useState(false);

  const pages = extraPagesFor(allExtras, age.age);
  const atCap = pages.length >= EXTRA_PAGES_PER_AGE;

  // Once per age per browser: only shown if it can be recorded as shown.
  useEffect(() => {
    const check = (state: { photos: Parameters<typeof isAgeFull>[0] }) => {
      if (
        isAgeFull(state.photos, age) &&
        reminderShown(themeId, age.age) === false &&
        recordReminderShown(themeId, age.age)
      ) {
        setShowReminder(true);
      }
    };
    check(usePhotoStore.getState());
    return usePhotoStore.subscribe(check);
  }, [themeId, age]);

  const handleFile = async (file: File) => {
    setIsConverting(true);
    const result = await prepareImageFile(file);
    setIsConverting(false);
    if (!result.ok) {
      alert(result.error);
      return;
    }
    const id = addExtraPage(age.age);
    if (!id) return;
    setExtraPhoto(id, result.url);
    setEditingSlot(id);
  };

  return (
    <div className="mb-6 px-4">
      {showReminder && (
        <p className="mb-2 px-1 text-sm text-gray-600">
          {age.label} is full. It also has{" "}
          <button
            onClick={() => onExpandedChange(true)}
            className="font-medium text-rose-600 underline underline-offset-2 hover:text-rose-700"
          >
            6 blank pages
          </button>{" "}
          if you&apos;d like more photos.
        </p>
      )}

      <div className="rounded-xl bg-white border border-gray-100 shadow-sm">
        <button
          onClick={() => onExpandedChange(!expanded)}
          aria-expanded={expanded}
          className="w-full flex items-center justify-between gap-3 p-4 text-left"
        >
          <span className="text-base font-semibold text-gray-800">Extra pages</span>
          <span className="flex items-center gap-2 text-xs font-medium text-gray-400">
            {pages.length > 0 ? `${pages.length} of ${EXTRA_PAGES_PER_AGE} added` : "Optional"}
            <svg
              className={`w-4 h-4 transition-transform ${expanded ? "rotate-180" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </span>
        </button>

        {expanded && (
          <div className="px-4 pb-4">
            <p className="text-sm text-gray-500 mb-3">
              {age.label} also has 6 blank pages. Add up to {EXTRA_PAGES_PER_AGE} more 4x4 photos to fill them.
            </p>

            {pages.length > 0 && (
              <div className="space-y-2 mb-3">
                {pages.map((extra, i) => (
                  <ExtraSlotCard key={extra.id} extra={extra} label={`Extra page ${i + 1}`} />
                ))}
              </div>
            )}

            <div className="text-center">
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={atCap || isConverting}
                className="px-4 py-2 text-xs font-medium text-rose-600 bg-rose-50 rounded-full hover:bg-rose-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isConverting ? "Converting…" : "Add a photo"}
              </button>
            </div>
          </div>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,.heic,.heif"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
          e.target.value = "";
        }}
        className="hidden"
      />
    </div>
  );
}
