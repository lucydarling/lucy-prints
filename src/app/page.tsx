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
          <Image
            src="/logo.png"
            alt="Lucy Darling"
            width={200}
            height={160}
            className="mx-auto"
            priority
          />
          <p className="text-sm font-medium mt-2 text-rose-600">Photo Organizer</p>
          <p className="text-sm text-gray-500 mt-3 max-w-md mx-auto">
            Organize and crop your photos for every page of your memory book —
            then download them ready to print at home or at any photo lab.
          </p>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6">
        {/* Continue existing session */}
        {hasExisting && (
          <div className="mb-6">
            <button
              onClick={() => router.push("/upload")}
              className="w-full py-4 text-white font-semibold rounded-xl transition-colors text-sm shadow-sm bg-rose-500 hover:bg-rose-600"
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

        {/* How it works */}
        <div className="mb-6 p-4 rounded-xl bg-white border border-gray-100">
          <h3 className="text-sm font-semibold text-gray-800 mb-2">
            How it works
          </h3>
          <ol className="text-xs text-gray-500 space-y-1.5 list-decimal list-inside">
            <li>Select your memory book theme below</li>
            <li>Upload photos — we&apos;ll tell you exactly which ones you need</li>
            <li>Crop each photo to the perfect size</li>
            <li>Download your ready-to-print photos</li>
            <li>Print at home or any photo lab, then add them to your book</li>
          </ol>
          <p className="text-xs text-rose-600 mt-3">
            Print ordering coming soon — we&apos;re working on it!
          </p>
        </div>

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

        {/* Retiring titles */}
        <h3 className="text-sm font-semibold text-gray-400 mt-6 mb-1">
          Limited Availability
        </h3>
        <p className="text-xs text-gray-400 mb-3">These titles are being retired — available while supplies last.</p>
        <div className="grid grid-cols-2 gap-3">
          {BOOK_THEMES.filter((t) => t.tier === "retiring").map((theme) => (
            <ThemeCard key={theme.id} theme={theme} onSelect={handleSelect} retiring />
          ))}
        </div>
      </div>
    </div>
  );
}

function ThemeCard({
  theme,
  onSelect,
  luxury,
  retiring,
}: {
  theme: (typeof BOOK_THEMES)[number];
  onSelect: (id: string) => void;
  luxury?: boolean;
  retiring?: boolean;
}) {
  return (
    <button
      onClick={() => onSelect(theme.id)}
      className={`group relative rounded-xl overflow-hidden border transition-all text-left ${
        luxury
          ? "border-amber-200 hover:border-amber-300 hover:shadow-md"
          : retiring
          ? "border-gray-200 hover:border-gray-300 hover:shadow-sm opacity-80 hover:opacity-100"
          : "border-gray-100 hover:border-rose-200 hover:shadow-md"
      }`}
    >
      <div
        className={`relative aspect-square ${
          theme.id === "flower_child"
            ? "bg-white"
            : luxury
            ? "bg-gradient-to-br from-amber-50 to-amber-100"
            : retiring
            ? "bg-gradient-to-br from-gray-50 to-gray-100"
            : "bg-gradient-to-br from-rose-50 to-pink-50"
        }`}
      >
        <Image
          src={theme.id === "flower_child" ? `/covers/flower_child.png` : `/covers/${theme.id}.jpg`}
          alt={theme.name}
          fill
          className={theme.id === "flower_child" ? "object-contain p-3" : "object-cover"}
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
