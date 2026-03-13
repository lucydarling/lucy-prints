"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { usePhotoStore } from "@/store/photo-store";
import { getSlotsBySection } from "@/lib/photo-slots";
import { ProgressBar } from "@/components/ProgressBar";
import { SectionGroup } from "@/components/SectionGroup";
import { ExtraSlotCard } from "@/components/ExtraSlotCard";
import { CropModal } from "@/components/CropModal";
import { SaveButton } from "@/components/SaveButton";
import { SaveProgressModal } from "@/components/SaveProgressModal";
import { DetailsModeToggle } from "@/components/DetailsModeToggle";
import { useAutoUpload } from "@/hooks/useAutoUpload";
import { useNotesSync } from "@/hooks/useNotesSync";

export default function UploadPage() {
  const bookTheme = usePhotoStore((s) => s.bookTheme);
  const initializeSlots = usePhotoStore((s) => s.initializeSlots);
  const photos = usePhotoStore((s) => s.photos);
  const extras = usePhotoStore((s) => s.extras);
  const router = useRouter();

  // Background photo upload to cloud
  useAutoUpload();
  // Debounced sync of notes/detailsMode to cloud
  useNotesSync();

  useEffect(() => {
    if (!bookTheme) {
      router.push("/");
      return;
    }
    initializeSlots();
  }, [bookTheme, initializeSlots, router]);

  if (!bookTheme) return null;

  const sections = getSlotsBySection();
  const uploaded = Object.values(photos).filter(
    (p) => p.status === "cropped" || p.status === "uploaded"
  ).length;

  return (
    <div className="min-h-screen bg-gray-50">
      <ProgressBar />

      {/* Page header */}
      <div className="px-4 pt-4 pb-2 max-w-2xl mx-auto">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <h1 className="text-xl font-bold text-gray-900">Your Photos</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              Upload photos for each section of your memory book. We&apos;ll print
              them at the perfect size.
            </p>
          </div>
          <div className="ml-3 mt-1 shrink-0">
            <SaveButton />
          </div>
        </div>
      </div>

      {/* Details mode toggle */}
      <div className="max-w-2xl mx-auto">
        <DetailsModeToggle />
      </div>

      {/* Sections */}
      <div className="max-w-2xl mx-auto pb-24 pt-2">
        {sections.map(({ section, label, slots }) => (
          <SectionGroup
            key={section}
            section={section}
            label={label}
            slots={slots}
          />
        ))}

        {/* Extra Prints section */}
        <div className="mb-6 px-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-base font-semibold text-gray-800">
              Extra Prints
            </h2>
            <span className="text-xs text-gray-400 font-medium">Optional</span>
          </div>

          {/* Existing extras */}
          {extras.length > 0 && (
            <div className="space-y-2 mb-3">
              {extras.map((extra) => (
                <ExtraSlotCard key={extra.id} extra={extra} />
              ))}
            </div>
          )}

          <div className="p-4 rounded-xl bg-white border border-gray-100 shadow-sm text-center">
            <p className="text-sm text-gray-500 mb-3">
              {extras.length > 0
                ? "Add another print?"
                : "Need more prints for the blank pages at the back of your book?"}
            </p>
            <div className="flex gap-2 justify-center flex-wrap">
              <ExtraButton size="3x3" />
              <ExtraButton size="4x4" />
              <ExtraButton size="4x6" />
            </div>
          </div>
        </div>
      </div>

      {/* Floating review button */}
      {uploaded > 0 && (
        <div className="fixed bottom-0 inset-x-0 p-4 bg-white/95 backdrop-blur-sm border-t border-gray-100 safe-bottom">
          <div className="max-w-2xl mx-auto">
            <button
              onClick={() => router.push("/review")}
              className="w-full py-3 bg-rose-500 hover:bg-rose-600 text-white font-semibold rounded-xl transition-colors text-sm"
            >
              Download Your Photos ({uploaded} photos)
            </button>
          </div>
        </div>
      )}

      {/* Save progress modal */}
      <SaveProgressModal />

      {/* Crop modal */}
      <CropModal />
    </div>
  );
}

function ExtraButton({ size }: { size: "3x3" | "4x4" | "4x6" }) {
  const addExtra = usePhotoStore((s) => s.addExtra);

  return (
    <button
      onClick={() => addExtra(size)}
      className="px-4 py-2 text-xs font-medium text-rose-600 bg-rose-50 rounded-full hover:bg-rose-100 transition-colors"
    >
      + Add {size}&quot; print
    </button>
  );
}
