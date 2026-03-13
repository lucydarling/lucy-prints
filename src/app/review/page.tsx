"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { usePhotoStore } from "@/store/photo-store";
import { useSaveStore } from "@/store/save-store";
import { PHOTO_SLOTS } from "@/lib/photo-slots";
import { downloadPhotosZip } from "@/lib/download-zip";

export default function ReviewPage() {
  const photos = usePhotoStore((s) => s.photos);
  const extras = usePhotoStore((s) => s.extras);
  const bookTheme = usePhotoStore((s) => s.bookTheme);
  const notes = usePhotoStore((s) => s.notes);
  const babyName = useSaveStore((s) => s.babyName);
  const sessionId = useSaveStore((s) => s.sessionId);
  const setShowSaveModal = useSaveStore((s) => s.setShowSaveModal);
  const router = useRouter();
  const [downloading, setDownloading] = useState(false);
  const pendingDownload = useRef(false);
  const [pad3x3, setPad3x3] = useState(false);
  const [show3x3Info, setShow3x3Info] = useState(false);

  useEffect(() => {
    if (!bookTheme) {
      router.replace("/");
    }
  }, [bookTheme, router]);

  if (!bookTheme) {
    return null;
  }

  const uploadedSlots = PHOTO_SLOTS.filter((slot) => {
    const photo = photos[slot.key];
    return photo && photo.status !== "empty";
  });

  const count4x6 =
    uploadedSlots.filter((s) => s.size === "4x6").length +
    extras.filter((e) => e.size === "4x6" && e.croppedUrl).length;
  const count4x3 =
    uploadedSlots.filter((s) => s.size === "4x3").length +
    extras.filter((e) => e.size === "4x3" && e.croppedUrl).length;
  const count4x4 =
    uploadedSlots.filter((s) => s.size === "4x4").length +
    extras.filter((e) => e.size === "4x4" && e.croppedUrl).length;
  const count3x3 =
    uploadedSlots.filter((s) => s.size === "3x3").length +
    extras.filter((e) => e.size === "3x3" && e.croppedUrl).length;
  const totalPhotos = count4x6 + count4x3 + count4x4 + count3x3;
  const missingCount = PHOTO_SLOTS.length - uploadedSlots.length;

  const executeDownload = async () => {
    setDownloading(true);
    try {
      await downloadPhotosZip(photos, extras, bookTheme!, {
        pad3x3to4x4: pad3x3 && count3x3 > 0,
        babyName,
        notes,
      });
    } catch (err) {
      console.error("Download error:", err);
      alert("Something went wrong creating the download. Please try again.");
    } finally {
      setDownloading(false);
    }
  };

  // After save modal completes, auto-trigger the pending download
  useEffect(() => {
    if (pendingDownload.current && sessionId) {
      pendingDownload.current = false;
      executeDownload();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  const handleDownload = () => {
    if (downloading) return;
    if (!sessionId) {
      pendingDownload.current = true;
      setShowSaveModal(true);
      return;
    }
    executeDownload();
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-100">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center gap-3">
          <button
            onClick={() => router.push("/upload")}
            className="p-1 -ml-1 text-gray-400 hover:text-gray-600"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15.75 19.5L8.25 12l7.5-7.5"
              />
            </svg>
          </button>
          <h1 className="text-lg font-bold text-gray-900">Your Photos</h1>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6">
        {/* Photo grid preview */}
        <div className="mb-6">
          <h2 className="text-sm font-semibold text-gray-800 mb-3">
            Your Photos ({totalPhotos})
          </h2>
          <div className="grid grid-cols-4 gap-2">
            {uploadedSlots.map((slot) => {
              const photo = photos[slot.key];
              const url = photo?.croppedUrl || photo?.previewUrl;
              return (
                <div
                  key={slot.key}
                  className={`${slot.size === "4x6" ? "aspect-[2/3]" : slot.size === "4x3" ? "aspect-[4/3]" : "aspect-square"} rounded-lg overflow-hidden bg-gray-100 relative`}
                >
                  {url && (
                    <Image
                      src={url}
                      alt={slot.prompt}
                      fill
                      unoptimized
                      className="object-cover"
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Missing photos warning */}
        {missingCount > 0 && (
          <div className="mb-6 p-4 rounded-xl bg-amber-50 border border-amber-200">
            <p className="text-sm text-amber-800 font-medium">
              {missingCount} photo{missingCount > 1 ? "s" : ""} not yet uploaded
            </p>
            <p className="text-xs text-amber-600 mt-1">
              You can still order what you have and come back for the rest later.
            </p>
            <button
              onClick={() => router.push("/upload")}
              className="mt-2 text-xs font-medium text-amber-700 underline"
            >
              Go back and add more
            </button>
          </div>
        )}

        {/* Order summary */}
        <div className="p-4 rounded-xl bg-white border border-gray-100 shadow-sm mb-6">
          <h2 className="text-sm font-semibold text-gray-800 mb-3">
            Order Summary
          </h2>
          <div className="space-y-2">
            {count4x6 > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">
                  4x6&quot; prints x {count4x6}
                </span>
                <span className="text-gray-400">Included</span>
              </div>
            )}
            {count4x3 > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">
                  4x3&quot; prints x {count4x3}
                </span>
                <span className="text-gray-400">Included</span>
              </div>
            )}
            {count4x4 > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">
                  4x4&quot; prints x {count4x4}
                </span>
                <span className="text-gray-400">Included</span>
              </div>
            )}
            {count3x3 > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">
                  3x3&quot; prints x {count3x3}
                </span>
                <span className="text-gray-400">Included</span>
              </div>
            )}
            <div className="border-t border-gray-100 pt-2 mt-2">
              <div className="flex justify-between text-sm font-semibold">
                <span className="text-gray-800">Total prints</span>
                <span className="text-gray-800">{totalPhotos}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Download section — primary action */}
        {totalPhotos > 0 && (
          <div className="mb-4">
            {/* 3x3 print compatibility option */}
            {count3x3 > 0 && (
              <div className="mb-3 p-3 rounded-xl bg-gray-50 border border-gray-100">
                <label className="flex items-center gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={pad3x3}
                    onChange={(e) => setPad3x3(e.target.checked)}
                    className="w-4 h-4 rounded accent-[#FAB8A9] shrink-0"
                  />
                  <span className="text-sm text-gray-700">
                    Make 3x3&quot; photos printable as 4x4&quot;
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      setShow3x3Info(!show3x3Info);
                    }}
                    className="text-xs text-gray-400 hover:text-gray-600 underline shrink-0 ml-auto"
                  >
                    {show3x3Info ? "Hide" : "Why?"}
                  </button>
                </label>
                {show3x3Info && (
                  <p className="text-xs text-gray-400 mt-2 ml-[26px] leading-relaxed">
                    Most print services don&apos;t offer a 3x3&quot; option. When this is checked, your 3x3&quot; photos will be placed on a 4x4&quot; sheet with trim guides — just order 4x4&quot; prints and cut along the lines.
                  </p>
                )}
              </div>
            )}

            <button
              onClick={handleDownload}
              disabled={downloading}
              className="w-full py-3 bg-[#FAB8A9] text-white font-semibold rounded-xl text-sm hover:bg-[#f5a898] disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
            >
              {downloading ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Creating ZIP...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  Download Photos
                </>
              )}
            </button>
            <p className="text-xs text-gray-400 text-center mt-2">
              Print at home or drop into any photo lab
            </p>
          </div>
        )}

        {/* Coming soon note */}
        <div className="p-3 rounded-xl bg-rose-50 border border-rose-100 text-center">
          <p className="text-xs text-rose-400 font-medium">
            Direct print ordering coming soon
          </p>
          <p className="text-xs text-rose-300 mt-0.5">
            We&apos;re working on connecting Lucy Darling prints directly — wanted to get this into your hands right away.
          </p>
        </div>
      </div>
    </div>
  );
}
