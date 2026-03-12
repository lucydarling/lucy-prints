"use client";

import { useRouter } from "next/navigation";
import Image from "next/image";
import { usePhotoStore } from "@/store/photo-store";
import { PHOTO_SLOTS } from "@/lib/photo-slots";

export default function ReviewPage() {
  const photos = usePhotoStore((s) => s.photos);
  const extras = usePhotoStore((s) => s.extras);
  const bookTheme = usePhotoStore((s) => s.bookTheme);
  const router = useRouter();

  if (!bookTheme) {
    return null;
  }

  const uploadedSlots = PHOTO_SLOTS.filter((slot) => {
    const photo = photos[slot.key];
    return photo && photo.status !== "empty";
  });

  const count4x4 =
    uploadedSlots.filter((s) => s.size === "4x4").length +
    extras.filter((e) => e.size === "4x4" && e.croppedUrl).length;
  const count3x3 =
    uploadedSlots.filter((s) => s.size === "3x3").length +
    extras.filter((e) => e.size === "3x3" && e.croppedUrl).length;
  const totalPhotos = count4x4 + count3x3;
  const missingCount = PHOTO_SLOTS.length - uploadedSlots.length;

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
          <h1 className="text-lg font-bold text-gray-900">Review Your Order</h1>
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
                  className="aspect-square rounded-lg overflow-hidden bg-gray-100 relative"
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
            {count4x4 > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">
                  4x4&quot; prints x {count4x4}
                </span>
                <span className="text-gray-400">Pricing TBD</span>
              </div>
            )}
            {count3x3 > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">
                  3x3&quot; prints x {count3x3}
                </span>
                <span className="text-gray-400">Pricing TBD</span>
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

        {/* Checkout button */}
        <button
          disabled
          className="w-full py-3 bg-rose-500 text-white font-semibold rounded-xl text-sm opacity-50 cursor-not-allowed"
        >
          Checkout Coming Soon
        </button>
        <p className="text-xs text-gray-400 text-center mt-2">
          Shopify checkout and Persnickety Prints fulfillment coming in Phase 2
        </p>
      </div>
    </div>
  );
}
