"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { usePhotoStore } from "@/store/photo-store";
import { BOOK_THEMES } from "@/lib/photo-slots";

export default function Home() {
  const setBookTheme = usePhotoStore((s) => s.setBookTheme);
  const bookTheme = usePhotoStore((s) => s.bookTheme);
  const router = useRouter();

  const handleSelect = (themeId: string) => {
    setBookTheme(themeId);
    router.push("/upload");
  };

  const hasExisting = bookTheme !== null;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-100">
        <div className="max-w-2xl mx-auto px-4 py-8 text-center">
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">
            Lucy Darling
          </h1>
          <p className="text-sm text-rose-500 font-medium mt-1">Photo Prints</p>
          <p className="text-sm text-gray-500 mt-3 max-w-md mx-auto">
            Print beautiful photos sized perfectly for your memory book. We&apos;ll
            guide you through every page.
          </p>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6">
        {/* Continue existing session */}
        {hasExisting && (
          <div className="mb-6">
            <button
              onClick={() => router.push("/upload")}
              className="w-full py-4 bg-rose-500 hover:bg-rose-600 text-white font-semibold rounded-xl transition-colors text-sm shadow-sm"
            >
              Continue Your Photo Book
            </button>
            <div className="relative my-6">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-200" />
              </div>
              <div className="relative flex justify-center">
                <span className="bg-gray-50 px-3 text-xs text-gray-400">
                  or start fresh
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Theme selection */}
        <h2 className="text-base font-semibold text-gray-800 mb-3">
          {hasExisting ? "Start a New Book" : "Select Your Book Theme"}
        </h2>

        {/* Standard Memory Books */}
        <div className="grid grid-cols-2 gap-3">
          {BOOK_THEMES.filter((t) => t.tier === "standard").map((theme) => (
            <ThemeCard key={theme.id} theme={theme} onSelect={handleSelect} />
          ))}
        </div>

        {/* Luxury Memory Books */}
        <h3 className="text-sm font-semibold text-gray-700 mt-6 mb-3">
          Luxury Collection
        </h3>
        <div className="grid grid-cols-2 gap-3">
          {BOOK_THEMES.filter((t) => t.tier === "luxury").map((theme) => (
            <ThemeCard key={theme.id} theme={theme} onSelect={handleSelect} luxury />
          ))}
        </div>

        {/* Info */}
        <div className="mt-8 p-4 rounded-xl bg-white border border-gray-100">
          <h3 className="text-sm font-semibold text-gray-800 mb-2">
            How it works
          </h3>
          <ol className="text-xs text-gray-500 space-y-1.5 list-decimal list-inside">
            <li>Select your memory book theme above</li>
            <li>Upload photos — we&apos;ll tell you exactly which ones you need</li>
            <li>Crop each photo to the perfect size</li>
            <li>Order your prints — they ship right to your door</li>
            <li>Tape or glue your prints into your book</li>
          </ol>
        </div>
      </div>
    </div>
  );
}

function ThemeCard({
  theme,
  onSelect,
  luxury,
}: {
  theme: (typeof BOOK_THEMES)[number];
  onSelect: (id: string) => void;
  luxury?: boolean;
}) {
  return (
    <button
      onClick={() => onSelect(theme.id)}
      className={`group relative rounded-xl overflow-hidden border transition-all text-left ${
        luxury
          ? "border-amber-200 hover:border-amber-300 hover:shadow-md"
          : "border-gray-100 hover:border-rose-200 hover:shadow-md"
      }`}
    >
      <div
        className={`relative aspect-square ${
          luxury
            ? "bg-gradient-to-br from-amber-50 to-amber-100"
            : "bg-gradient-to-br from-rose-50 to-pink-50"
        }`}
      >
        <Image
          src={`/covers/${theme.id}.jpg`}
          alt={theme.name}
          fill
          className="object-cover"
          sizes="(max-width: 640px) 50vw, 256px"
        />
      </div>
      <div className="p-3 bg-white">
        <p className="text-sm font-medium text-gray-800 truncate">
          {theme.name}
        </p>
        <p className="text-xs text-gray-400 mt-0.5">48 photos</p>
      </div>
    </button>
  );
}
